import React, { useState, forwardRef, useImperativeHandle, useEffect, useRef } from 'react';
import { DatabaseConnection } from '../types';
import { getDatabaseList, getDefaultDatabases, DbType, getAllDatabaseObjects, getSchemaList, DatabaseItem } from '../utils/database-utils';

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
  type?: 'database' | 'table' | 'view' | 'procedure' | 'function' | 'query' | 'backup';
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

  // 模拟查询列表
  const mockQueries = [
    "最近查询 1",
    "最近查询 2",
    "最近查询 3"
  ];

  // 模拟备份列表
  const mockBackups = [
    "备份 2023-09-30",
    "备份 2023-09-25",
    "备份 2023-09-20"
  ];

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
          
          databases = await getDatabaseList(connection);
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
          databases = [];
        }
      } else {
        // 使用缓存的数据
        console.log('DATABASE DATA LOADER - 使用缓存的数据库列表');
        databases = cachedData.databases;
        hasRealData = true;
      }

      // 确保使用真实的数据库列表，不回退到模拟数据
      // 只有在真实数据不存在时，才使用连接配置中指定的数据库作为默认值
      let displayDatabases = databases;
      if (!displayDatabases || displayDatabases.length === 0) {
        console.warn('DATABASE DATA LOADER - 未获取到真实数据库列表，使用连接配置中的数据库');
        // 使用连接配置中指定的数据库
        if (connection.database) {
          displayDatabases = [{ name: connection.database }];
          console.log('DATABASE DATA LOADER - 使用连接配置中的数据库:', connection.database);
        } else {
          // 对于SQLite，如果未指定数据库名称，使用'main'
          if (connection.type === 'sqlite') {
            displayDatabases = [{ name: 'main' }];
            console.log('DATABASE DATA LOADER - SQLite默认数据库名称: main');
          } else {
            displayDatabases = [];
            console.warn('DATABASE DATA LOADER - 无法确定默认数据库名称');
          }
        }
      }
      console.log('DATABASE DATA LOADER - 最终显示的数据库列表:', displayDatabases, '是否为真实数据:', hasRealData);

      // 对于每个数据库，尝试获取表、视图等信息
      const dataPromises = displayDatabases.map(async (dbInfo: any) => {
        const dbName = typeof dbInfo === 'string' ? dbInfo : dbInfo.name;
        let tables = [];
        let views = [];
        let procedures = [];
        let functions = [];
        let schemas: any[] = [];
        
        // 尝试从真实数据库获取信息
        if (window.electronAPI && connection.id && connection.isConnected) {
          try {
            // 根据数据库类型采取不同的策略
            if (connection.type === DbType.POSTGRESQL || connection.type === DbType.GAUSSDB) {
              // 对于PostgreSQL和GaussDB，获取schema列表
              const schemaList = await getSchemaList(connection, dbName);
              
              if (schemaList && schemaList.length > 0) {
                // 为每个schema获取表、视图等信息
                const schemaPromises = schemaList.map(async (schemaName: string) => {
                  // 使用新的getAllDatabaseObjects方法获取当前schema的所有对象
                  const schemaObjects = await getAllDatabaseObjects(connection, dbName, schemaName);
                  
                  return {
                    name: schemaName,
                    tables: schemaObjects.tables,
                    views: schemaObjects.views,
                    procedures: schemaObjects.procedures,
                    functions: schemaObjects.functions
                  };
                });
                
                schemas = await Promise.all(schemaPromises);
              }
            } else {
              // 对于其他数据库类型，直接获取所有对象
              const dbObjects = await getAllDatabaseObjects(connection, dbName);
              tables = dbObjects.tables;
              views = dbObjects.views;
              procedures = dbObjects.procedures;
              functions = dbObjects.functions;
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
            }
          }
        } else if (typeof dbInfo === 'object') {
          // 如果使用的是模拟数据对象
          tables = dbInfo.tables || [];
          views = dbInfo.views || [];
          procedures = dbInfo.procedures || [];
          functions = dbInfo.functions || [];
          schemas = dbInfo.schemas || [];
        }
        
        // 构建树节点
        const dbNode: TreeNode = {
          key: `db-${dbName}`,
          title: dbName,
          type: 'database' as const,
          children: []
        };
        
        // 如果是PostgreSQL或GaussDB并且有schemas，添加schema层级
        if ((connection.type === DbType.POSTGRESQL || connection.type === DbType.GAUSSDB) && schemas.length > 0) {
          dbNode.children = schemas.map((schema: any) => ({
              key: `schema-${dbName}-${schema.name}`,
              title: schema.name,
              children: [
                // 在schema下展示表、视图、函数、存储过程
                schema.tables && schema.tables.length > 0 ? {
                  key: `tables-${dbName}-${schema.name}`,
                  title: `表 (${schema.tables.length})`,
                  children: schema.tables.map((table: string) => ({
                    key: `table-${dbName}-${schema.name}-${table}`,
                    title: table,
                    isLeaf: true,
                    type: 'table' as const
                  }))
                } : {
                  key: `tables-${dbName}-${schema.name}`,
                  title: `表 (0)`,
                  children: []
                },
                // 其他对象类型（视图、存储过程、函数）的处理类似
                schema.views && schema.views.length > 0 ? {
                  key: `views-${dbName}-${schema.name}`,
                  title: `视图 (${schema.views.length})`,
                  children: schema.views.map((view: string) => ({
                    key: `view-${dbName}-${schema.name}-${view}`,
                    title: view,
                    isLeaf: true,
                    type: 'view' as const
                  }))
                } : {
                  key: `views-${dbName}-${schema.name}`,
                  title: `视图 (0)`,
                  children: []
                },
                schema.procedures && schema.procedures.length > 0 ? {
                  key: `procedures-${dbName}-${schema.name}`,
                  title: `存储过程 (${schema.procedures.length})`,
                  children: schema.procedures.map((procedure: string) => ({
                    key: `procedure-${dbName}-${schema.name}-${procedure}`,
                    title: procedure,
                    isLeaf: true,
                    type: 'procedure' as const
                  }))
                } : {
                  key: `procedures-${dbName}-${schema.name}`,
                  title: `存储过程 (0)`,
                  children: []
                },
                schema.functions && schema.functions.length > 0 ? {
                  key: `functions-${dbName}-${schema.name}`,
                  title: `函数 (${schema.functions.length})`,
                  children: schema.functions.map((func: string) => ({
                    key: `function-${dbName}-${schema.name}-${func}`,
                    title: func,
                    isLeaf: true,
                    type: 'function' as const
                  }))
                } : {
                  key: `functions-${dbName}-${schema.name}`,
                  title: `函数 (0)`,
                  children: []
                }
              ].filter(Boolean) as TreeNode[]
            }));
          } else {
            // 对于非PostgreSQL数据库，保持原有结构
            dbNode.children = [
              // 第二层固定展示表、视图、函数、查询、备份等分类
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
              {
                key: `queries-${dbName}`,
                title: `查询 (${mockQueries.length})`,
                children: mockQueries.map((query, index) => ({
                  key: `query-${dbName}-${index}`,
                  title: query,
                  isLeaf: true,
                  type: 'query' as const
                }))
              },
              {
                key: `backups-${dbName}`,
                title: `备份 (${mockBackups.length})`,
                children: mockBackups.map((backup, index) => ({
                  key: `backup-${dbName}-${index}`,
                  title: backup,
                  isLeaf: true,
                  type: 'backup' as const
                }))
              }
            ].filter(Boolean) as TreeNode[];
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
          // 不再使用默认数据库结构，而是创建一个基于连接配置的数据库节点
          if (connection && connection.database) {
            const dbNode: TreeNode = {
              key: `db-${connection.database}`,
              title: connection.database,
              type: 'database' as const,
              children: [
                {
                  key: `tables-${connection.database}`,
                  title: `表 (0)`,
                  children: []
                },
                {
                  key: `views-${connection.database}`,
                  title: `视图 (0)`,
                  children: []
                },
                {
                  key: `procedures-${connection.database}`,
                  title: `存储过程 (0)`,
                  children: []
                },
                {
                  key: `functions-${connection.database}`,
                  title: `函数 (0)`,
                  children: []
                }
              ]
            };
            expandedKeys = [`db-${connection.database}`];
            onDataLoaded([dbNode], expandedKeys);
          } else if (connection && connection.type === 'sqlite') {
            // 对于SQLite，如果没有指定数据库名称，使用'main'
            const dbNode: TreeNode = {
              key: 'db-main',
              title: 'main',
              type: 'database' as const,
              children: [
                {
                  key: 'tables-main',
                  title: `表 (0)`,
                  children: []
                },
                {
                  key: 'views-main',
                  title: `视图 (0)`,
                  children: []
                },
                {
                  key: 'procedures-main',
                  title: `存储过程 (0)`,
                  children: []
                },
                {
                  key: 'functions-main',
                  title: `函数 (0)`,
                  children: []
                }
              ]
            };
            expandedKeys = ['db-main'];
            onDataLoaded([dbNode], expandedKeys);
          } else {
      console.error('DATABASE DATA LOADER - 无法创建数据库节点，连接信息不完整');
      onDataLoaded([], []);
    }
    
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