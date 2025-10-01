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
}

/**
 * 获取数据库列表的工厂函数，根据数据库类型调用对应的方法
 * @param connection 数据库连接对象
 * @returns Promise<DatabaseItem[]>
 */
export const getDatabaseList = async (connection: DatabaseConnection): Promise<DatabaseItem[]> => {
  try {
    switch (connection.type) {
      case DbType.MYSQL:
        return getMysqlDatabases(connection);
      case DbType.POSTGRESQL:
        return getPostgreSqlDatabases(connection);
      case DbType.ORACLE:
        return getOracleDatabases(connection);
      case DbType.GAUSSDB:
        return getGaussDBDatabases(connection);
      case DbType.REDIS:
        return getRedisDatabases(connection);
      case DbType.SQLITE:
        return getSqliteDatabases(connection);
      default:
        console.warn(`不支持的数据库类型: ${connection.type}`);
        return getDefaultDatabases();
    }
  } catch (error) {
    console.error('获取数据库列表失败:', error);
    return getDefaultDatabases();
  }
};

/**
 * 获取MySQL数据库列表
 * @param connection 数据库连接对象
 * @returns Promise<DatabaseItem[]>
 */
const getMysqlDatabases = async (connection: DatabaseConnection): Promise<DatabaseItem[]> => {
  if (!window.electronAPI || !connection.id || !connection.isConnected) {
    return getDefaultDatabases();
  }

  try {
    // 调用electronAPI获取数据库列表
    const dbListResult = await window.electronAPI.listDatabases(connection.id);
    
    if (dbListResult && dbListResult.success && Array.isArray(dbListResult.data)) {
      // 将简单的字符串数组转换为DatabaseItem对象数组
      return dbListResult.data.map((dbName: string) => ({
        name: dbName
      }));
    } else {
      console.warn('获取MySQL数据库列表失败，使用默认数据', dbListResult);
      return getDefaultDatabases();
    }
  } catch (error) {
    console.warn('调用electronAPI获取MySQL数据库列表失败', error);
    return getDefaultDatabases();
  }
};

/**
 * 获取PostgreSQL数据库列表
 * @param connection 数据库连接对象
 * @returns Promise<DatabaseItem[]>
 */
const getPostgreSqlDatabases = async (connection: DatabaseConnection): Promise<DatabaseItem[]> => {
  if (!window.electronAPI || !connection.id || !connection.isConnected) {
    return getDefaultDatabases();
  }

  try {
    // PostgreSQL获取数据库列表的特定方法
    // 这里假设listDatabases方法可以处理PostgreSQL，但实际可能需要不同的实现
    const dbListResult = await window.electronAPI.listDatabases(connection.id);
    
    if (dbListResult && dbListResult.success && Array.isArray(dbListResult.data)) {
      return dbListResult.data.map((dbName: string) => ({
        name: dbName
      }));
    } else {
      console.warn('获取PostgreSQL数据库列表失败，使用默认数据', dbListResult);
      return getDefaultDatabases();
    }
  } catch (error) {
    console.warn('调用electronAPI获取PostgreSQL数据库列表失败', error);
    return getDefaultDatabases();
  }
};

/**
 * 获取Oracle数据库列表
 * @param connection 数据库连接对象
 * @returns Promise<DatabaseItem[]>
 */
const getOracleDatabases = async (connection: DatabaseConnection): Promise<DatabaseItem[]> => {
  if (!window.electronAPI || !connection.id || !connection.isConnected) {
    // Oracle数据库通常使用SID或服务名，这里提供默认数据
    return [
      {
        name: connection.database || 'ORCL',
        tables: ['EMPLOYEES', 'DEPARTMENTS', 'JOBS', 'LOCATIONS'],
        views: ['EMP_DETAILS_VIEW'],
        procedures: ['GET_EMPLOYEE_DETAILS'],
        functions: ['CALC_BONUS']
      }
    ];
  }

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
      console.warn('获取Oracle数据库列表失败，使用默认数据', result);
      return [
        {
          name: connection.database || 'ORCL',
          tables: ['EMPLOYEES', 'DEPARTMENTS', 'JOBS', 'LOCATIONS'],
          views: ['EMP_DETAILS_VIEW'],
          procedures: ['GET_EMPLOYEE_DETAILS'],
          functions: ['CALC_BONUS']
        }
      ];
    }
  } catch (error) {
    console.warn('调用electronAPI获取Oracle数据库列表失败', error);
    return [
      {
        name: connection.database || 'ORCL',
        tables: ['EMPLOYEES', 'DEPARTMENTS', 'JOBS', 'LOCATIONS'],
        views: ['EMP_DETAILS_VIEW'],
        procedures: ['GET_EMPLOYEE_DETAILS'],
        functions: ['CALC_BONUS']
      }
    ];
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
  if (!window.electronAPI || !connection.id || !connection.isConnected) {
    // Redis数据库通常用数字索引表示
    return [
      { name: 'db0' },
      { name: 'db1' },
      { name: 'db2' },
      { name: 'db3' }
    ];
  }

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
      return databases.length > 0 ? databases : [
        { name: 'db0' },
        { name: 'db1' },
        { name: 'db2' },
        { name: 'db3' }
      ];
    } else {
      console.warn('获取Redis数据库列表失败，使用默认数据', result);
      return [
        { name: 'db0' },
        { name: 'db1' },
        { name: 'db2' },
        { name: 'db3' }
      ];
    }
  } catch (error) {
    console.warn('调用electronAPI获取Redis数据库列表失败', error);
    return [
      { name: 'db0' },
      { name: 'db1' },
      { name: 'db2' },
      { name: 'db3' }
    ];
  }
};

/**
 * 获取SQLite数据库列表
 * @param connection 数据库连接对象
 * @returns Promise<DatabaseItem[]>
 */
const getSqliteDatabases = async (connection: DatabaseConnection): Promise<DatabaseItem[]> => {
  // SQLite是文件数据库，通常只有一个数据库
  return [
    {
      name: connection.database || 'main',
      tables: ['users', 'products', 'orders', 'categories'],
      views: ['product_summary'],
      procedures: [],
      functions: []
    }
  ];
};

/**
 * 获取默认数据库列表（当无法获取真实数据时使用）
 * @returns DatabaseItem[]
 */
export const getDefaultDatabases = (): DatabaseItem[] => {
  return [
    {
      name: 'information_schema', 
      tables: ['tables', 'columns', 'schemata', 'views', 'routines'],
      views: ['table_privileges', 'column_privileges'],
      procedures: ['get_table_stats'],
      functions: ['get_database_size']
    },
    {
      name: 'mysql', 
      tables: ['user', 'db', 'tables_priv', 'columns_priv'],
      views: ['user_privileges'],
      procedures: ['sp_adduser'],
      functions: ['fn_getuserinfo']
    },
    {
      name: 'performance_schema', 
      tables: ['events_waits_current', 'file_instances', 'threads'],
      views: ['events_waits_summary_by_thread_by_event_name'],
      procedures: ['ps_setup_reset_to_default'],
      functions: ['ps_statement_avg_latency']
    },
    {
      name: 'sys', 
      tables: ['schema_table_statistics', 'statement_analysis'],
      views: ['schema_auto_increment_columns'],
      procedures: ['diagnostics'],
      functions: ['format_bytes']
    }
  ];
};