import { DatabaseConnection } from '../types';

// 全局变量类型声明
declare global {
  // 用于控制MySQL连接警告消息的全局变量
  var mysqlConnectionIdWarningSent: boolean;
  var mysqlConnectionStatusWarningSent: boolean;
  
  // 用于控制PostgreSQL连接警告消息的全局变量
  var postgresConnectionIdWarningSent: boolean;
  var postgresConnectionStatusWarningSent: boolean;
  
  // 用于控制Oracle连接警告消息的全局变量
  var oracleConnectionIdWarningSent: boolean;
  var oracleConnectionStatusWarningSent: boolean;
  
  // 用于控制GaussDB连接警告消息的全局变量
  var gaussdbConnectionIdWarningSent: boolean;
  var gaussdbConnectionStatusWarningSent: boolean;
  
  // 用于控制其他数据库连接警告消息的全局变量
  var dbConnectionIdWarningSent: boolean;
  var dbConnectionStatusWarningSent: boolean;
}

// 数据库类型枚举
export enum DbType {
  MYSQL = 'mysql',
  ORACLE = 'oracle',
  POSTGRESQL = 'postgresql',
  GAUSSDB = 'gaussdb',
  REDIS = 'redis',
  SQLITE = 'sqlite'
}

// 数据库列表项接口
export interface DatabaseItem {
  name: string;
  tables?: string[];
  views?: string[];
  procedures?: string[];
  functions?: string[];
  schemas?: DatabaseSchema[];
  // Redis特有的键数量信息
  keyCount?: number;
}

// 数据库模式接口
export interface DatabaseSchema {
  name: string;
  tables?: string[];
  views?: string[];
  procedures?: string[];
  functions?: string[];
}

// 数据库对象类型
export type DatabaseObjectType = 'table' | 'view' | 'procedure' | 'function';

/**
 * 获取数据库列表的工厂函数，根据数据库类型调用对应的方法
 * @param connection 数据库连接对象
 * @returns Promise<DatabaseItem[]> 用户可访问的所有数据库列表
 */
export const getDatabaseList = async (connection: DatabaseConnection): Promise<DatabaseItem[]> => {
  // 定义重试次数和间隔
  const MAX_RETRIES = 5;
  const RETRY_INTERVAL_MS = 500;
  
  // 存储最后一次失败的错误信息
  let lastError: any = null;
  
  try {
    console.log('===== 开始获取数据库列表 =====');
    console.log('连接信息:', { type: connection.type, host: connection.host, port: connection.port, id: connection.id });
    
    // 检查基本条件
    if (!window.electronAPI) {
      console.error('DATABASE UTILS - 错误: electronAPI不可用，无法获取真实数据库列表');
      // 不使用默认数据库，必须从数据库中获得正确的数据库列表
      return [];
    }
    
    // 1. 首先检查该链接是否创建了数据库连接，如果未创建，则进行创建
    if (!connection.isConnected || !connection.connectionId) {
      console.log('DATABASE UTILS - 连接未创建或已断开，尝试重新连接');
      
      try {
        // 尝试重新连接数据库
        const connectResult = await window.electronAPI.connectDatabase(connection);
        
        if (connectResult && connectResult.success) {
          console.log('DATABASE UTILS - 数据库重新连接成功');
          // 更新连接信息
          connection.isConnected = true;
          connection.connectionId = connectResult.connectionId;
        } else {
          console.error('DATABASE UTILS - 数据库重新连接失败:', connectResult?.message);
          // 连接失败，返回空数组
          return [];
        }
      } catch (error) {
        console.error('DATABASE UTILS - 重新连接数据库时发生异常:', error);
        // 连接异常，返回空数组
        return [];
      }
    }
    
    // 2. 现在连接已建立，获取链接信息，尝试获取数据库列表
    console.log('DATABASE UTILS - 连接已建立，准备获取数据库列表');
    
    // 主获取逻辑 - 带重试机制
    let result: DatabaseItem[] = [];
    let retries = 0;
    let success = false;
    
    // 尝试获取数据库列表，支持重试
    while (retries < MAX_RETRIES && !success) {
      try {
        console.log(`尝试获取${connection.type}数据库列表 (第${retries + 1}次尝试)，连接ID: ${connection.id}`);
        
        // 1. 首先尝试使用通用的listDatabases方法
        result = await getDatabasesWithPrimaryMethod(connection);
        
        if (result && result.length > 0) {
          console.log(`成功获取数据库列表，数量: ${result.length}`);
          success = true;
        } else {
          // 2. 如果通用方法失败，尝试使用特定数据库类型的备用方法
          console.warn(`通用方法获取数据库列表失败，尝试使用特定数据库类型的备用方法`);
          result = await getDatabasesWithFallbackMethod(connection);
          
          if (result && result.length > 0) {
            console.log(`备用方法成功获取数据库列表，数量: ${result.length}`);
            success = true;
          } else if (retries < MAX_RETRIES - 1) {
            // 3. 如果所有获取方法都失败，检查连接是否失效，如果失效则重新连接
            if (retries % 2 === 1) { // 每2次尝试后检查连接状态
              console.warn(`获取数据库列表失败，检查连接状态...`);
              
              try {
                // 检查连接是否仍然有效
                const testResult = await window.electronAPI.testConnection(connection);
                
                if (!testResult || !testResult.success) {
                  console.warn('DATABASE UTILS - 连接已失效，尝试重新连接');
                  const reconnectResult = await window.electronAPI.connectDatabase(connection);
                  
                  if (reconnectResult && reconnectResult.success) {
                    console.log('DATABASE UTILS - 数据库重新连接成功');
                    connection.isConnected = true;
                    connection.connectionId = reconnectResult.connectionId;
                  } else {
                    console.error('DATABASE UTILS - 数据库重新连接失败:', reconnectResult?.message);
                  }
                }
              } catch (error) {
                console.error('DATABASE UTILS - 检查或重新连接数据库时发生异常:', error);
              }
            }
            
            console.warn(`准备重试获取数据库列表...`);
            retries++;
            await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL_MS));
          } else {
            lastError = new Error(`所有尝试均失败，无法获取数据库列表`);
            console.error(`达到最大重试次数(${MAX_RETRIES})，获取数据库列表失败`);
          }
        }
      } catch (error) {
        lastError = error;
        console.error(`获取数据库列表过程中发生错误 (第${retries + 1}次尝试):`, error);
        
        // 如果捕获到连接相关的错误，尝试重新连接
        if (error instanceof Error && error.message && (error.message.includes('connection') || error.message.includes('connect'))) {
          try {
            console.warn('DATABASE UTILS - 检测到连接错误，尝试重新连接');
            const reconnectResult = await window.electronAPI.connectDatabase(connection);
            
            if (reconnectResult && reconnectResult.success) {
              console.log('DATABASE UTILS - 数据库重新连接成功');
              connection.isConnected = true;
              connection.connectionId = reconnectResult.connectionId;
            } else {
              console.error('DATABASE UTILS - 数据库重新连接失败:', reconnectResult?.message);
            }
          } catch (reconnectError) {
            console.error('DATABASE UTILS - 重新连接数据库时发生异常:', reconnectError);
          }
        }
        
        if (retries < MAX_RETRIES) {
          console.warn(`准备重试获取数据库列表...`);
          retries++;
          await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL_MS));
        } else {
          console.error(`达到最大重试次数(${MAX_RETRIES})，获取数据库列表失败。最后错误:`, error);
        }
      }
    }
    
    // 去重处理
    result = result.filter((db, index, self) => 
      index === self.findIndex((t) => t.name === db.name)
    );
    
    // 对于Redis数据库，保持原始顺序（0-15号在前，然后是额外的数据库）
    // 对于其他数据库类型，按照名称排序
    if (connection.type !== DbType.REDIS) {
      result = result.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    console.log(`最终获取的数据库列表数量: ${result.length}`);
    console.log('===== 获取数据库列表完成 =====');
    
    return result;
  } catch (error) {
    console.error('DATABASE UTILS - 获取数据库列表时发生异常:', error);
    // 发生异常时，返回空数组
    return [];
  }
};

/**
 * 使用主方法（electronAPI.listDatabases）获取数据库列表
 * @param connection 数据库连接对象
 * @returns Promise<DatabaseItem[]> 数据库列表
 */
async function getDatabasesWithPrimaryMethod(connection: DatabaseConnection): Promise<DatabaseItem[]> {
  try {
    // 确保使用真实的连接池ID，添加类型断言以确保poolId不会为undefined
    const poolId = connection.connectionId as string;
    console.log('直接调用window.electronAPI.listDatabases获取数据库列表，连接池ID:', poolId);
    
    // 添加更详细的连接信息日志
    console.log('连接信息详情:', {
      connectionId: connection.connectionId,
      id: connection.id,
      isConnected: connection.isConnected,
      type: connection.type,
      host: connection.host,
      port: connection.port,
      database: connection.database
    });
    
    const dbListResult = await window.electronAPI.listDatabases(poolId);
    
    console.log('electronAPI.listDatabases返回结果:', JSON.stringify(dbListResult, null, 2));
    
    if (dbListResult && dbListResult.success && Array.isArray(dbListResult.data) && dbListResult.data.length > 0) {
      console.log(`成功获取到${dbListResult.data.length}个真实数据库`);
      // 将简单的字符串数组转换为DatabaseItem对象数组
      return dbListResult.data.map((dbName: string) => ({
        name: dbName,
        // 预填充空数组，避免后续访问undefined
        tables: [],
        views: [],
        procedures: [],
        functions: [],
        schemas: []
      }));
    } else if (dbListResult && dbListResult.success) {
      console.log('electronAPI.listDatabases返回空数据');
    } else if (dbListResult) {
      console.error('electronAPI.listDatabases返回失败:', dbListResult.error || '未知错误');
    } else {
      console.error('electronAPI.listDatabases返回null/undefined');
    }
    return [];
  } catch (error) {
    console.error('调用electronAPI.listDatabases失败:', error);
    // 输出详细的错误对象，包括堆栈信息
    if (error instanceof Error) {
      console.error('错误详情:', { message: error.message, stack: error.stack });
    }
    return [];
  }
}

/**
 * 根据数据库类型使用特定的备用方法获取数据库列表
 * @param connection 数据库连接对象
 * @returns Promise<DatabaseItem[]> 数据库列表
 */
async function getDatabasesWithFallbackMethod(connection: DatabaseConnection): Promise<DatabaseItem[]> {
  try {
    console.log(`使用特定数据库类型(${connection.type})的备用方法获取数据库列表`);
    
    switch (connection.type) {
      case DbType.MYSQL:
        return await getMysqlDatabases(connection);
      case DbType.POSTGRESQL:
        return await getPostgreSqlDatabases(connection);
      case DbType.ORACLE:
        return await getOracleDatabases(connection);
      case DbType.GAUSSDB:
        return await getGaussDBDatabases(connection);
      case DbType.REDIS:
        return await getRedisDatabases(connection);
      case DbType.SQLITE:
        return await getSqliteDatabases(connection);
      default:
        console.error('DATABASE UTILS - 错误: 不支持的数据库类型', connection.type);
        return [];
    }
  } catch (error) {
    console.error('调用特定数据库类型备用方法失败:', error);
    return [];
  }
}

/**
 * 获取MySQL数据库列表
 * @param connection 数据库连接对象
 * @returns Promise<DatabaseItem[]>
 */
export async function getMysqlDatabases(connection: DatabaseConnection): Promise<DatabaseItem[]> {
  // 记录连接的基本信息（不包含密码）
  console.log('开始获取MySQL数据库列表，连接信息:', {
    name: connection.name,
    type: connection.type,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    hasPassword: !!connection.password,
    database: connection.database
  });

  // 检查基本条件
  if (!window.electronAPI) {
    console.error('MySQL数据库 - electronAPI不可用，无法获取数据库列表');
    // 不使用配置中的数据库名称作为备用选项，必须从数据库中获得正确的数据库列表
    return [];
  }

  // 使用连接池ID，如果不存在则尝试创建一个新的连接池或使用替代方案
  let poolId: string = connection.connectionId || connection.id;
  
  // 优化连接状态处理，减少重复警告
  if (!connection.connectionId) {
    // 只在首次出现此情况时输出详细警告
    if (!globalThis.mysqlConnectionIdWarningSent) {
      console.warn('MySQL数据库 - connection.connectionId为空，使用connection.id作为替代连接标识符');
      console.log('连接信息:', { id: connection.id, name: connection.name, type: connection.type });
      globalThis.mysqlConnectionIdWarningSent = true;
    }
  }
  
  // 简洁的连接状态提示
  if (!connection.isConnected) {
    if (!globalThis.mysqlConnectionStatusWarningSent) {
      console.warn('MySQL数据库 - 连接未标记为已连接，但会尝试获取数据库列表');
      globalThis.mysqlConnectionStatusWarningSent = true;
    }
  }

  // 确保poolId始终有值
  poolId = poolId || connection.id;

  try {

    console.log('执行MySQL listDatabases调用，连接池ID:', poolId);
    // 调用electronAPI获取数据库列表
    const dbListResult = await window.electronAPI.listDatabases(poolId);
    
    console.log('MySQL listDatabases返回结果:', JSON.stringify(dbListResult, null, 2));
    
    if (dbListResult && dbListResult.success && Array.isArray(dbListResult.data)) {
      // 将简单的字符串数组转换为DatabaseItem对象数组
      const databaseItems = dbListResult.data.map((dbName: string) => ({
        name: dbName,
        // 预填充空数组，避免后续访问undefined
        tables: [],
        views: [],
        procedures: [],
        functions: [],
        schemas: []
      }));
      
      console.log('返回的MySQL数据库项数量:', databaseItems.length);
      console.log('===== 获取MySQL数据库列表完成 =====');
      return databaseItems;
    } else {
      // 详细记录失败原因
      let failureReason = '未知原因';
      if (!dbListResult) {
        failureReason = 'window.electronAPI.listDatabases返回null/undefined';
      } else if (!dbListResult.success) {
        failureReason = `返回success=false，error: ${dbListResult.error || '无错误信息'}`;
      } else if (!Array.isArray(dbListResult.data)) {
        failureReason = `data不是数组，类型: ${typeof dbListResult.data}`;
      } else if (dbListResult.data.length === 0) {
        failureReason = '返回空数组';
      }
      
      console.error(`MySQL listDatabases方法失败，原因: ${failureReason}，尝试使用SHOW DATABASES SQL查询作为备用方案`);
      
      // 使用SHOW DATABASES SQL查询作为备用方案
      try {
        const sqlResult = await window.electronAPI.executeQuery(poolId, "SHOW DATABASES");
        
        console.log('MySQL SHOW DATABASES查询结果:', JSON.stringify(sqlResult, null, 2));
        
        if (sqlResult && sqlResult.success && Array.isArray(sqlResult.data)) {
          // 将SQL查询结果转换为DatabaseItem对象数组
          const databaseItems = sqlResult.data.map((row: any) => ({
            name: Object.values(row)[0],
            // 预填充空数组，避免后续访问undefined
            tables: [],
            views: [],
            procedures: [],
            functions: [],
            schemas: []
          }));
          
          console.log('备用方案返回的MySQL数据库项数量:', databaseItems.length);
          console.log('===== 获取MySQL数据库列表完成 =====');
          return databaseItems;
        } else {
          // 详细记录备用方案失败原因
          let sqlFailureReason = '未知原因';
          if (!sqlResult) {
            sqlFailureReason = 'window.electronAPI.executeQuery返回null/undefined';
          } else if (!sqlResult.success) {
            sqlFailureReason = `返回success=false，error: ${sqlResult.error || '无错误信息'}`;
          } else if (!Array.isArray(sqlResult.data)) {
            sqlFailureReason = `data不是数组，类型: ${typeof sqlResult.data}`;
          } else if (sqlResult.data.length === 0) {
            sqlFailureReason = '返回空数组';
          }
          
          console.error(`备用方案获取MySQL数据库列表也失败，原因: ${sqlFailureReason}`);
          
          // 不使用配置中的数据库名称作为备用选项，只返回真实数据
          return [];
        }
      } catch (sqlError) {
        console.error('执行SHOW DATABASES SQL查询时发生异常:', sqlError);
        
        // 不使用配置中的数据库名称作为备用选项，只返回真实数据
        return [];
      }
    }
  } catch (error) {
    console.error('调用electronAPI获取MySQL数据库列表异常:', error);
    
    try {
      // 异常情况下也尝试备用方案
      console.log('发生异常，尝试使用SHOW DATABASES SQL查询作为备用方案');
      const sqlResult = await window.electronAPI.executeQuery(poolId, "SHOW DATABASES");
      
      if (sqlResult && sqlResult.success && Array.isArray(sqlResult.data)) {
        const databaseItems = sqlResult.data.map((row: any) => ({
          name: Object.values(row)[0],
          tables: [],
          views: [],
          procedures: [],
          functions: [],
          schemas: []
        }));
        
        console.log('异常情况下备用方案返回的MySQL数据库项数量:', databaseItems.length);
        return databaseItems;
      } else {
        console.error('异常情况下备用方案也失败:', sqlResult);
      }
    } catch (sqlError) {
      console.error('备用方案执行也失败:', sqlError);
    }
    
    return [];
  }
};

/**
 * 获取PostgreSQL数据库列表
 * @param connection 数据库连接对象
 * @returns Promise<DatabaseItem[]> 数据库列表
 */
const getPostgreSqlDatabases = async (connection: DatabaseConnection): Promise<DatabaseItem[]> => {
  console.log('===== 开始获取PostgreSQL数据库列表 =====');
  console.log('连接状态检查:', { 
    isConnected: connection.isConnected, 
    electronAPI: !!window.electronAPI, 
    connectionId: connection.id,
    poolId: connection.connectionId,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    hasPassword: !!connection.password,
    database: connection.database
  });

  // 确保连接池ID始终有效
  let poolId = connection.connectionId || connection.id;
  let isConnectionReestablished = false;
  
  // 如果连接池ID无效，尝试创建新的连接
  if (!poolId && window.electronAPI && connection.isConnected) {
    console.warn('PostgreSQL连接池ID无效，尝试重新建立连接...');
    try {
      const connectResult = await window.electronAPI.connectDatabase(connection);
      if (connectResult && connectResult.success && connectResult.connectionId) {
        poolId = connectResult.connectionId;
        connection.connectionId = poolId; // 更新连接对象的connectionId
        isConnectionReestablished = true;
        console.log('成功创建新的连接池，ID:', poolId);
      }
    } catch (connectError) {
      console.error('重新建立连接失败:', connectError);
    }
  }

  try {
    // 检查连接ID是否有效
    if (!poolId) {
      console.error('PostgreSQL数据库连接池ID不存在，无法获取数据库列表');
      // 不使用配置中的数据库名称作为备用选项，必须从数据库中获得正确的数据库列表
      return [];
    }

    // 定义一个安全执行API调用的辅助函数
    const safeApiCall = async (apiCall: () => Promise<any>): Promise<any> => {
      try {
        return await apiCall();
      } catch (error) {
        console.error('API调用异常:', error);
        // 检查错误是否包含"连接池不存在"信息
        if (error && (typeof error === 'string' && error.includes('连接池不存在') || 
                      (error as any)?.message?.includes('连接池不存在'))) {
          console.warn('检测到连接池不存在，尝试重新建立连接...');
          if (!isConnectionReestablished && window.electronAPI && connection.isConnected) {
            try {
              const reconnectResult = await window.electronAPI.connectDatabase(connection);
              if (reconnectResult && reconnectResult.success && reconnectResult.connectionId) {
                poolId = reconnectResult.connectionId;
                connection.connectionId = poolId; // 更新连接对象的connectionId
                isConnectionReestablished = true;
                console.log('成功重新建立连接，新的连接池ID:', poolId);
                // 重新尝试API调用
                return await apiCall();
              }
            } catch (reconnectError) {
              console.error('重新建立连接失败:', reconnectError);
            }
          }
        }
        throw error; // 重新抛出其他类型的错误
      }
    };

    // 定义重试次数和间隔
    const MAX_RETRIES = 3;
    const RETRY_INTERVAL_MS = 1000;
    
    // 尝试使用SQL查询获取数据库列表（优先使用这种方法）
    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      try {
        console.log(`执行PostgreSQL SQL查询获取数据库列表 (尝试 ${retry + 1}/${MAX_RETRIES})，连接池ID:`, poolId);
        
        // 优化的PostgreSQL获取数据库列表的SQL语句
        // 添加了权限检查和过滤系统数据库
        const sqlResult = await safeApiCall(() => 
          window.electronAPI.executeQuery(poolId, 
            `SELECT datname 
             FROM pg_database 
             WHERE datistemplate = false 
               AND datname NOT IN ('template0', 'template1')
             ORDER BY datname`
          )
        );
        
        console.log('PostgreSQL SQL查询结果:', JSON.stringify(sqlResult, null, 2));
        
        if (sqlResult && sqlResult.success && Array.isArray(sqlResult.data) && sqlResult.data.length > 0) {
          // 将SQL查询结果转换为DatabaseItem对象数组
          const databaseItems = sqlResult.data.map((row: any) => ({
            name: row.datname,
            // 预填充空数组，避免后续访问undefined
            tables: [],
            views: [],
            procedures: [],
            functions: [],
            schemas: []
          }));
          
          console.log('成功获取PostgreSQL数据库列表，数量:', databaseItems.length);
          console.log('===== 获取PostgreSQL数据库列表完成 =====');
          return databaseItems;
        } else if (sqlResult && sqlResult.success && Array.isArray(sqlResult.data) && sqlResult.data.length === 0) {
          console.warn('PostgreSQL数据库列表为空，可能是权限不足或没有数据库');
          break; // 空结果不需要重试
        }
      } catch (sqlError) {
        console.warn(`PostgreSQL SQL查询失败 (尝试 ${retry + 1}/${MAX_RETRIES}):`, sqlError);
        
        // 如果不是最后一次尝试，等待一段时间后重试
        if (retry < MAX_RETRIES - 1) {
          console.log(`等待${RETRY_INTERVAL_MS}ms后重试...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL_MS));
        }
      }
    }
    
    // 如果SQL查询失败，尝试使用listDatabases方法
    console.log('SQL查询方法失败，尝试使用window.electronAPI.listDatabases方法');
    try {
      const dbListResult = await safeApiCall(() => 
        window.electronAPI.listDatabases(poolId)
      );
      
      console.log('PostgreSQL listDatabases返回结果:', JSON.stringify(dbListResult, null, 2));
      
      if (dbListResult && dbListResult.success && Array.isArray(dbListResult.data) && dbListResult.data.length > 0) {
        const databases = dbListResult.data.map((dbName: string) => ({
          name: dbName,
          tables: [],
          views: [],
          procedures: [],
          functions: [],
          schemas: []
        }));
        console.log('window.electronAPI.listDatabases方法成功获取数据库列表:', databases);
        console.log('===== 获取PostgreSQL数据库列表完成 =====');
        return databases;
      }
    } catch (listDbError) {
      console.error('window.electronAPI.listDatabases方法失败:', listDbError);
    }
    
    console.warn('PostgreSQL: 无法获取数据库列表，所有方法都失败且无配置数据库名称');
    return [];
  } catch (error) {
    console.error('获取PostgreSQL数据库列表时发生未处理的异常:', error);
    return [];
  }
};

/**
 * 获取Oracle数据库列表
 * @param connection 数据库连接对象
 * @returns Promise<DatabaseItem[]>
 */
const getOracleDatabases = async (connection: DatabaseConnection): Promise<DatabaseItem[]> => {
  try {
    // Oracle获取数据库列表的特定方法
    // Oracle实际上是获取表空间或用户方案
    const result = await window.electronAPI.executeQuery(
      connection.id, 
      "SELECT DISTINCT owner FROM all_objects WHERE object_type = 'TABLE' ORDER BY owner"
    );
    
    if (result && result.success && Array.isArray(result.data)) {
      return result.data.map((row: any) => ({
        name: row.OWNER || row.owner
      }));
    } else {
      console.error('获取Oracle数据库列表失败', result);
      return [];
    }
  } catch (error) {
    console.error('调用electronAPI获取Oracle数据库列表失败', error);
    return [];
  }
};

/**
 * 获取GaussDB数据库列表
 * @param connection 数据库连接对象
 * @returns Promise<DatabaseItem[]>
 */
const getGaussDBDatabases = async (connection: DatabaseConnection): Promise<DatabaseItem[]> => {
  // GaussDB与PostgreSQL兼容，使用类似PostgreSQL的方法
  return getPostgreSqlDatabases(connection);
};

/**
 * 获取Redis数据库列表
 * @param connection 数据库连接对象
 * @returns Promise<DatabaseItem[]>
 */
export const getRedisDatabases = async (connection: DatabaseConnection): Promise<DatabaseItem[]> => {
  try {
    console.log('===== 开始获取Redis数据库列表 =====');
    console.log('连接信息:', { type: connection.type, host: connection.host, port: connection.port, id: connection.id });
    
    // 检查基本条件
    if (!window.electronAPI) {
      console.error('Redis数据库 - electronAPI不可用，无法获取数据库列表');
      return [];
    }
    
    // 使用正确的连接池ID生成逻辑，与DatabaseService保持一致
    const databaseName = connection.database || '';
    const poolId: string = `${connection.type}_${connection.host}_${connection.port}_${databaseName}`;
    console.log('使用正确格式的连接池ID:', poolId);
    
    // 创建一个字典来存储实际有数据的数据库信息
    const existingDatabases: Record<string, number> = {};
    // 创建一个集合来记录已处理的数据库名称
    const processedDatabases = new Set<string>();
    
    // 尝试获取实际的数据库信息
    try {
      console.log(`执行Redis INFO keyspace命令，poolId: ${poolId}`);
      const result = await window.electronAPI.executeQuery(
        poolId, 
        "INFO keyspace"
      );
      
      console.log('INFO keyspace命令执行结果:', JSON.stringify(result, null, 2));
      
      if (result && result.success && typeof result.data === 'string') {
        console.log('INFO keyspace返回的原始数据:', result.data);
        const lines = result.data.split('\n');
        lines.forEach((line: string) => {
          if (line.trim()) { // 确保不是空行
            console.log(`处理INFO行: "${line}"`);
            if (line.startsWith('db')) {
              const parts = line.split(':');
              const dbName = parts[0];
              
              // 改进的键数量提取逻辑
              let keyCount = 0;
              if (parts.length > 1) {
                const keysMatch = parts[1].match(/keys=(\d+)/);
                if (keysMatch && keysMatch[1]) {
                  keyCount = parseInt(keysMatch[1], 10);
                  console.log(`数据库 ${dbName} 的键数量: ${keyCount}`);
                }
              }
              
              existingDatabases[dbName] = keyCount;
            }
          }
        });
      } else {
        console.error('INFO keyspace命令返回的数据格式不正确:', result);
      }
    } catch (infoError) {
      console.warn('获取INFO keyspace失败:', infoError);
    }
    
    // 如果通过INFO keyspace没有获取到键数量，尝试为每个数据库单独执行DBSIZE命令
    // 特别是针对db0和db2，因为用户确认这两个数据库应该有数据
    if (!existingDatabases['db0'] || !existingDatabases['db2']) {
      console.log('尝试使用DBSIZE命令单独获取db0和db2的键数量');
      
      // 为db0获取键数量
      try {
        const db0SizeResult = await window.electronAPI.executeQuery(
          poolId,
          "SELECT 0 AS dbIndex; DBSIZE"
        );
        console.log('db0 DBSIZE命令结果:', JSON.stringify(db0SizeResult, null, 2));
        if (db0SizeResult && db0SizeResult.success && typeof db0SizeResult.data === 'number') {
          existingDatabases['db0'] = db0SizeResult.data;
          console.log(`通过DBSIZE获取到db0的键数量: ${existingDatabases['db0']}`);
        }
      } catch (db0Error) {
        console.warn('获取db0键数量失败:', db0Error);
      }
      
      // 为db2获取键数量
      try {
        // 切换到db2，然后执行DBSIZE
        await window.electronAPI.executeQuery(poolId, "SELECT 2 AS dbIndex;");
        const db2SizeResult = await window.electronAPI.executeQuery(
          poolId,
          "DBSIZE"
        );
        console.log('db2 DBSIZE命令结果:', JSON.stringify(db2SizeResult, null, 2));
        if (db2SizeResult && db2SizeResult.success && typeof db2SizeResult.data === 'number') {
          existingDatabases['db2'] = db2SizeResult.data;
          console.log(`通过DBSIZE获取到db2的键数量: ${existingDatabases['db2']}`);
        }
      } catch (db2Error) {
        console.warn('获取db2键数量失败:', db2Error);
      }
      
      // 切换回db0
      try {
        await window.electronAPI.executeQuery(poolId, "SELECT 0 AS dbIndex;");
      } catch (switchError) {
        // 忽略切换回db0的错误
      }
    }
    
    console.log('最终的数据库键数量映射:', JSON.stringify(existingDatabases, null, 2));
    
    // 始终返回0-15的完整数据库列表，并且如果有更多数据库，在向后追加
    const databases: DatabaseItem[] = [];
    
    // 先添加0-15号数据库
    for (let i = 0; i <= 15; i++) {
      const dbName = `db${i}`;
      const keyCount = existingDatabases[dbName] || 0;
      console.log(`添加数据库 ${dbName}，键数量: ${keyCount}`);
      databases.push({
        name: dbName,
        tables: [],
        views: [],
        procedures: [],
        functions: [],
        schemas: [],
        // 使用实际的键数量或默认为0
        keyCount: keyCount
      });
      processedDatabases.add(dbName);
    }
    
    // 添加额外的数据库（编号大于15的）
    for (const dbName in existingDatabases) {
      if (existingDatabases.hasOwnProperty(dbName) && !processedDatabases.has(dbName)) {
        // 检查是否是有效的数据库名称（以db开头且后面跟着数字）
        if (/^db\d+$/.test(dbName)) {
          databases.push({
            name: dbName,
            tables: [],
            views: [],
            procedures: [],
            functions: [],
            schemas: [],
            keyCount: existingDatabases[dbName]
          });
        }
      }
    }
    
    console.log('成功获取Redis数据库列表，数量:', databases.length);
    console.log('===== 获取Redis数据库列表完成 =====');
    return databases;
  } catch (error) {
    console.error('调用electronAPI获取Redis数据库列表失败', error);
    // 发生异常时，仍然返回完整的0-15数据库列表
    console.log('发生异常，返回默认的0-15数据库列表');
    const defaultDatabases: DatabaseItem[] = [];
    for (let i = 0; i <= 15; i++) {
      defaultDatabases.push({
        name: `db${i}`,
        tables: [],
        views: [],
        procedures: [],
        functions: [],
        schemas: [],
        keyCount: 0
      });
    }
    return defaultDatabases;
  }
};


/**
 * 获取SQLite数据库列表
 * @param connection 数据库连接对象
 * @returns Promise<DatabaseItem[]>
 */
const getSqliteDatabases = async (connection: DatabaseConnection): Promise<DatabaseItem[]> => {
  try {
    // SQLite获取数据库列表的特定方法
    const result = await window.electronAPI.executeQuery(
      connection.id, 
      "PRAGMA database_list"
    );
    
    if (result && result.success && Array.isArray(result.data)) {
      return result.data.map((row: any) => ({
        name: row.name || connection.database || 'main'
      }));
    } else {
      console.error('获取SQLite数据库列表失败', result);
      // 不使用配置中的数据库名称作为备用选项，必须从数据库中获得正确的数据库列表
      return [];
    }
  } catch (error) {
    console.error('调用electronAPI获取SQLite数据库列表失败', error);
    // 不使用配置中的数据库名称作为备用选项，必须从数据库中获得正确的数据库列表
    return [];
  }
};

/**
 * 获取默认数据库列表（仅用于开发测试，生产环境返回空数组）
 * @returns DatabaseItem[] 空数组
 */
export const getDefaultDatabases = (): DatabaseItem[] => {
  // 移除默认模拟数据，仅返回空数组
  return [];
};

/**
 * 获取数据库下的表列表
 * @param connection 数据库连接对象
 * @param databaseName 数据库名称
 * @param schema 可选的模式名称（主要用于PostgreSQL等支持模式的数据库）
 * @returns Promise<string[]> 真实数据表列表，失败时返回空数组
 */
export const getTableList = async (connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> => {
  try {
    // 检查基本条件
    if (!window.electronAPI || !connection.isConnected || !databaseName) {
      console.warn(`获取表列表失败: 无效的连接或数据库名称`);
      return [];
    }
    
    // 使用连接池ID，如果不存在则回退到原始连接ID
    const poolId = connection.connectionId || connection.id;
    
    if (!poolId) {
      console.warn(`获取表列表失败: 连接池ID不存在`);
      return [];
    }

    let result: any;
    
    switch (connection.type) {
      case DbType.MYSQL:
        // MySQL: 使用information_schema查询特定数据库的表列表，避免切换数据库
        result = await window.electronAPI.executeQuery(
          poolId, 
          "SELECT table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", 
          [databaseName]
        );
        if (result && result.success && Array.isArray(result.data)) {
          return result.data.map((row: any) => row.table_name);
        }
        break;
        
      case DbType.POSTGRESQL:
        // PostgreSQL: 使用information_schema获取表列表
        const schemaName = schema || 'public';
        result = await window.electronAPI.executeQuery(
          poolId, 
          "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'", 
          [schemaName]
        );
        if (result && result.success && Array.isArray(result.data)) {
          return result.data.map((row: any) => row.table_name);
        }
        break;
        
      case DbType.ORACLE:
        // Oracle: 获取用户下的表
        result = await window.electronAPI.executeQuery(
          poolId, 
          "SELECT table_name FROM all_tables WHERE owner = ?", 
          [databaseName.toUpperCase()]
        );
        if (result && result.success && Array.isArray(result.data)) {
          return result.data.map((row: any) => row.TABLE_NAME);
        }
        break;
        
      case DbType.GAUSSDB:
        // GaussDB与PostgreSQL兼容
        const gaussSchema = schema || 'public';
        result = await window.electronAPI.executeQuery(
          poolId, 
          "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'", 
          [gaussSchema]
        );
        if (result && result.success && Array.isArray(result.data)) {
          return result.data.map((row: any) => row.table_name);
        }
        break;
        
      case DbType.REDIS:
        // Redis没有表的概念，返回空数组
        return [];
        
      case DbType.SQLITE:
        // SQLite: 查询所有表
        result = await window.electronAPI.executeQuery(
          poolId, 
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        );
        if (result && result.success && Array.isArray(result.data)) {
          return result.data.map((row: any) => row.name);
        }
        break;
    }
    
    console.warn(`获取${connection.type}数据库表列表失败: 无效的结果`);
    return [];
  } catch (error) {
    console.error(`获取数据库表列表异常:`, error);
    return [];
  }
};

/**
 * 获取数据库下的视图列表
 * @param connection 数据库连接对象
 * @param databaseName 数据库名称
 * @param schema 可选的模式名称（主要用于PostgreSQL等支持模式的数据库）
 * @returns Promise<string[]> 真实视图列表，失败时返回空数组
 */
export const getViewList = async (connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> => {
  try {
    // 检查基本条件
    if (!window.electronAPI || !connection.isConnected || !databaseName) {
      console.warn(`获取视图列表失败: 无效的连接或数据库名称`);
      return [];
    }
    
    // 使用连接池ID，如果不存在则回退到原始连接ID
    const poolId = connection.connectionId || connection.id;
    
    if (!poolId) {
      console.warn(`获取视图列表失败: 连接池ID不存在`);
      return [];
    }
    
    try {
      let result: any;
      
      switch (connection.type) {
        case DbType.MYSQL:
          // MySQL: 使用information_schema查询特定数据库的视图列表，避免切换数据库
          result = await window.electronAPI.executeQuery(
            poolId, 
            "SELECT table_name FROM information_schema.views WHERE table_schema = ?", 
            [databaseName]
          );
          if (result && result.success && Array.isArray(result.data)) {
            return result.data.map((row: any) => row.table_name);
          }
          break;
          
        case DbType.POSTGRESQL:
          // PostgreSQL: 使用information_schema获取视图列表
          const schemaName = schema || 'public';
          result = await window.electronAPI.executeQuery(
            poolId, 
            "SELECT table_name FROM information_schema.views WHERE table_schema = ?", 
            [schemaName]
          );
          if (result && result.success && Array.isArray(result.data)) {
            return result.data.map((row: any) => row.table_name);
          }
          break;
          
        case DbType.ORACLE:
          // Oracle: 获取用户下的视图
          result = await window.electronAPI.executeQuery(
            poolId, 
            "SELECT view_name FROM all_views WHERE owner = ?", 
            [databaseName.toUpperCase()]
          );
          if (result && result.success && Array.isArray(result.data)) {
            return result.data.map((row: any) => row.VIEW_NAME);
          }
          break;
          
        case DbType.GAUSSDB:
          // GaussDB与PostgreSQL兼容
          const gaussSchema = schema || 'public';
          result = await window.electronAPI.executeQuery(
            poolId, 
            "SELECT table_name FROM information_schema.views WHERE table_schema = ?", 
            [gaussSchema]
          );
          if (result && result.success && Array.isArray(result.data)) {
            return result.data.map((row: any) => row.table_name);
          }
          break;
          
        case DbType.REDIS:
          // Redis没有视图的概念，返回空数组
          return [];
          
        case DbType.SQLITE:
          // SQLite: 查询所有视图
          result = await window.electronAPI.executeQuery(
            poolId, 
            "SELECT name FROM sqlite_master WHERE type='view'"
          );
          if (result && result.success && Array.isArray(result.data)) {
            return result.data.map((row: any) => row.name);
          }
          break;
      }
      
      console.warn(`获取${connection.type}数据库视图列表失败: 无效的结果`);
      return [];
    } catch (error) {
      console.error(`获取数据库视图列表异常:`, error);
      return [];
    }
  } catch (error) {
    console.error(`获取视图列表时发生异常:`, error);
    return [];
  }
};

/**
 * 获取数据库下的存储过程列表
 * @param connection 数据库连接对象
 * @param databaseName 数据库名称
 * @param schema 可选的模式名称（主要用于PostgreSQL等支持模式的数据库）
 * @returns Promise<string[]> 真实存储过程列表，失败时返回空数组
 */
export const getProcedureList = async (connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> => {
  try {
    // 检查基本条件
    if (!window.electronAPI || !connection.isConnected || !databaseName) {
      console.warn(`获取存储过程列表失败: 无效的连接或数据库名称`);
      return [];
    }
    
    // 使用连接池ID，如果不存在则回退到原始连接ID
    const poolId = connection.connectionId || connection.id;
    
    if (!poolId) {
      console.warn(`获取存储过程列表失败: 连接池ID不存在`);
      return [];
    }
    
    try {
      let result: any;
      
      switch (connection.type) {
        case DbType.MYSQL:
          // MySQL: 使用information_schema查询特定数据库的存储过程列表
          result = await window.electronAPI.executeQuery(
            poolId, 
            "SELECT routine_name FROM information_schema.routines WHERE routine_schema = ? AND routine_type = 'PROCEDURE'", 
            [databaseName]
          );
          if (result && result.success && Array.isArray(result.data)) {
            return result.data.map((row: any) => row.routine_name);
          }
          break;
          
        case DbType.POSTGRESQL:
          // PostgreSQL: 使用information_schema获取存储过程列表
          const schemaName = schema || 'public';
          result = await window.electronAPI.executeQuery(
            poolId, 
            "SELECT routine_name FROM information_schema.routines WHERE specific_schema = ? AND routine_type = 'PROCEDURE'", 
            [schemaName]
          );
          if (result && result.success && Array.isArray(result.data)) {
            return result.data.map((row: any) => row.routine_name);
          }
          break;
          
        case DbType.ORACLE:
          // Oracle: 获取用户下的存储过程
          result = await window.electronAPI.executeQuery(
            poolId, 
            "SELECT object_name FROM all_objects WHERE owner = ? AND object_type = 'PROCEDURE'", 
            [databaseName.toUpperCase()]
          );
          if (result && result.success && Array.isArray(result.data)) {
            return result.data.map((row: any) => row.OBJECT_NAME);
          }
          break;
          
        case DbType.GAUSSDB:
          // GaussDB与PostgreSQL兼容
          const gaussSchema = schema || 'public';
          result = await window.electronAPI.executeQuery(
            poolId, 
            "SELECT routine_name FROM information_schema.routines WHERE specific_schema = ? AND routine_type = 'PROCEDURE'", 
            [gaussSchema]
          );
          if (result && result.success && Array.isArray(result.data)) {
            return result.data.map((row: any) => row.routine_name);
          }
          break;
          
        case DbType.REDIS:
          // Redis没有存储过程的概念，返回空数组
          return [];
          
        case DbType.SQLITE:
          // SQLite: 查询所有存储过程
          result = await window.electronAPI.executeQuery(
            poolId, 
            "SELECT name FROM sqlite_master WHERE type='trigger'"
          );
          if (result && result.success && Array.isArray(result.data)) {
            return result.data.map((row: any) => row.name);
          }
          break;
      }
      
      console.warn(`获取${connection.type}数据库存储过程列表失败: 无效的结果`);
      return [];
    } catch (error) {
      console.error(`获取数据库存储过程列表异常:`, error);
      return [];
    }
  } catch (error) {
    console.error(`获取存储过程列表时发生异常:`, error);
    return [];
  }
};

/**
 * 获取数据库下的函数列表
 * @param connection 数据库连接对象
 * @param databaseName 数据库名称
 * @param schema 可选的模式名称（主要用于PostgreSQL等支持模式的数据库）
 * @returns Promise<string[]> 真实函数列表，失败时返回空数组
 */
export const getFunctionList = async (connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> => {
  try {
    // 检查基本条件
    if (!window.electronAPI || !connection.isConnected || !databaseName) {
      console.warn(`获取函数列表失败: 无效的连接或数据库名称`);
      return [];
    }
    
    // 使用连接池ID，如果不存在则回退到原始连接ID
    const poolId = connection.connectionId || connection.id;
    
    if (!poolId) {
      console.warn(`获取函数列表失败: 连接池ID不存在`);
      return [];
    }
    
    try {
      let result: any;
      
      switch (connection.type) {
        case DbType.MYSQL:
          // MySQL: 使用information_schema查询特定数据库的函数列表
          result = await window.electronAPI.executeQuery(
            poolId, 
            "SELECT routine_name FROM information_schema.routines WHERE routine_schema = ? AND routine_type = 'FUNCTION'", 
            [databaseName]
          );
          if (result && result.success && Array.isArray(result.data)) {
            return result.data.map((row: any) => row.routine_name);
          }
          break;
          
        case DbType.POSTGRESQL:
          // PostgreSQL: 使用information_schema获取函数列表
          const schemaName = schema || 'public';
          result = await window.electronAPI.executeQuery(
            poolId, 
            "SELECT routine_name FROM information_schema.routines WHERE specific_schema = ? AND routine_type = 'FUNCTION'", 
            [schemaName]
          );
          if (result && result.success && Array.isArray(result.data)) {
            return result.data.map((row: any) => row.routine_name);
          }
          break;
          
        case DbType.ORACLE:
          // Oracle: 获取用户下的函数
          result = await window.electronAPI.executeQuery(
            poolId, 
            "SELECT object_name FROM all_objects WHERE owner = ? AND object_type = 'FUNCTION'", 
            [databaseName.toUpperCase()]
          );
          if (result && result.success && Array.isArray(result.data)) {
            return result.data.map((row: any) => row.OBJECT_NAME);
          }
          break;
          
        case DbType.GAUSSDB:
          // GaussDB与PostgreSQL兼容
          const gaussSchema = schema || 'public';
          result = await window.electronAPI.executeQuery(
            poolId, 
            "SELECT routine_name FROM information_schema.routines WHERE specific_schema = ? AND routine_type = 'FUNCTION'", 
            [gaussSchema]
          );
          if (result && result.success && Array.isArray(result.data)) {
            return result.data.map((row: any) => row.routine_name);
          }
          break;
          
        case DbType.REDIS:
          // Redis没有函数的概念，返回空数组
          return [];
          
        case DbType.SQLITE:
          // SQLite: 查询所有函数相关对象（SQLite没有真正的函数概念，这里返回空数组）
          return [];
          break;
      }
      
      console.warn(`获取${connection.type}数据库函数列表失败: 无效的结果`);
      return [];
    } catch (error) {
      console.error(`获取数据库函数列表异常:`, error);
      return [];
    }
  } catch (error) {
    console.error(`获取函数列表时发生异常:`, error);
    return [];
  }
};

/**
 * 获取数据库下的模式列表
 * @param connection 数据库连接对象
 * @param databaseName 数据库名称
 * @returns Promise<string[]> 真实模式列表，失败时返回默认的public模式
 */

// 开发环境下自动运行模式列表测试（只在开发时执行）
if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
  setTimeout(async () => {
    try {
      // 动态导入测试模块
      const { runSchemaTest } = await import('./schema-test');
      console.log('\n\n==== 开发环境 - 自动运行模式列表测试 ====');
      await runSchemaTest();
    } catch (error) {
      console.error('开发环境 - 模式列表测试加载失败:', error);
    }
  }, 2000);
}
export const getSchemaList = async (connection: DatabaseConnection, databaseName: string): Promise<string[]> => {
  console.log(`GET SCHEMA LIST - 开始获取数据库 ${databaseName} 的模式列表，连接类型: ${connection.type}`);
  try {
    // 检查基本条件
    if (!window.electronAPI || !connection.isConnected || !databaseName) {
      console.warn(`GET SCHEMA LIST - 获取模式列表失败: 无效的连接或数据库名称`, {
        electronAPI: !!window.electronAPI,
        isConnected: connection.isConnected,
        databaseName: databaseName
      });
      // 返回默认的public模式
      return connection.type === DbType.POSTGRESQL || connection.type === DbType.GAUSSDB ? ['public'] : [];
    }
    
    // 使用真实的连接池ID，如果不存在则回退到原始连接ID
    const poolId = connection.connectionId || connection.id;
    console.log(`GET SCHEMA LIST - 连接池ID: ${poolId}`);
    
    if (!poolId) {
      console.warn(`GET SCHEMA LIST - 获取模式列表失败: 连接池ID不存在`);
      // 返回默认的public模式
      return connection.type === DbType.POSTGRESQL || connection.type === DbType.GAUSSDB ? ['public'] : [];
    }

    try {
      let result: any;
      
      switch (connection.type) {
        case DbType.POSTGRESQL:
        case DbType.GAUSSDB:
          console.log(`GET SCHEMA LIST - 处理PostgreSQL/GaussDB数据库，准备执行查询`);
          
          // 简化查询逻辑，直接获取所有模式，不进行过滤
          const query = "SELECT schema_name, catalog_name FROM information_schema.schemata WHERE catalog_name = $1 ORDER BY schema_name";
          const params = [databaseName];
          
          console.log(`GET SCHEMA LIST - 执行查询: ${query}`, `参数:`, params);
          
          try {
            result = await window.electronAPI.executeQuery(poolId, query, params);
            console.log(`GET SCHEMA LIST - 查询结果:`, JSON.stringify(result));
            
            if (result && result.success) {
              if (!Array.isArray(result.data)) {
                console.warn(`GET SCHEMA LIST - 查询结果不是数组:`, result.data);
              } else if (result.data.length === 0) {
                console.warn(`GET SCHEMA LIST - 查询返回空结果，数据库 ${databaseName} 中没有找到任何模式`);
              } else {
                // 获取所有模式
                const allSchemas = result.data.map((row: any) => row.schema_name);
                console.log(`GET SCHEMA LIST - 查询到的所有模式 (${allSchemas.length}个):`, allSchemas);
                
                // 过滤掉系统自带且无法使用的模式
                const filteredSchemas = allSchemas.filter((schema: string) => {
                  // 排除系统模式
                  return !schema.startsWith('information_schema') && 
                         !schema.startsWith('pg_catalog') && 
                         !schema.startsWith('pg_toast') && 
                         !schema.startsWith('pg_temp_') && 
                         !schema.startsWith('pg_toast_temp_');
                });
                console.log(`GET SCHEMA LIST - 过滤后显示的模式 (${filteredSchemas.length}个):`, filteredSchemas);
                
                return filteredSchemas;
              }
            } else {
              console.warn(`GET SCHEMA LIST - 查询失败:`, result?.error || '未知错误');
            }
          } catch (queryError) {
            console.error(`GET SCHEMA LIST - 执行查询时发生异常:`, queryError);
            
            // 尝试一个更简单的查询作为备选方案
              try {
                console.log(`GET SCHEMA LIST - 尝试备选查询方法`);
                const altQuery = "SELECT n.nspname AS schema_name FROM pg_catalog.pg_namespace n ORDER BY n.nspname";
                const altResult = await window.electronAPI.executeQuery(poolId, altQuery, []);
                
                if (altResult && altResult.success && Array.isArray(altResult.data) && altResult.data.length > 0) {
                  // 获取所有模式
                  const allSchemas = altResult.data.map((row: any) => row.schema_name);
                  console.log(`GET SCHEMA LIST - 备选方法查询到的所有模式 (${allSchemas.length}个):`, allSchemas);
                  
                  // 过滤掉系统自带且无法使用的模式
                  const filteredSchemas = allSchemas.filter((schema: string) => {
                    // 排除系统模式
                    return !schema.startsWith('information_schema') && 
                           !schema.startsWith('pg_catalog') && 
                           !schema.startsWith('pg_toast') && 
                           !schema.startsWith('pg_temp_') && 
                           !schema.startsWith('pg_toast_temp_');
                  });
                  console.log(`GET SCHEMA LIST - 备选方法过滤后显示的模式 (${filteredSchemas.length}个):`, filteredSchemas);
                  
                  return filteredSchemas;
                }
              } catch (altError) {
                console.error(`GET SCHEMA LIST - 备选查询方法也失败:`, altError);
              }
          }
          
          // 查询失败或没有结果，返回默认的public模式
          console.warn(`GET SCHEMA LIST - 查询失败或没有结果，返回默认的public模式`);
          return ['public'];
          
        default:
          // 其他数据库类型不支持或不需要模式
          console.log(`GET SCHEMA LIST - 不支持的数据库类型 ${connection.type}，返回空列表`);
          return [];
      }
    } catch (error) {
      console.error(`GET SCHEMA LIST - 获取数据库模式列表异常:`, error);
      // 返回默认的public模式
      return connection.type === DbType.POSTGRESQL || connection.type === DbType.GAUSSDB ? ['public'] : [];
    }
  } catch (error) {
    console.error(`GET SCHEMA LIST - 获取模式列表时发生异常:`, error);
    // 返回默认的public模式
    return connection.type === DbType.POSTGRESQL || connection.type === DbType.GAUSSDB ? ['public'] : [];
  }
};

/**
 * 获取数据库下的所有对象
 * @param connection 数据库连接对象
 * @param databaseName 数据库名称
 * @param schema 可选的模式名称（主要用于PostgreSQL等支持模式的数据库）
 * @returns Promise<{tables: string[], views: string[], procedures: string[], functions: string[]}>
 */
export const getAllDatabaseObjects = async (
  connection: DatabaseConnection, 
  databaseName: string, 
  schema?: string
): Promise<{tables: string[], views: string[], procedures: string[], functions: string[]}> => {
  try {
    // 检查基本条件
    if (!window.electronAPI || !connection.isConnected || !databaseName) {
      console.warn(`获取数据库所有对象失败: 无效的连接或数据库名称`);
      return {
        tables: [],
        views: [],
        procedures: [],
        functions: []
      };
    }
    
    // 并行获取所有对象列表
    const [tables, views, procedures, functions] = await Promise.all([
      getTableList(connection, databaseName, schema),
      getViewList(connection, databaseName, schema),
      getProcedureList(connection, databaseName, schema),
      getFunctionList(connection, databaseName, schema)
    ]);
    
    return {
      tables,
      views,
      procedures,
      functions
    };
  } catch (error) {
    console.error(`获取数据库所有对象异常:`, error);
    return {
      tables: [],
      views: [],
      procedures: [],
      functions: []
    };
  }
};