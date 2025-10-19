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
      host: connection?.host
    });
    
    if (!connection) {
      console.log('DATABASE DATA LOADER - 无连接信息，函数执行终止');
      onDataLoaded([], []);
      return;
    }

    setLoading(true);
    try {
      console.log('DATABASE DATA LOADER - 开始加载数据库列表，连接ID:', connection.id || '模拟', '连接状态:', connection.isConnected, '数据库类型:', connection.type);
      
      // 创建缓存键
      const cacheKey = `${connection.id}_${connection.type}`;
      
      // 检查是否需要刷新或缓存是否过期
      const cachedData = databaseListCache[cacheKey];
      const now = Date.now();
      const cacheExpired = cachedData && now - cachedData.timestamp >= CACHE_EXPIRY_TIME;
      const triggerChanged = refreshTrigger !== lastRefreshTrigger.current;
      
      console.log('DATABASE DATA LOADER - 刷新状态检查:', { refreshTrigger, lastRefreshTrigger: lastRefreshTrigger.current, triggerChanged, cacheExists: !!cachedData, cacheExpired });
      
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
          } else {
            databases = await getDatabaseList(connection);
          }
          
          console.log('DATABASE DATA LOADER - 成功获取数据库列表:', databases);
          hasRealData = true;
          
          // 更新缓存
          if (hasRealData && databases.length > 0) {
            databaseListCache[cacheKey] = {
              databases: databases,
              timestamp: now
            };
            console.log('DATABASE DATA LOADER - 数据库列表已缓存');
          }
        } catch (error) {
          console.error('DATABASE DATA LOADER - 获取数据库列表失败:', error);
          // 发生异常时，如果是Redis数据库，仍然返回完整的0-15数据库列表
          if (connection.type === 'redis') {
            console.log('DATABASE DATA LOADER - Redis数据库获取失败，返回默认的0-15数据库列表');
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
            hasRealData = true;
          } else {
            databases = [];
          }
        }
      } else {
        // 使用缓存的数据
        console.log('DATABASE DATA LOADER - 使用缓存的数据库列表');
        databases = cachedData.databases;
        hasRealData = true;
      }

      // 确保使用真实的数据库列表
      let displayDatabases = databases;
      if (!displayDatabases || displayDatabases.length === 0) {
        console.warn('DATABASE DATA LOADER - 未获取到真实数据库列表');
        // 对于Redis数据库，即使缓存或获取失败，也返回完整的0-15数据库列表
        if (connection.type === 'redis') {
          console.log('DATABASE DATA LOADER - Redis数据库列表为空，返回默认的0-15数据库列表');
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
                        
                      console.log(`DATABASE DATA LOADER - 模式 ${schemaName} 的对象数量: 表 ${tables.length}, 视图 ${views.length}, 实体化视图 ${materializedViews.length}, 存储过程 ${procedures.length}, 函数 ${functions.length}`);
                        
                      return {
                        name: schemaName,
                        tables: tables,
                        views: views,
                        materializedViews: materializedViews,
                        procedures: procedures,
                        functions: functions
                      };
                    } catch (schemaError) {
                      console.warn(`DATABASE DATA LOADER - 获取模式 ${schemaName} 的对象信息失败`, schemaError);
                      return {
                        name: schemaName,
                        tables: [],
                        views: [],
                        materializedViews: [],
                        procedures: [],
                        functions: []
                      };
                    }
                  });
                    
                  schemas = await Promise.all(schemaPromises);
                }
            } else {
              if ((connection as any).type === DbType.REDIS || (connection as any).type === 'redis') {
                 tables = [];
                 views = [];
                 procedures = [];
                 functions = [];
                 
                 totalTables = 0;
                 totalViews = 0;
                 totalProcedures = 0;
                 totalFunctions = 0;
                 
                 console.log(`DATABASE DATA LOADER - 跳过Redis对象读取: ${dbName}`);
               } else {
                // 对于其他数据库类型，直接获取所有对象
                const dbObjects = await getAllDatabaseObjects(connection, dbName);
                tables = dbObjects.tables;
                views = dbObjects.views;
                procedures = dbObjects.procedures;
                functions = dbObjects.functions;
                
                totalTables = tables.length;
                totalViews = views.length;
                totalProcedures = procedures.length;
                totalFunctions = functions.length;
                
                console.log(`DATABASE DATA LOADER - 数据库 ${dbName} 的对象数量: 表 ${totalTables}, 视图 ${totalViews}, 存储过程 ${totalProcedures}, 函数 ${totalFunctions}`);
                console.log(`DATABASE DATA LOADER - 数据库 ${dbName} 的表列表: ${JSON.stringify(tables)}`);
              }
            }
          } catch (error) {
            console.warn(`DATABASE DATA LOADER - 获取数据库${dbName}的对象信息失败`, error);
            // 使用默认值继续
            if (typeof dbInfo === 'object') {
              tables = dbInfo.tables || [];
              views = dbInfo.views || [];
              procedures = dbInfo.procedures || [];
              functions = dbInfo.functions || [];
              schemas = dbInfo.schemas || [];
              
              totalTables = tables.length;
              totalViews = views.length;
              totalProcedures = procedures.length;
              totalFunctions = functions.length;
            } else {
              // 如果没有连接信息，显示空列表
              tables = [];
              totalTables = tables.length;
            }
          }
        } else if (typeof dbInfo === 'object') {
          // 只使用dbInfo中的实际数据
          tables = dbInfo.tables || [];
          views = dbInfo.views || [];
          procedures = dbInfo.procedures || [];
          functions = dbInfo.functions || [];
          schemas = dbInfo.schemas || [];
          
          totalTables = tables.length;
          totalViews = views.length;
          totalProcedures = procedures.length;
          totalFunctions = functions.length;
        } else {
          // 没有连接信息，显示空列表
          tables = [];
          totalTables = tables.length;
        }
        
        if (!(((connection as any).type === DbType.REDIS) || ((connection as any).type === 'redis'))) {
           console.log(`DATABASE DATA LOADER - 数据库 ${dbName} 最终统计: 表 ${totalTables}, 视图 ${totalViews}, 存储过程 ${totalProcedures}, 函数 ${totalFunctions}`);
         }
        
        // 构建树节点
        const dbNode: TreeNode = {
          key: `db-${dbName}`,
          title: dbName,
          type: 'database' as const,
          children: []
        };
        
        // 对于Redis数据库，添加keyCount属性
        if (connection.type === 'redis' && typeof dbInfo === 'object' && dbInfo !== null) {
          (dbNode as any).keyCount = dbInfo.keyCount || 0;
          console.log(`DATABASE DATA LOADER - 设置Redis数据库 ${dbName} 的键数量: ${(dbNode as any).keyCount}`);
        }
        
        // 如果是PostgreSQL或GaussDB，确保总是显示schema层级
        if ((connection.type === DbType.POSTGRESQL || connection.type === DbType.GAUSSDB)) {
          console.log(`DATABASE DATA LOADER - 处理PostgreSQL/GaussDB数据库 ${dbName} 的schema层级`);
          
          // 确保总是有schema层级，即使是空的或获取失败
          if (!schemas || schemas.length === 0) {
            console.log(`DATABASE DATA LOADER - 数据库 ${dbName} 没有获取到schema信息，添加默认public模式`);
            // 添加默认public模式
            schemas = [{ name: 'public', tables: [], views: [], procedures: [], functions: [] }];
          }
          
          console.log(`DATABASE DATA LOADER - 数据库 ${dbName} 的schema列表:`, schemas.map(s => s.name));
          
          dbNode.children = schemas.map((schema: any) => {
              console.log(`处理schema: ${schema.name} - 表数量: ${schema.tables?.length || 0}, 视图数量: ${schema.views?.length || 0}, 实体化视图数量: ${schema.materializedViews?.length || 0}, 存储过程数量: ${schema.procedures?.length || 0}, 函数数量: ${schema.functions?.length || 0}`);
              
              // 计算总数用于显示
              const totalCount = (schema.tables?.length || 0) + 
                                (schema.views?.length || 0) + 
                                (schema.materializedViews?.length || 0) + 
                                (schema.procedures?.length || 0) + 
                                (schema.functions?.length || 0);
              
              return {
                key: `schema-${dbName}-${schema.name}`,
                title: `${schema.name} (${totalCount})`, // 更新标题显示总数
                type: 'schema' as const,
                children: [
                  // 表节点 - 总是显示
                  {
                    key: `tables-${dbName}-${schema.name}`,
                    title: `表 (${schema.tables?.length || 0})`,
                    children: (schema.tables && schema.tables.length > 0) ? 
                      schema.tables.map((table: string) => ({
                        key: `table-${dbName}-${schema.name}-${table}`,
                        title: table,
                        isLeaf: true,
                        type: 'table' as const
                      })) : []
                  },
                  // 视图节点 - 总是显示
                  {
                    key: `views-${dbName}-${schema.name}`,
                    title: `视图 (${schema.views?.length || 0})`,
                    children: (schema.views && schema.views.length > 0) ? 
                      schema.views.map((view: string) => ({
                        key: `view-${dbName}-${schema.name}-${view}`,
                        title: view,
                        isLeaf: true,
                        type: 'view' as const
                      })) : []
                  },
                  // 实体化视图节点 - 总是显示
                  {
                    key: `materialized-views-${dbName}-${schema.name}`,
                    title: `实体化视图 (${schema.materializedViews?.length || 0})`,
                    children: (schema.materializedViews && schema.materializedViews.length > 0) ? 
                      schema.materializedViews.map((view: string) => ({
                        key: `materialized-view-${dbName}-${schema.name}-${view}`,
                        title: view,
                        isLeaf: true,
                        type: 'materialized-view' as const
                      })) : []
                  },
                  // 函数节点 - 总是显示，合并存储过程和函数
                  {
                    key: `functions-${dbName}-${schema.name}`,
                    title: `函数 (${(schema.functions?.length || 0) + (schema.procedures?.length || 0)})`,
                    children: [
                      ...(schema.functions || []).map((func: string) => ({
                        key: `function-${dbName}-${schema.name}-${func}`,
                        title: func,
                        isLeaf: true,
                        type: 'function' as const
                      })),
                      ...(schema.procedures || []).map((proc: string) => ({
                        key: `procedure-${dbName}-${schema.name}-${proc}`,
                        title: proc,
                        isLeaf: true,
                        type: 'function' as const
                      }))
                    ]
                  }
                ].filter(Boolean) as TreeNode[]
              };
            });
          } else {
            // 对于非PostgreSQL数据库，保持原有结构
            if ((connection as any).type === DbType.REDIS || (connection as any).type === 'redis') {
               // Redis 不展示表/视图/函数/存储过程分类
               dbNode.children = [];
             } else {
              dbNode.children = [
                // 第二层固定展示表、视图、函数、查询、备份等分类
                // 确保表列表正确填充
                tables.length > 0 ? {
                  key: `tables-${dbName}`,
                  title: `表 (${tables.length})`,
                  children: tables.map((table: string) => ({
                    key: `table-${dbName}-${table}`,
                    title: table,
                    isLeaf: true,
                    type: 'table' as const
                  }))
                } : {
                  key: `tables-${dbName}`,
                  title: `表 (0)`,
                  children: []
                },
                views.length > 0 ? {
                  key: `views-${dbName}`,
                  title: `视图 (${views.length})`,
                  children: views.map((view: string) => ({
                    key: `view-${dbName}-${view}`,
                    title: view,
                    isLeaf: true,
                    type: 'view' as const
                  }))
                } : {
                  key: `views-${dbName}`,
                  title: `视图 (0)`,
                  children: []
                },
                // 其他对象类型（存储过程、函数、查询、备份）的处理类似
                procedures.length > 0 ? {
                  key: `procedures-${dbName}`,
                  title: `存储过程 (${procedures.length})`,
                  children: procedures.map((procedure: string) => ({
                    key: `procedure-${dbName}-${procedure}`,
                    title: procedure,
                    isLeaf: true,
                    type: 'procedure' as const
                  }))
                } : {
                  key: `procedures-${dbName}`,
                  title: `存储过程 (0)`,
                  children: []
                },
                functions.length > 0 ? {
                  key: `functions-${dbName}`,
                  title: `函数 (${functions.length})`,
                  children: functions.map((func: string) => ({
                    key: `function-${dbName}-${func}`,
                    title: func,
                    isLeaf: true,
                    type: 'function' as const
                  }))
                } : {
                  key: `functions-${dbName}`,
                  title: `函数 (0)`,
                  children: []
                },
  
              ].filter(Boolean) as TreeNode[];
            }
          }
          
          return dbNode;
        });
        
        const data: TreeNode[] = await Promise.all(dataPromises);

        console.log('DATABASE DATA LOADER - 数据库结构加载完成，树节点数量:', data.length);
        
        // 自动展开第一个数据库
        let expandedKeys: string[] = [];
        if (data.length > 0) {
          expandedKeys = [data[0].key];
        } else {
          console.warn('DATABASE DATA LOADER - 未生成任何树节点数据');
          // 不提供任何默认数据库，必须从数据库中获得正确的数据库列表
          console.log('所有备用方法都失败，必须从数据库中获得正确的数据库列表');
          onDataLoaded([], []);

    // 注意：刷新触发器由父组件控制，这里不需要重置
          return;
        }

        onDataLoaded(data, expandedKeys);
      } catch (error) {
        console.error('DATABASE DATA LOADER - 加载数据库结构失败:', error);
        onDataLoaded([], []);
      } finally {
        setLoading(false);
      }
  };

  useEffect(() => {
    console.log('DATABASE DATA LOADER - connection状态变化或刷新触发:', connection, 'refreshTrigger:', refreshTrigger);
    loadDatabaseStructure();
  }, [connection, refreshTrigger]);

  // 导出清除缓存的方法，供外部调用
  useImperativeHandle(ref, () => ({
    clearCache: () => {
      const cacheKey = connection ? `${connection.id}_${connection.type}` : '';
      if (cacheKey && databaseListCache[cacheKey]) {
        delete databaseListCache[cacheKey];
        console.log('DATABASE DATA LOADER - 缓存已清除');
      }
    }
  }));

  return null; // 这个组件不渲染任何UI，只是数据加载服务
});

export default DatabaseDataLoader;