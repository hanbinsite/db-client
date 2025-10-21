import { DatabaseConnection } from '../types';
import { execRedisQueued, execRedisQueuedWithTimeout } from './redis-exec-queue';
import { RedisDbUtils } from './db/redis';
import { MySqlDbUtils } from './db/mysql';
import { PostgresDbUtils } from './db/postgresql';
import { GaussDbUtils } from './db/gauss';
import { OracleDbUtils } from './db/oracle';
import { SqliteDbUtils } from './db/sqlite';
import { getDbUtils } from './db';

const COMMAND_TIMEOUT_MS = 8000;
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
  // 委托至按类型实现的工具类，保持原有逻辑不变
  const impl = new MySqlDbUtils();
  return impl.getDatabases(connection);
};

/**
 * 获取PostgreSQL数据库列表
 * @param connection 数据库连接对象
 * @returns Promise<DatabaseItem[]> 数据库列表
 */
export async function getPostgreSqlDatabases(connection: DatabaseConnection): Promise<DatabaseItem[]> {
  // 委托至按类型实现的工具类，保持原有逻辑不变
  const impl = new PostgresDbUtils();
  return impl.getDatabases(connection);
}

export async function getGaussDBDatabases(connection: DatabaseConnection): Promise<DatabaseItem[]> {
  // 委托至按类型实现的工具类，保持原有逻辑不变
  const impl = new GaussDbUtils();
  return impl.getDatabases(connection);
}

export async function getOracleDatabases(connection: DatabaseConnection): Promise<DatabaseItem[]> {
  // 委托至按类型实现的工具类，保持原有逻辑不变
  const impl = new OracleDbUtils();
  return impl.getDatabases(connection);
}

export async function getSqliteDatabases(connection: DatabaseConnection): Promise<DatabaseItem[]> {
  // 委托至按类型实现的工具类，保持原有逻辑不变
  const impl = new SqliteDbUtils();
  return impl.getDatabases(connection);
}

export async function getRedisDatabases(connection: DatabaseConnection): Promise<DatabaseItem[]> {
  // 委托至按类型实现的工具类，保持原有逻辑不变
  const impl = new RedisDbUtils();
  return impl.getDatabases(connection);
}

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
    const impl = getDbUtils(connection.type);
    return await impl.getTables(connection, databaseName, schema);
  } catch (error) {
    console.error('获取数据库表列表异常:', error);
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
    const impl = getDbUtils(connection.type);
    return await impl.getViews(connection, databaseName, schema);
  } catch (error) {
    console.error('获取数据库视图列表异常:', error);
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
    const impl = getDbUtils(connection.type);
    return await impl.getProcedures(connection, databaseName, schema);
  } catch (error) {
    console.error('获取数据库存储过程列表异常:', error);
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
    const impl = getDbUtils(connection.type);
    return await impl.getFunctions(connection, databaseName, schema);
  } catch (error) {
    console.error('获取数据库函数列表异常:', error);
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
  try {
    const impl = getDbUtils(connection.type);
    return await impl.getSchemas(connection, databaseName);
  } catch (error) {
    console.error('GET SCHEMA LIST - 获取模式列表异常:', error);
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