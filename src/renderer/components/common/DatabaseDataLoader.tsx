import React, { useState, forwardRef, useImperativeHandle, useEffect, useRef } from 'react';
import { DatabaseConnection } from '../../types';
import { getDatabaseList, getRedisDatabases, getDefaultDatabases, DbType, getAllDatabaseObjects, getSchemaList, DatabaseItem } from '../../utils/database-utils';

// 数据库列表缓存
const databaseListCache: Record<string, { databases: DatabaseItem[], timestamp: number }> = {};

// 缓存过期时间（5分钟）
const CACHE_EXPIRY_TIME = 5 * 60 * 1000;

// 定义组件引用接口
interface DatabaseDataLoaderRef {
  clearCache: () => void;
}

interface TreeNode {
  key: string;
  title: string;
  icon?: React.ReactNode;
  children?: TreeNode[];
  isLeaf?: boolean;
  type?: 'database' | 'table' | 'view' | 'materialized-view' | 'procedure' | 'function' | 'query' | 'backup' | 'schema';
}

interface DatabaseDataLoaderProps {
  connection: DatabaseConnection | null;
  refreshTrigger: number;
  onDataLoaded: (treeData: TreeNode[], expandedKeys: string[]) => void;
}

const DatabaseDataLoader = forwardRef<DatabaseDataLoaderRef, DatabaseDataLoaderProps>(({
  connection,
  refreshTrigger,
  onDataLoaded
}, ref) => {
  const [loading, setLoading] = useState(false);
  const lastRefreshTrigger = useRef(0); // 新增：跟踪上一次的刷新触发器值


  // 数据库对象类型图标映射
  const objectTypeIcons: Record<string, React.ReactNode> = {
    database: null, // 图标将在主组件中处理
    table: null,
    view: null,
    procedure: null,
    function: null,
    query: null,
    backup: null
  };

  const loadDatabaseStructure = async () => {
    console.log("DATABASE DATA LOADER - 进入loadDatabaseStructure函数，准备加载数据库结构", connection);
    // 即使没有连接，也继续执行以显示日志
    console.log('DATABASE DATA LOADER - 当前连接信息:', {
      id: connection?.id,
      isConnected: connection?.isConnected,
      type: connection?.type,
      host: connection?.host,
      connectionId: connection?.connectionId
    });
    
    if (!connection) {
      console.log('DATABASE DATA LOADER - 无连接信息，函数执行终止');
      onDataLoaded([], []);
      return;
    }

    // 断开状态下直接清空列表并终止加载，避免占位数据与交互
    if (!connection.isConnected) {
      console.log('DATABASE DATA LOADER - 连接已断开，清空数据库列表并停止加载');
      const cachePrefix = `${connection.id}_${connection.type}_`;
      // 清除该连接相关缓存（包括connected/disconnected前缀）
      Object.keys(databaseListCache).forEach((k) => {
        if (k.startsWith(cachePrefix)) {
          delete databaseListCache[k];
        }
      });
      onDataLoaded([], []);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      console.log('DATABASE DATA LOADER - 开始加载数据库列表，连接ID:', connection.id || '模拟', '连接状态:', connection.isConnected, '数据库类型:', connection.type);
      
      // 创建缓存键（包含连接状态与连接池ID，避免断开时的0值污染连接后的真实数据）
      const cacheKey = `${connection.id}_${connection.type}_${connection.isConnected ? (connection.connectionId || 'connected') : 'disconnected'}`;
      
      // 检查是否需要刷新或缓存是否过期
      const cachedData = databaseListCache[cacheKey];
      const now = Date.now();
      const cacheExpired = cachedData && now - cachedData.timestamp >= CACHE_EXPIRY_TIME;
      const triggerChanged = refreshTrigger !== lastRefreshTrigger.current;
      
      console.log('DATABASE DATA LOADER - 刷新状态检查:', { refreshTrigger, lastRefreshTrigger: lastRefreshTrigger.current, triggerChanged, cacheExists: !!cachedData, cacheExpired, cacheKey });
      
      // 更新上一次的刷新触发器值
      lastRefreshTrigger.current = refreshTrigger;
      
      let databases: DatabaseItem[] = [];
      let hasRealData = false;
      
      // 当刷新触发器变化时，无条件重新获取数据；或缓存不存在/过期时也重新获取
      if (triggerChanged || !cachedData || cacheExpired) {
        console.log('DATABASE DATA LOADER - 刷新触发器变化或缓存无效，强制重新获取数据库列表');
        try {
          // 对于MySQL连接，我们需要确保第一次获取的是完整列表
          if (connection.type === 'mysql') {
            console.log('DATABASE DATA LOADER - 处理MySQL连接，确保使用正确的连接池获取完整数据库列表');
          }
          
          // 对于Redis数据库，直接调用getRedisDatabases确保获取完整的0-15号数据库列表
          if (connection.type === 'redis') {
            console.log('DATABASE DATA LOADER - 处理Redis连接，直接调用getRedisDatabases获取完整数据库列表');
            databases = await getRedisDatabases(connection);
            // 仅在实际连接的情况下才认为是“真实数据”，否则视为占位数据不进入缓存
            hasRealData = !!connection.isConnected;
          } else {
            databases = await getDatabaseList(connection);
            hasRealData = true;
          }
          
          console.log('DATABASE DATA LOADER - 成功获取数据库列表:', databases);
          
          // 更新缓存：对于Redis数据库，完全禁用缓存，确保每次都获取最新数据
          let shouldCache = false;
          
          if (connection.type === 'redis') {
            // Redis数据库完全禁用缓存
            shouldCache = false;
            console.log(`DATABASE DATA LOADER - Redis连接缓存已禁用，将始终重新获取数据库列表`);
          } else {
            // 非Redis数据库使用原有缓存逻辑
            shouldCache = hasRealData && databases.length > 0;
          }
          
          if (shouldCache) {
            databaseListCache[cacheKey] = {
              databases: databases,
              timestamp: now
            };
            console.log(`DATABASE DATA LOADER - 数据库列表已缓存, cacheKey: ${cacheKey}, 类型: ${connection.type}`);
          } else {
            console.log(`DATABASE DATA LOADER - 跳过缓存: ${connection.type === 'redis' ? 'Redis数据库' : '非Redis数据库'} (条件不满足)`);
          }
        } catch (error) {
          console.error('DATABASE DATA LOADER - 获取数据库列表失败:', error);
          // 发生异常时，如果是Redis数据库，仍然返回完整的0-15数据库列表（不缓存）
          if (connection.type === 'redis') {
            console.log('DATABASE DATA LOADER - Redis数据库获取失败，返回默认的0-15数据库列表（不缓存）');
            databases = [];
            for (let i = 0; i <= 15; i++) {
              databases.push({
                name: `db${i}`,
                tables: [],
                views: [],
                procedures: [],
                functions: [],
                schemas: [],
                keyCount: 0
              });
            }
            hasRealData = false; // 占位数据
          } else {
            databases = [];
          }
        }
      } else {
        // 使用缓存的数据
        console.log('DATABASE DATA LOADER - 使用缓存的数据库列表, cacheKey:', cacheKey);
        databases = cachedData.databases;
        hasRealData = true;
      }

      // 确保使用真实的数据库列表
      let displayDatabases = databases;
      if (!displayDatabases || displayDatabases.length === 0) {
        console.warn('DATABASE DATA LOADER - 未获取到真实数据库列表');
        // 对于Redis数据库，即使缓存或获取失败，也返回完整的0-15数据库列表（占位显示，不缓存）
        if (connection.type === 'redis') {
          console.log('DATABASE DATA LOADER - Redis数据库列表为空，返回默认的0-15数据库列表（占位）');
          displayDatabases = [];
          for (let i = 0; i <= 15; i++) {
            displayDatabases.push({
              name: `db${i}`,
              tables: [],
              views: [],
              procedures: [],
              functions: [],
              schemas: [],
              keyCount: 0
            });
          }
        } else {
          displayDatabases = [];
        }
      }
      console.log('DATABASE DATA LOADER - 最终显示的数据库列表:', displayDatabases, '是否为真实数据:', hasRealData);

      // 对于每个数据库，尝试获取表、视图等信息
      const dataPromises = displayDatabases.map(async (dbInfo: any) => {
        const dbName = typeof dbInfo === 'string' ? dbInfo : dbInfo.name;
        let tables: string[] = [];
        let views: string[] = [];
        let procedures: string[] = [];
        let functions: string[] = [];
        let schemas: any[] = [];
        let totalTables = 0;
        let totalViews = 0;
        let totalProcedures = 0;
        let totalFunctions = 0;
        // 对于Redis，保留初始键数量，用于右侧数据库列表显示
        let keyCount = (connection.type === DbType.REDIS) && typeof dbInfo === 'object' ? (dbInfo.keyCount || 0) : 0;
        
        console.log(`DATABASE DATA LOADER - 开始获取数据库 ${dbName} 的对象信息`);
        
        // 尝试从真实数据库获取信息
        if (window.electronAPI && connection.id && connection.isConnected) {
          try {
            // 根据数据库类型采取不同的策略
              if (connection.type === DbType.POSTGRESQL || connection.type === DbType.GAUSSDB) {
                // 对于PostgreSQL和GaussDB，获取schema列表
                const schemaList = await getSchemaList(connection, dbName);
                  
                if (schemaList && schemaList.length > 0) {
                  console.log(`DATABASE DATA LOADER - 数据库 ${dbName} 有 ${schemaList.length} 个模式`);
                  // 为每个schema获取表、视图、实体化视图、函数等信息
                  const schemaPromises = schemaList.map(async (schemaName: string) => {
                    try {
                      // 使用getAllDatabaseObjects方法获取当前schema的基本对象
                      const schemaObjects = await getAllDatabaseObjects(connection, schemaName, schemaName);
                        
                      // 额外获取实体化视图
                      let materializedViews: string[] = [];
                      if (connection.type === DbType.POSTGRESQL) {
                        try {
                          const mViewQuery = "SELECT matviewname FROM pg_matviews WHERE schemaname = ?";
                          const mViewResult = await window.electronAPI.executeQuery(connection.connectionId || connection.id, mViewQuery, [schemaName]);
                          if (mViewResult && mViewResult.success && Array.isArray(mViewResult.data)) {
                            materializedViews = mViewResult.data.map((row: any) => row.matviewname);
                          }
                        } catch (error) {
                          console.warn(`获取模式 ${schemaName} 的实体化视图失败:`, error);
                          materializedViews = [];
                        }
                      }
                       
                      // 额外查询获取函数（为了兼容不同版本，使用更通用的查询）
                      let functions: string[] = [];
                      try {
                        const funcQuery = "SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = ? AND p.prokind = 'f'";
                        const functionResult = await window.electronAPI.executeQuery(connection.connectionId || connection.id, funcQuery, [schemaName]);
                        if (functionResult && functionResult.success && Array.isArray(functionResult.data)) {
                          functions = functionResult.data.map((row: any) => row.proname);
                        }
                      } catch (error) {
                        console.warn(`获取模式 ${schemaName} 的函数失败:`, error);
                        functions = schemaObjects.functions || [];
                      }
                        
                      // 确保所有字段都有默认值
                      const tables = schemaObjects.tables || [];
                      const views = schemaObjects.views || [];
                      const procedures = schemaObjects.procedures || [];
                        
                      // 累加统计总数
                      totalTables += tables.length;
                      totalViews += views.length;
                      totalProcedures += procedures.length;
                      totalFunctions += functions.length;
                      
                      return {
                        schemaName,
                        tables,
                        views,
                        materializedViews,
                        procedures,
                        functions
                      };
                    } catch (error) {
                      console.warn(`获取模式 ${schemaName} 的对象信息失败:`, error);
                      return {
                        schemaName,
                        tables: [],
                        views: [],
                        materializedViews: [],
                        procedures: [],
                        functions: []
                      };
                    }
                  });
                  
                  const schemaResults = await Promise.all(schemaPromises);
                  schemas = schemaResults.map(r => ({
                    name: r.schemaName,
                    tables: r.tables,
                    views: r.views,
                    materializedViews: r.materializedViews,
                    procedures: r.procedures,
                    functions: r.functions
                  }));
                }
              } else {
                // 其他数据库类型使用统一方法获取对象
                const result = await getAllDatabaseObjects(connection, dbName);
                tables = result.tables || [];
                views = result.views || [];
                procedures = result.procedures || [];
                functions = result.functions || [];
                totalTables = tables.length;
                totalViews = views.length;
                totalProcedures = procedures.length;
                totalFunctions = functions.length;
              }
          } catch (error) {
            console.warn(`获取数据库 ${dbName} 的对象信息失败:`, error);
          }
        } else {
          console.log('DATABASE DATA LOADER - 无法获取真实对象信息（未连接或缺少API），保持占位数据');
        }

        return {
          dbName,
          tables,
          views,
          procedures,
          functions,
          schemas,
          totalTables,
          totalViews,
          totalProcedures,
          totalFunctions,
          keyCount
        };
      });

      const results = await Promise.all(dataPromises);
      console.log('DATABASE DATA LOADER - 对象信息获取完成，准备构建树结构');

      // 构建树结构
      const treeData: TreeNode[] = results.map(result => {
        const children: TreeNode[] = [];

        // PostgreSQL/GaussDB: 使用schema视图
        if (connection.type === DbType.POSTGRESQL || connection.type === DbType.GAUSSDB) {
          // 模式节点
          const schemaNodes: TreeNode[] = result.schemas.map((schema: any) => ({
            key: `${result.dbName}/schema/${schema.name}`,
            title: `${schema.name}`,
            type: 'schema' as const,
            children: [
              // 表节点
              {
                key: `${result.dbName}/schema/${schema.name}/tables`,
                title: `表 (${schema.tables.length})`,
                type: 'table' as const,
                children: schema.tables.map((t: string) => ({
                  key: `${result.dbName}/schema/${schema.name}/table/${t}`,
                  title: t,
                  isLeaf: true
                }))
              },
              // 视图节点
              {
                key: `${result.dbName}/schema/${schema.name}/views`,
                title: `视图 (${schema.views.length})`,
                type: 'view' as const,
                children: schema.views.map((v: string) => ({
                  key: `${result.dbName}/schema/${schema.name}/view/${v}`,
                  title: v,
                  isLeaf: true
                }))
              },
              // 实体化视图（PostgreSQL）
              ...(connection.type === DbType.POSTGRESQL ? [{
                key: `${result.dbName}/schema/${schema.name}/materialized-views`,
                title: `实体化视图 (${schema.materializedViews.length})`,
                type: 'materialized-view' as const,
                children: schema.materializedViews.map((mv: string) => ({
                  key: `${result.dbName}/schema/${schema.name}/materialized-view/${mv}`,
                  title: mv,
                  isLeaf: true
                }))
              }] : []),
              // 过程节点
              {
                key: `${result.dbName}/schema/${schema.name}/procedures`,
                title: `过程 (${schema.procedures.length})`,
                type: 'procedure' as const,
                children: schema.procedures.map((p: string) => ({
                  key: `${result.dbName}/schema/${schema.name}/procedure/${p}`,
                  title: p,
                  isLeaf: true
                }))
              },
              // 函数节点
              {
                key: `${result.dbName}/schema/${schema.name}/functions`,
                title: `函数 (${schema.functions.length})`,
                type: 'function' as const,
                children: schema.functions.map((f: string) => ({
                  key: `${result.dbName}/schema/${schema.name}/function/${f}`,
                  title: f,
                  isLeaf: true
                }))
              }
            ]
          }));

          children.push({
            key: `${result.dbName}/schemas`,
            title: `模式 (${result.schemas.length})`,
            type: 'schema' as const,
            children: schemaNodes
          });
        } else {
          // 通用对象视图
          children.push(
            {
              key: `${result.dbName}/tables`,
              title: `表 (${result.totalTables})`,
              type: 'table' as const,
              children: result.tables.map(t => ({ key: `${result.dbName}/table/${t}`, title: t, isLeaf: true }))
            },
            {
              key: `${result.dbName}/views`,
              title: `视图 (${result.totalViews})`,
              type: 'view' as const,
              children: result.views.map(v => ({ key: `${result.dbName}/view/${v}`, title: v, isLeaf: true }))
            },
            {
              key: `${result.dbName}/procedures`,
              title: `过程 (${result.totalProcedures})`,
              type: 'procedure' as const,
              children: result.procedures.map(p => ({ key: `${result.dbName}/procedure/${p}`, title: p, isLeaf: true }))
            },
            {
              key: `${result.dbName}/functions`,
              title: `函数 (${result.totalFunctions})`,
              type: 'function' as const,
              children: result.functions.map(f => ({ key: `${result.dbName}/function/${f}`, title: f, isLeaf: true }))
            }
          );
        }

        return {
          key: result.dbName,
          title: result.dbName,
          type: 'database' as const,
          children,
          // 对于Redis，将键数量透出到节点，便于右侧列表显示
          ...(connection.type === DbType.REDIS ? { keyCount: result.keyCount || 0 } : {})
        };
      });

      // 默认展开第一个数据库节点
      const expandedKeys = treeData.length > 0 ? [treeData[0].key] : [];

      // 通知父组件数据已加载完成
      onDataLoaded(treeData, expandedKeys);
      setLoading(false);
    } catch (error) {
      console.error('DATABASE DATA LOADER - 加载数据库结构失败:', error);
      onDataLoaded([], []);
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDatabaseStructure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection, refreshTrigger]);

  useImperativeHandle(ref, () => ({
    clearCache: () => {
      console.log('DATABASE DATA LOADER - 手动清除数据库列表缓存');
      Object.keys(databaseListCache).forEach(key => delete databaseListCache[key]);
    }
  }));

  return null;
});

export default DatabaseDataLoader;