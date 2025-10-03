import { DatabaseConnection } from '../types';

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
  
  // 缓存键 - 用于临时缓存查询结果
  const cacheKey = `${connection.id}_${connection.type}_databases`;
  
  // 存储最后一次失败的错误信息
  let lastError: any = null;
  
  try {
    console.log('===== 开始获取数据库列表 =====');
    console.log('连接信息:', { type: connection.type, host: connection.host, port: connection.port, id: connection.id });
    
    // 检查基本条件
  if (!window.electronAPI) {
    console.error('DATABASE UTILS - 错误: electronAPI不可用，无法获取真实数据库列表');
    // 开发测试时使用模拟数据
    return getDefaultDatabases();
  }
  
  // 优化处理：即使connection.connectionId为空，也尝试使用备用方法
  if (!connection.connectionId) {
    console.warn('DATABASE UTILS - 警告: connection.connectionId为空，尝试使用备用方法获取数据库列表');
    console.log('连接对象详情:', { id: connection.id, name: connection.name, type: connection.type, host: connection.host });
    
    // 直接使用特定数据库类型的备用方法
    const fallbackResult = await getDatabasesWithFallbackMethod(connection);
    
    // 如果备用方法成功获取到数据库列表，返回它
    if (fallbackResult && fallbackResult.length > 0) {
      console.log(`备用方法成功获取数据库列表，数量: ${fallbackResult.length}`);
      return fallbackResult;
    }
    
    // 如果备用方法也失败，但有配置数据库，使用配置的数据库
    if (connection.database) {
      console.log('备用方法失败，但连接配置中有数据库名称，使用配置的数据库:', connection.database);
      return [{ name: connection.database }];
    }
    
    // 所有方法都失败时，返回模拟数据
    console.warn('所有备用方法都失败，返回模拟数据库列表');
    return getDefaultDatabases();
  }
  
  if (!connection.isConnected) {
    console.warn('DATABASE UTILS - 警告: 连接未标记为已连接，但尝试获取真实数据库列表');
    console.log('连接对象详情:', { connectionId: connection.connectionId, id: connection.id, name: connection.name });
  }
    
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
          } else if (retries < MAX_RETRIES) {
            console.warn(`获取数据库列表失败，准备重试...`);
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
        
        if (retries < MAX_RETRIES) {
          console.warn(`准备重试获取数据库列表...`);
          retries++;
          await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL_MS));
        } else {
          console.error(`达到最大重试次数(${MAX_RETRIES})，获取数据库列表失败。最后错误:`, error);
        }
      }
    }
    
    // 3. 最后兜底：如果所有方法都失败且有配置数据库，使用配置的数据库
    if ((!result || result.length === 0) && connection.database) {
      console.log('DATABASE UTILS - 获取到的数据库列表为空，但连接配置中有数据库名称，使用配置的数据库:', connection.database);
      result = [{ name: connection.database }];
    } else if (!result || result.length === 0) {
      // 记录明确的失败信息
      const errorMessage = lastError ? 
        `DATABASE UTILS - 警告: 获取数据库列表失败，最大重试次数(${MAX_RETRIES})已达。错误原因: ${lastError.message || String(lastError)}` : 
        `DATABASE UTILS - 警告: 获取数据库列表为空`;
      
      console.warn(errorMessage);
    }
    
    // 去重和排序处理
    result = result.filter((db, index, self) => 
      index === self.findIndex((t) => t.name === db.name)
    ).sort((a, b) => a.name.localeCompare(b.name));
    
    console.log(`最终获取的数据库列表数量: ${result.length}`);
    console.log('===== 获取数据库列表完成 =====');
    
    return result;
  } catch (error) {
    console.error('DATABASE UTILS - 获取数据库列表时发生异常:', error);
    // 发生异常时的兜底处理
    if (connection.database) {
      console.log('DATABASE UTILS - 发生异常，但连接配置中有数据库名称，使用配置的数据库:', connection.database);
      return [{ name: connection.database }];
    }
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
    // 如果有配置的数据库名，返回它
    if (connection.database) {
      return [{ name: connection.database, tables: [], views: [], procedures: [], functions: [], schemas: [] }];
    }
    return [];
  }

  // 使用连接池ID，如果不存在则尝试创建一个新的连接池
  let poolId: string | undefined = connection.connectionId;
  
  // 连接状态检查改为警告，而不是阻止操作
  if (!connection.connectionId) {
    console.warn('MySQL数据库 - connection.connectionId为空，尝试创建新的连接池');
    
    try {
      // 尝试通过connectDatabase创建新的连接池
      const connectResult = await window.electronAPI.connectDatabase(connection);
      if (connectResult && connectResult.success && connectResult.connectionId) {
        poolId = connectResult.connectionId;
        console.log('成功创建新的连接池，ID:', poolId);
      } else {
        // 如果创建失败，回退到原始连接ID
        poolId = connection.id;
        console.warn('创建连接池失败，回退到使用connection.id作为替代');
      }
    } catch (error) {
      poolId = connection.id;
      console.warn('创建连接池时发生错误，回退到使用connection.id作为替代:', error);
    }
  }
  
  if (!connection.isConnected) {
    console.warn('MySQL数据库 - 连接未标记为已连接，但尝试获取数据库列表');
  }

  // 确保poolId不是undefined
  if (!poolId) {
    poolId = connection.id;
    console.warn('最终回退到使用connection.id作为poolId:', poolId);
  }

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
          
          // 尝试使用连接配置中的数据库名称作为备用选项
          if (connection.database) {
            console.log(`备用方案全部失败，但连接配置中有数据库名称(${connection.database})，返回该数据库`);
            return [{ 
              name: connection.database,
              tables: [],
              views: [],
              procedures: [],
              functions: [],
              schemas: []
            }];
          }
          
          return [];
        }
      } catch (sqlError) {
        console.error('执行SHOW DATABASES SQL查询时发生异常:', sqlError);
        
        // 异常情况下也尝试使用连接配置中的数据库名称
        if (connection.database) {
          console.log(`SQL查询异常，但连接配置中有数据库名称(${connection.database})，返回该数据库`);
          return [{ 
            name: connection.database,
            tables: [],
            views: [],
            procedures: [],
            functions: [],
            schemas: []
          }];
        }
        
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
        
        // 尝试使用连接配置中的数据库名称
        if (connection.database) {
          console.log(`异常情况下所有备用方案都失败，但连接配置中有数据库名称(${connection.database})，返回该数据库`);
          return [{ 
            name: connection.database,
            tables: [],
            views: [],
            procedures: [],
            functions: [],
            schemas: []
          }];
        }
      }
    } catch (sqlError) {
      console.error('备用方案执行也失败:', sqlError);
      
      // 尝试使用连接配置中的数据库名称
      if (connection.database) {
        console.log(`所有方法都失败，但连接配置中有数据库名称(${connection.database})，返回该数据库`);
        return [{ 
          name: connection.database,
          tables: [],
          views: [],
          procedures: [],
          functions: [],
          schemas: []
        }];
      }
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

  // 使用真实的连接池ID，如果不存在则回退到原始连接ID
  const poolId = connection.connectionId || connection.id;

  try {
    // 检查连接ID是否有效
    if (!poolId) {
      console.error('PostgreSQL数据库连接ID不存在，无法获取数据库列表');
      // 尝试使用连接配置中的数据库名称作为备用选项
      if (connection.database) {
        console.log(`连接ID无效，但连接配置中有数据库名称(${connection.database})，返回该数据库`);
        return [{ 
          name: connection.database,
          tables: [],
          views: [],
          procedures: [],
          functions: [],
          schemas: []
        }];
      }
      return [];
    }

    console.log('执行PostgreSQL listDatabases调用，连接池ID:', poolId);
    // PostgreSQL获取数据库列表的特定方法
    const dbListResult = await window.electronAPI.listDatabases(poolId);
    
    console.log('PostgreSQL listDatabases返回结果:', JSON.stringify(dbListResult, null, 2));
    
    if (dbListResult && dbListResult.success && Array.isArray(dbListResult.data)) {
      const databases = dbListResult.data.map((dbName: string) => ({
        name: dbName,
        // 预填充空数组，避免后续访问undefined
        tables: [],
        views: [],
        procedures: [],
        functions: [],
        schemas: []
      }));
      console.log('返回的PostgreSQL数据库列表:', databases);
      console.log('===== 获取PostgreSQL数据库列表完成 =====');
      return databases;
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
      
      console.error(`PostgreSQL listDatabases方法失败，原因: ${failureReason}，尝试使用SQL查询作为备用方案`);
      
      // 使用SQL查询作为备用方案
      try {
        // PostgreSQL获取数据库列表的SQL语句
        const sqlResult = await window.electronAPI.executeQuery(poolId, 
          "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname");
        
        console.log('PostgreSQL SQL查询结果:', JSON.stringify(sqlResult, null, 2));
        
        if (sqlResult && sqlResult.success && Array.isArray(sqlResult.data)) {
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
          
          console.log('备用方案返回的PostgreSQL数据库项数量:', databaseItems.length);
          console.log('===== 获取PostgreSQL数据库列表完成 =====');
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
          
          console.error(`备用方案获取PostgreSQL数据库列表也失败，原因: ${sqlFailureReason}`);
          
          // 尝试使用连接配置中的数据库名称作为备用选项
          if (connection.database) {
            console.log(`备用方案全部失败，但连接配置中有数据库名称(${connection.database})，返回该数据库`);
            return [{ 
              name: connection.database,
              tables: [],
              views: [],
              procedures: [],
              functions: [],
              schemas: []
            }];
          }
          
          return [];
        }
      } catch (sqlError) {
        console.error('执行PostgreSQL SQL查询时发生异常:', sqlError);
        
        // 异常情况下也尝试使用连接配置中的数据库名称
        if (connection.database) {
          console.log(`SQL查询异常，但连接配置中有数据库名称(${connection.database})，返回该数据库`);
          return [{ 
            name: connection.database,
            tables: [],
            views: [],
            procedures: [],
            functions: [],
            schemas: []
          }];
        }
        
        return [];
      }
    }
  } catch (error) {
    console.error('调用electronAPI获取PostgreSQL数据库列表异常:', error);
    
    try {
      // 异常情况下也尝试备用方案
      console.log('发生异常，尝试使用SQL查询作为备用方案');
      const sqlResult = await window.electronAPI.executeQuery(poolId, 
        "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname");
      
      if (sqlResult && sqlResult.success && Array.isArray(sqlResult.data)) {
        const databaseItems = sqlResult.data.map((row: any) => ({
          name: row.datname,
          tables: [],
          views: [],
          procedures: [],
          functions: [],
          schemas: []
        }));
        
        console.log('异常情况下备用方案返回的PostgreSQL数据库项数量:', databaseItems.length);
        return databaseItems;
      } else {
        console.error('异常情况下备用方案也失败:', sqlResult);
        
        // 尝试使用连接配置中的数据库名称
        if (connection.database) {
          console.log(`异常情况下所有备用方案都失败，但连接配置中有数据库名称(${connection.database})，返回该数据库`);
          return [{ 
            name: connection.database,
            tables: [],
            views: [],
            procedures: [],
            functions: [],
            schemas: []
          }];
        }
      }
    } catch (sqlError) {
      console.error('备用方案执行也失败:', sqlError);
      
      // 尝试使用连接配置中的数据库名称
      if (connection.database) {
        console.log(`所有方法都失败，但连接配置中有数据库名称(${connection.database})，返回该数据库`);
        return [{ 
          name: connection.database,
          tables: [],
          views: [],
          procedures: [],
          functions: [],
          schemas: []
        }];
      }
    }
    
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
const getRedisDatabases = async (connection: DatabaseConnection): Promise<DatabaseItem[]> => {
  try {
    // Redis获取数据库列表的特定方法
    const result = await window.electronAPI.executeQuery(
      connection.id, 
      "INFO keyspace"
    );
    
    if (result && result.success) {
      const databases: DatabaseItem[] = [];
      // 解析INFO keyspace输出
      if (typeof result.data === 'string') {
        const lines = result.data.split('\n');
        lines.forEach((line: string) => {
            if (line.startsWith('db')) {
              const dbName = line.split(':')[0];
              databases.push({ name: dbName });
            }
          });
      }
      return databases.length > 0 ? databases : [];
    } else {
      console.error('获取Redis数据库列表失败', result);
      return [];
    }
  } catch (error) {
    console.error('调用electronAPI获取Redis数据库列表失败', error);
    return [];
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
      // 对于SQLite，如果无法获取真实数据，至少返回配置中指定的数据库
      return [{ name: connection.database || 'main' }];
    }
  } catch (error) {
    console.error('调用electronAPI获取SQLite数据库列表失败', error);
    // 对于SQLite，如果无法获取真实数据，至少返回配置中指定的数据库
    return [{ name: connection.database || 'main' }];
  }
};

/**
 * 获取默认数据库列表（当无法获取真实数据时使用）
 * @returns DatabaseItem[]
 */
export const getDefaultDatabases = (): DatabaseItem[] => {
  console.log('===== 调用getDefaultDatabases获取默认数据库列表 =====');
  const defaultDbs = [
    {
      name: 'products', 
      tables: ['product_info', 'categories', 'brands', 'suppliers'],
      views: ['product_stock_view'],
      procedures: ['update_product_price'],
      functions: ['calculate_discount']
    },
    {
      name: 'orders', 
      tables: ['order_header', 'order_items', 'shipping_addresses', 'payment_details'],
      views: ['order_summary'],
      procedures: ['process_new_order'],
      functions: ['calculate_tax']
    },
    {
      name: 'users', 
      tables: ['user_profiles', 'contact_info', 'user_roles', 'permissions'],
      views: ['active_users'],
      procedures: ['create_new_user'],
      functions: ['check_user_status']
    },
    {
      name: 'inventory', 
      tables: ['stock_levels', 'warehouses', 'transactions', 'locations'],
      views: ['low_stock_items'],
      procedures: ['update_inventory'],
      functions: ['reorder_point_calculator']
    }
  ];
  console.log('返回默认数据库列表:', defaultDbs);
  console.log('===== 获取默认数据库列表完成 =====');
  return defaultDbs;
};

/**
 * 获取数据库下的表列表
 * @param connection 数据库连接对象
 * @param databaseName 数据库名称
 * @param schema 可选的模式名称（主要用于PostgreSQL等支持模式的数据库）
 * @returns Promise<string[]>
 */
export const getTableList = async (connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> => {
  // 检查基本条件
  if (!window.electronAPI) {
    return [];
  }
  
  // 使用连接池ID，如果不存在则回退到原始连接ID
  const poolId = connection.connectionId || connection.id;
  
  // 连接状态检查改为警告，而不是阻止操作
  if (!connection.connectionId) {
    console.warn(`${connection.type}数据库 - connection.connectionId为空，尝试使用connection.id作为替代`);
  }
  
  if (!connection.isConnected) {
    console.warn(`${connection.type}数据库 - 连接未标记为已连接，但尝试获取表列表`);
  }

  try {
    let result: any;
    
    switch (connection.type) {
      case DbType.MYSQL:
        // MySQL: 先切换数据库，然后获取表列表
        await window.electronAPI.executeQuery(poolId, `USE \`${databaseName}\``);
        result = await window.electronAPI.executeQuery(poolId, "SHOW TABLES");
        if (result && result.success && Array.isArray(result.data)) {
          return result.data.map((row: any) => Object.values(row)[0]);
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
    
    console.warn(`获取${connection.type}数据库表列表失败`);
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
 * @returns Promise<string[]>
 */
export const getViewList = async (connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> => {
  // 检查基本条件
  if (!window.electronAPI) {
    return [];
  }
  
  // 使用连接池ID，如果不存在则回退到原始连接ID
  const poolId = connection.connectionId || connection.id;
  
  // 连接状态检查改为警告，而不是阻止操作
  if (!connection.connectionId) {
    console.warn(`${connection.type}数据库 - connection.connectionId为空，尝试使用connection.id作为替代`);
  }
  
  if (!connection.isConnected) {
    console.warn(`${connection.type}数据库 - 连接未标记为已连接，但尝试获取视图列表`);
  }
  
  try {
    let result: any;
    
    switch (connection.type) {
      case DbType.MYSQL:
        // MySQL: 先切换数据库，然后获取视图列表
        await window.electronAPI.executeQuery(poolId, `USE \`${databaseName}\``);
        result = await window.electronAPI.executeQuery(poolId, "SHOW FULL TABLES WHERE table_type LIKE 'VIEW' ");
        if (result && result.success && Array.isArray(result.data)) {
          return result.data.map((row: any) => Object.values(row)[0]);
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
    
    console.warn(`获取${connection.type}数据库视图列表失败`);
    return [];
  } catch (error) {
    console.error(`获取数据库视图列表异常:`, error);
    return [];
  }
};

/**
 * 获取数据库下的存储过程列表
 * @param connection 数据库连接对象
 * @param databaseName 数据库名称
 * @param schema 可选的模式名称（主要用于PostgreSQL等支持模式的数据库）
 * @returns Promise<string[]>
 */
export const getProcedureList = async (connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> => {
  // 检查基本条件
  if (!window.electronAPI) {
    return [];
  }
  
  // 使用连接池ID，如果不存在则回退到原始连接ID
  const poolId = connection.connectionId || connection.id;
  
  // 连接状态检查改为警告，而不是阻止操作
  if (!connection.connectionId) {
    console.warn(`${connection.type}数据库 - connection.connectionId为空，尝试使用connection.id作为替代`);
  }
  
  if (!connection.isConnected) {
    console.warn(`${connection.type}数据库 - 连接未标记为已连接，但尝试获取存储过程列表`);
  }
  
  try {
    let result: any;
    
    switch (connection.type) {
      case DbType.MYSQL:
        // MySQL: 先切换数据库，然后获取存储过程列表
        result = await window.electronAPI.executeQuery(poolId, "SHOW PROCEDURE STATUS WHERE db = ?", [databaseName]);
        if (result && result.success && Array.isArray(result.data)) {
          return result.data.map((row: any) => row.Name);
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
    
    console.warn(`获取${connection.type}数据库存储过程列表失败`);
    return [];
  } catch (error) {
    console.error(`获取数据库存储过程列表异常:`, error);
    return [];
  }
};

/**
 * 获取数据库下的函数列表
 * @param connection 数据库连接对象
 * @param databaseName 数据库名称
 * @param schema 可选的模式名称（主要用于PostgreSQL等支持模式的数据库）
 * @returns Promise<string[]>
 */
export const getFunctionList = async (connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> => {
  // 检查基本条件
  if (!window.electronAPI) {
    return [];
  }
  
  // 使用连接池ID，如果不存在则回退到原始连接ID
  const poolId = connection.connectionId || connection.id;
  
  // 连接状态检查改为警告，而不是阻止操作
  if (!connection.connectionId) {
    console.warn(`${connection.type}数据库 - connection.connectionId为空，尝试使用connection.id作为替代`);
  }
  
  if (!connection.isConnected) {
    console.warn(`${connection.type}数据库 - 连接未标记为已连接，但尝试获取函数列表`);
  }
  
  try {
    let result: any;
    
    switch (connection.type) {
      case DbType.MYSQL:
        // MySQL: 先切换数据库，然后获取函数列表
        result = await window.electronAPI.executeQuery(poolId, "SHOW FUNCTION STATUS WHERE db = ?", [databaseName]);
        if (result && result.success && Array.isArray(result.data)) {
          return result.data.map((row: any) => row.Name);
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
        // SQLite: 查询所有函数
        result = await window.electronAPI.executeQuery(
          poolId, 
          "SELECT name FROM sqlite_master WHERE type='view'"
        );
        if (result && result.success && Array.isArray(result.data)) {
          return result.data.map((row: any) => row.name);
        }
        break;
    }
    
    console.warn(`获取${connection.type}数据库函数列表失败`);
    return [];
  } catch (error) {
    console.error(`获取数据库函数列表异常:`, error);
    return [];
  }
};

/**
 * 获取数据库下的模式列表
 * @param connection 数据库连接对象
 * @param databaseName 数据库名称
 * @returns Promise<string[]>
 */
export const getSchemaList = async (connection: DatabaseConnection, databaseName: string): Promise<string[]> => {
  // 使用真实的连接池ID，如果不存在则回退到原始连接ID
  const poolId = connection.connectionId || connection.id;
  
  if (!window.electronAPI || !poolId || !connection.isConnected) {
    return [];
  }

  try {
    let result: any;
    
    switch (connection.type) {
      case DbType.POSTGRESQL:
      case DbType.GAUSSDB:
        // PostgreSQL/GaussDB: 切换到指定数据库，然后获取模式列表
        await window.electronAPI.executeQuery(poolId, `\c ${databaseName}`);
        result = await window.electronAPI.executeQuery(
          poolId, 
          "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT LIKE 'pg_%' AND schema_name != 'information_schema'"
        );
        if (result && result.success && Array.isArray(result.data)) {
          return result.data.map((row: any) => row.schema_name);
        }
        break;
        
      default:
        // 其他数据库类型不支持或不需要模式
        return [];
    }
    
    console.warn(`获取${connection.type}数据库模式列表失败`);
    return [];
  } catch (error) {
    console.error(`获取数据库模式列表异常:`, error);
    return [];
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
  // 使用真实的连接池ID，如果不存在则回退到原始连接ID
  const poolId = connection.connectionId || connection.id;
  
  try {
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