import { EventEmitter } from 'events';

// 数据库连接工厂接口
interface IDatabaseConnectionFactory {
  createConnection(config: DatabaseConnection): IDatabaseConnection;
  getSupportedTypes(): DatabaseType[];
}

// 数据库连接接口
interface IDatabaseConnection {
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  executeQuery(query: string, params?: any[]): Promise<QueryResult>;
  getDatabaseInfo(): Promise<DatabaseInfo>;
  getTableStructure(tableName: string): Promise<TableStructure>;
}

// 连接池状态接口
interface IConnectionPoolStatus {
  maxConnections: number;
  minConnections: number;
  acquireTimeout: number;
  idleTimeout: number;
  testOnBorrow: boolean;
}

// 连接池配置接口
interface IConnectionPoolConfig {
  maxConnections: number;
  minConnections: number;
  acquireTimeout: number;
  idleTimeout: number;
  testOnBorrow: boolean;
}

// 数据库类型
type DatabaseType = 'mysql' | 'postgresql' | 'oracle' | 'gaussdb' | 'redis' | 'sqlite';

// 数据库连接
interface DatabaseConnection {
  type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database?: string;
  ssl?: boolean;
  timeout?: number;
  authType?: 'username_password' | 'password';
}

// 查询结果
interface QueryResult {
  success: boolean;
  data?: any[];
  columns?: string[];
  rowCount?: number;
  executionTime?: number;
  error?: string; // 失败时的错误信息
}

// 数据库信息
interface DatabaseInfo {
  version: string;
  uptime: number;
  connections: number;
  storage: { total: number; used: number; free: number };
  storageInstance: { total: number; used: number; free: number };
  performance: {
    queriesPerSecond: number;
    queriesPerSecondAvg?: number;
    queriesPerSecondAvgWindowSize?: number;
    slowQueries: number;
    threadsRunning?: number;
    openTables?: number;
    innodbBufferPoolSize?: number;
    innodbBufferPoolReads?: number;
    innodbBufferPoolWriteRequests?: number;
    innodbBufferPoolReadRequests?: number;
  };
}

// 表结构
interface TableStructure {
  name: string;
  schema?: string;
  columns: TableColumn[];
  indexes: TableIndex[];
  foreignKeys: ForeignKey[];
  rowCount: number;
  size: number;
}

// 表列信息
interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  primaryKey: boolean;
  autoIncrement: boolean;
  comment?: string;
}

// 表索引信息
interface TableIndex {
  name: string;
  columns: string[];
  unique: boolean;
  type: string;
  comment: string;
}

// 外键信息
interface ForeignKey {
  name: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete: string;
  onUpdate: string;
}

// 抽象基类：统一持有连接与配置
abstract class BaseDatabaseConnection implements IDatabaseConnection {
  protected connection: any = null;
  protected isConnecting: boolean = false;
  protected config!: DatabaseConnection;

  setConfig(config: DatabaseConnection) { this.config = config; }
  getConfig(): DatabaseConnection { return this.config; }
  isConnected(): boolean { return !!this.connection; }

  abstract connect(): Promise<boolean>;
  abstract disconnect(): Promise<void>;
  abstract executeQuery(query: string, params?: any[]): Promise<QueryResult>;
  abstract getDatabaseInfo(): Promise<DatabaseInfo>;
  abstract getTableStructure(tableName: string): Promise<TableStructure>;
}


// MySQL 连接实现
class MySQLConnection extends BaseDatabaseConnection {
  private lastTotalQueries: number | null = null;
  private lastQueriesTimestamp: number | null = null;
  private preferredQueriesCounter: 'Queries' | 'Questions' | null = null;
  private qpsRecent: number[] = [];
  private qpsWindowSize: number = 5;

  async connect(): Promise<boolean> {
    try {
      // 重置增量QPS状态
      this.lastTotalQueries = null;
      this.lastQueriesTimestamp = null;
      this.preferredQueriesCounter = null;

      this.isConnecting = true;
      const mysql = require('mysql2/promise');
      this.connection = await mysql.createConnection({
        host: this.config.host,
        port: this.config.port,
        user: this.config.username,
        password: this.config.password,
        // 移除默认数据库参数，允许通过USE命令自由切换数据库
        ssl: this.config.ssl ? {
          // 为了解决SSL握手失败问题，我们提供更完整的SSL配置
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined // 忽略主机名验证
        } : undefined,
        connectTimeout: this.config.timeout ? this.config.timeout * 1000 : 30000
      });
      this.isConnecting = false;
      return true;
    } catch (error) {
      this.isConnecting = false;
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`MySQL连接失败: ${errorMessage}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
    }
    // 断开时清空增量QPS状态
    this.lastTotalQueries = null;
    this.lastQueriesTimestamp = null;
    this.preferredQueriesCounter = null;
  }

  async executeQuery(query: string, params?: any[]): Promise<QueryResult> {
    try {
      const startTime = Date.now();
      let rows, fields;
      
      // 根据指令类型选择执行协议：USE/SHOW/DESCRIBE/EXPLAIN 走 text 协议，其他走 prepared
      const trimmed = query.trim();
      const upper = trimmed.toUpperCase();
      if (upper.startsWith('USE ') && !trimmed.includes('?')) {
        // 优先使用 changeUser 切库，避免某些驱动/版本下 USE 对 prepared 的上下文不生效问题
        const dbPart = trimmed.replace(/;$/, '').slice(3).trim(); // 去除 'USE '
        const dbName = dbPart.replace(/^`|`$/g, '');
        await this.connection.changeUser({ database: dbName });
        rows = [];
        fields = [];
      } else if (
        upper.startsWith('SHOW ') ||
        upper.startsWith('DESCRIBE ') ||
        upper.startsWith('EXPLAIN ') ||
        // 关键：SELECT DATABASE() 强制使用 text 协议，确保读取当前会话库
        /^SELECT\s+DATABASE\(\)\b/.test(upper)
      ) {
        // 在某些 MySQL 版本下使用 prepared 可能出现上下文异常
        [rows, fields] = await this.connection.query(query);
      } else {
        // 其他命令使用 prepared statement
        [rows, fields] = await this.connection.execute(query, params || []);
      }
      
      const executionTime = Date.now() - startTime;

      return {
        success: true,
        data: Array.isArray(rows) ? rows : [rows],
        columns: fields ? fields.map((field: any) => field.name) : [],
        rowCount: Array.isArray(rows) ? rows.length : 1,
        executionTime
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  async getDatabaseInfo(): Promise<DatabaseInfo> {
    try {
      // 基本信息
      const [versionResult]: any = await this.connection.execute("SELECT VERSION() as version");
      const [uptimeResult]: any = await this.connection.execute("SHOW GLOBAL STATUS LIKE 'Uptime'");
      const [threadsConnectedResult]: any = await this.connection.execute("SHOW GLOBAL STATUS LIKE 'Threads_connected'");
      const version = versionResult?.[0]?.version || 'Unknown';
      const uptime = parseInt((uptimeResult?.[0]?.Value ?? '0') as string, 10);
      const connections = parseInt((threadsConnectedResult?.[0]?.Value ?? '0') as string, 10);

      // 性能指标：QPS、慢查询与更多状态（基于增量计算QPS）
      const [queriesResult]: any = await this.connection.execute("SHOW GLOBAL STATUS LIKE 'Queries'");
      const [questionsResult]: any = await this.connection.execute("SHOW GLOBAL STATUS LIKE 'Questions'");
      const [slowQueriesResult]: any = await this.connection.execute("SHOW GLOBAL STATUS LIKE 'Slow_queries'");
      const [threadsRunningResult]: any = await this.connection.execute("SHOW GLOBAL STATUS LIKE 'Threads_running'");
      const [openTablesResult]: any = await this.connection.execute("SHOW GLOBAL STATUS LIKE 'Open_tables'");

      const queriesVal = parseInt((queriesResult?.[0]?.Value ?? 'NaN') as string, 10);
      const questionsVal = parseInt((questionsResult?.[0]?.Value ?? 'NaN') as string, 10);
      const counterUsed: 'Queries' | 'Questions' = (!Number.isNaN(queriesVal) && queriesVal > 0) ? 'Queries' : 'Questions';
      const totalQueries = counterUsed === 'Queries'
        ? (Number.isNaN(queriesVal) ? 0 : queriesVal)
        : (Number.isNaN(questionsVal) ? 0 : questionsVal);

      const slowQueries = parseInt((slowQueriesResult?.[0]?.Value ?? '0') as string, 10);

      // 增量QPS计算，优先使用相同计数器的差值（防止在Queries和Questions之间切换导致错误）
      let queriesPerSecond = 0;
      const nowTs = Date.now();
      if (this.lastTotalQueries !== null && this.lastQueriesTimestamp !== null && this.preferredQueriesCounter === counterUsed) {
        const elapsedMs = nowTs - this.lastQueriesTimestamp;
        const delta = totalQueries - this.lastTotalQueries;
        if (elapsedMs > 0) {
          if (delta >= 0) {
            queriesPerSecond = Math.round((delta * 1000) / elapsedMs);
            // 记录样本用于短期滑动平均
            if (queriesPerSecond >= 0) {
              this.qpsRecent.push(queriesPerSecond);
              if (this.qpsRecent.length > this.qpsWindowSize) {
                this.qpsRecent = this.qpsRecent.slice(this.qpsRecent.length - this.qpsWindowSize);
              }
            }
          } else {
            // 异常保护：负delta（回绕或重启），重置基线并清空样本
            this.lastTotalQueries = totalQueries;
            this.lastQueriesTimestamp = nowTs;
            this.qpsRecent = [];
            queriesPerSecond = 0;
          }
        }
      } else {
        // 首次或计数器切换，使用基于Uptime的近似值以避免跳变
        queriesPerSecond = uptime > 0 ? Math.round(totalQueries / uptime) : 0;
        this.preferredQueriesCounter = counterUsed;
        // 初始化样本
        if (queriesPerSecond > 0) {
          this.qpsRecent = [queriesPerSecond];
        } else {
          this.qpsRecent = [];
        }
      }
      // 更新状态用于下次增量计算
      this.lastTotalQueries = totalQueries;
      this.lastQueriesTimestamp = nowTs;

      const threadsRunning = parseInt((threadsRunningResult?.[0]?.Value ?? '0') as string, 10);
      const openTables = parseInt((openTablesResult?.[0]?.Value ?? '0') as string, 10);

      // InnoDB缓冲池相关
      const [bpSizeVars]: any = await this.connection.execute("SHOW VARIABLES LIKE 'innodb_buffer_pool_size'");
      const [bpReadsResult]: any = await this.connection.execute("SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_reads'");
      const [bpReadReqResult]: any = await this.connection.execute("SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_read_requests'");
      const [bpWriteReqResult]: any = await this.connection.execute("SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_write_requests'");
      const innodbBufferPoolSize = parseInt((bpSizeVars?.[0]?.Value ?? '0') as string, 10);
      const innodbBufferPoolReads = parseInt((bpReadsResult?.[0]?.Value ?? '0') as string, 10);
      const innodbBufferPoolReadRequests = parseInt((bpReadReqResult?.[0]?.Value ?? '0') as string, 10);
      const innodbBufferPoolWriteRequests = parseInt((bpWriteReqResult?.[0]?.Value ?? '0') as string, 10);

      // 存储信息：当前数据库（schema=DATABASE()）与全实例（所有库）
      const [dbRows]: any = await this.connection.execute(
        `SELECT 
           IFNULL(SUM(DATA_LENGTH + INDEX_LENGTH), 0) AS used_bytes,
           IFNULL(SUM(DATA_FREE), 0) AS free_bytes
         FROM information_schema.tables 
         WHERE table_schema = DATABASE()`
      );
      const usedBytesDb = Number(dbRows?.[0]?.used_bytes || 0);
      const freeBytesDb = Number(dbRows?.[0]?.free_bytes || 0);
      const totalBytesDb = usedBytesDb + freeBytesDb;

      const [instRows]: any = await this.connection.execute(
        `SELECT 
           IFNULL(SUM(DATA_LENGTH + INDEX_LENGTH), 0) AS used_bytes,
           IFNULL(SUM(DATA_FREE), 0) AS free_bytes
         FROM information_schema.tables`
      );
      const usedBytesInst = Number(instRows?.[0]?.used_bytes || 0);
      const freeBytesInst = Number(instRows?.[0]?.free_bytes || 0);
      const totalBytesInst = usedBytesInst + freeBytesInst;

      return {
        version,
        uptime,
        connections,
        storage: { total: totalBytesDb, used: usedBytesDb, free: freeBytesDb },
        storageInstance: { total: totalBytesInst, used: usedBytesInst, free: freeBytesInst },
        performance: { 
          queriesPerSecond, 
          queriesPerSecondAvg: this.qpsRecent.length > 0 ? Math.round(this.qpsRecent.reduce((a, b) => a + b, 0) / this.qpsRecent.length) : queriesPerSecond,
          queriesPerSecondAvgWindowSize: this.qpsRecent.length,
          slowQueries,
          threadsRunning,
          openTables,
          innodbBufferPoolSize,
          innodbBufferPoolReads,
          innodbBufferPoolReadRequests,
          innodbBufferPoolWriteRequests
        }
      };
    } catch (error) {
      return {
        version: 'Unknown',
        uptime: 0,
        connections: 0,
        storage: { total: 0, used: 0, free: 0 },
        storageInstance: { total: 0, used: 0, free: 0 },
        performance: { queriesPerSecond: 0, slowQueries: 0 }
      };
    }
  }

  async getTableStructure(tableName: string): Promise<TableStructure> {
    try {
      // 优化：对于MySQL数据库，优先获取表结构信息，不阻塞主线程
      const [columnsResult] = await this.connection.execute(`DESCRIBE ${tableName}`);
      const [indexesResult] = await this.connection.execute(`SHOW INDEX FROM ${tableName}`);
      
      const columns = columnsResult.map((col: any) => ({
        name: col.Field,
        type: col.Type,
        nullable: col.Null === 'YES',
        default: col.Default,
        key: col.Key
      }));

      const indexes = indexesResult.map((idx: any) => ({
        name: idx.Key_name,
        type: idx.Type,
        nullable: idx.Null === 'YES',
        default: idx.Default,
        key: idx.Key
      }));

      // 优化：对于超大表，不直接执行COUNT(*)，而是返回0
      // 在实际使用中，如果需要行数，可以单独异步获取
      const rowCount = 0;

      // 异步方式获取表大小信息，但不阻塞主流程
      setTimeout(async () => {
        try {
          // 使用information_schema获取表大小估计值，比COUNT(*)更高效
          const [sizeResult] = await this.connection.execute(
            `SELECT table_rows, data_length + index_length as size_bytes 
             FROM information_schema.tables 
             WHERE table_schema = DATABASE() AND table_name = ?`,
            [tableName]
          );
          // 这里可以记录大小信息，但不影响主返回值
          if (sizeResult && sizeResult.length > 0) {
            console.log(`表 ${tableName} 估计行数: ${sizeResult[0]?.table_rows}, 大小: ${(sizeResult[0]?.size_bytes / (1024 * 1024)).toFixed(2)}MB`);
          }
        } catch (err) {
          console.error(`获取表大小信息失败:`, err);
        }
      }, 0);

      return {
        name: tableName,
        columns,
        indexes,
        foreignKeys: [], // MySQL需要单独查询外键
        rowCount,
        size: 0
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`获取表结构失败: ${errorMessage}`);
    }
  }

  async listTables(): Promise<string[]> {
    try {
      const [result] = await this.connection.execute('SHOW TABLES');
      return result.map((row: any) => Object.values(row)[0] as string);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`获取表列表失败: ${errorMessage}`);
    }
  }

  async listDatabases(): Promise<string[]> {
    try {
      const [result] = await this.connection.execute('SHOW DATABASES');
      // 过滤掉系统数据库
      return result
        .map((row: any) => Object.values(row)[0] as string)
        .filter((dbName: string) => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(dbName));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`获取数据库列表失败: ${errorMessage}`);
    }
  }

  // 重写事务执行方法，使用MySQL的事务支持
  async executeTransaction(queries: Array<{query: string, params?: any[]}>): Promise<boolean> {
    try {
      await this.connection.beginTransaction();
      
      for (const { query, params } of queries) {
        await this.connection.execute(query, params || []);
      }
      
      await this.connection.commit();
      return true;
    } catch (error) {
      await this.connection.rollback();
      return false;
    }
  }
}

// PostgreSQL 连接实现
class PostgreSQLConnection extends BaseDatabaseConnection {
  async connect(): Promise<boolean> {
    try {
      this.isConnecting = true;
      const { Client } = require('pg');
      this.connection = new Client({
        host: this.config.host,
        port: this.config.port,
        user: this.config.username,
        password: this.config.password,
        database: this.config.database,
        ssl: this.config.ssl ? {
          // 为了解决SSL握手失败问题，我们提供更完整的SSL配置
          rejectUnauthorized: false,
          checkServerIdentity: () => undefined // 忽略主机名验证
        } : undefined,
        connectionTimeoutMillis: this.config.timeout ? this.config.timeout * 1000 : 30000
      });
      
      await this.connection.connect();
      this.isConnecting = false;
      return true;
    } catch (error) {
      this.isConnecting = false;
      // 增强错误处理，提取更多的错误信息
      let errorMessage = '未知错误';
      let detailedErrorInfo = '';
      
      // 尝试从不同角度提取错误信息
      if (typeof error === 'object' && error !== null) {
        const errorObj = error as any;
        
        // 首先获取基本的错误消息
        if (error instanceof Error) {
          errorMessage = error.message;
        } else {
          errorMessage = errorObj.message || String(error);
        }
        
        // 然后尝试提取所有可能的错误属性
        if (errorObj.code) detailedErrorInfo += `[${errorObj.code}] `;
        if (errorObj.address && errorObj.port) {
          detailedErrorInfo += `连接到 ${errorObj.address}:${errorObj.port} 失败 `;
        }
        if (errorObj.errno) detailedErrorInfo += `错误号: ${errorObj.errno} `;
        if (errorObj.syscall) detailedErrorInfo += `系统调用: ${errorObj.syscall} `;
        if (errorObj.hostname) detailedErrorInfo += `主机名: ${errorObj.hostname} `;
        if (errorObj.detail) detailedErrorInfo += `详情: ${errorObj.detail} `;
        if (errorObj.hint) detailedErrorInfo += `提示: ${errorObj.hint} `;
        
        // 尝试获取原始错误信息
        if (errorObj.originalError) {
          const originalError = errorObj.originalError as any;
          detailedErrorInfo += `原始错误: ${originalError.message || String(originalError)} `;
          if (originalError.code) detailedErrorInfo += `[原始错误代码: ${originalError.code}] `;
        }
      } else {
        errorMessage = String(error);
      }
      
      // 记录完整的错误对象以便调试
      console.error('PostgreSQL连接错误详情:', JSON.stringify(error));
      
      // 构建包含详细信息的完整错误消息
      const fullErrorMessage = detailedErrorInfo ? `${errorMessage} ${detailedErrorInfo.trim()}` : errorMessage;
      
      // 抛出包含详细信息的错误
      throw new Error(`PostgreSQL连接失败: ${fullErrorMessage}`);
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.end();
      this.connection = null;
    }
  }

  async executeQuery(query: string, params?: any[]): Promise<QueryResult> {
    try {
      const startTime = Date.now();
      const result = await this.connection.query(query, params || []);
      const executionTime = Date.now() - startTime;

      return {
        success: true,
        data: result.rows,
        columns: result.fields ? result.fields.map((field: any) => field.name) : [],
        rowCount: result.rowCount || 0,
        executionTime
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  async getDatabaseInfo(): Promise<DatabaseInfo> {
    try {
      const versionResult = await this.connection.query('SELECT version()');
      const uptimeResult = await this.connection.query('SELECT extract(epoch from now() - pg_postmaster_start_time()) as uptime');
      const connectionsResult = await this.connection.query('SELECT count(*) as connections FROM pg_stat_activity');
      
      const version = versionResult.rows[0]?.version || 'Unknown';
      const uptime = parseInt(uptimeResult.rows[0]?.uptime || '0');
      const connections = parseInt(connectionsResult.rows[0]?.connections || '0');

      return {
        version,
        uptime,
        connections,
        storage: { total: 0, used: 0, free: 0 },
        storageInstance: { total: 0, used: 0, free: 0 },
        performance: { queriesPerSecond: 0, slowQueries: 0 }
      };
    } catch (error) {
      return {
        version: 'Unknown',
        uptime: 0,
        connections: 0,
        storage: { total: 0, used: 0, free: 0 },
        storageInstance: { total: 0, used: 0, free: 0 },
        performance: { queriesPerSecond: 0, slowQueries: 0 }
      };
    }
  }

  async getTableStructure(tableName: string): Promise<TableStructure> {
    try {
      // 首先获取表所在的模式名
      const schemaResult = await this.connection.query(`
        SELECT table_schema FROM information_schema.tables 
        WHERE table_name = $1
        LIMIT 1
      `, [tableName]);
      const schema = schemaResult.rows[0]?.table_schema || 'public';
      
      // 获取表结构信息
      const columnsResult = await this.connection.query(`
        SELECT column_name, data_type, is_nullable, column_default 
        FROM information_schema.columns 
        WHERE table_name = $1 AND table_schema = $2
      `, [tableName, schema]);
      
      const indexesResult = await this.connection.query(`
        SELECT indexname, indexdef 
        FROM pg_indexes 
        WHERE tablename = $1
      `, [tableName]);
      
      const columns = columnsResult.rows.map((col: any) => ({
        name: col.column_name,
        type: col.data_type,
        nullable: col.is_nullable === 'YES',
        default: col.column_default
      }));

      const indexes = indexesResult.rows.map((idx: any) => ({
        name: idx.indexname,
        definition: idx.indexdef
      }));

      // 优化：对于超大表，不直接执行COUNT(*)，而是返回0
      // 在实际使用中，如果需要行数，可以单独异步获取
      const rowCount = 0;
      
      // 异步方式获取表大小信息，但不阻塞主流程
      setTimeout(async () => {
        try {
          // 使用PostgreSQL的pg_stat_user_tables视图获取表统计信息，比COUNT(*)更高效
          const [sizeResult] = await this.connection.query(`
            SELECT n_live_tup as estimated_rows 
            FROM pg_stat_user_tables 
            WHERE schemaname = $1 AND relname = $2
            LIMIT 1
          `, [schema, tableName]);
          
          // 这里可以记录大小信息，但不影响主返回值
          if (sizeResult && sizeResult.rows && sizeResult.rows.length > 0) {
            console.log(`表 ${schema}.${tableName} 估计行数: ${sizeResult.rows[0]?.estimated_rows}`);
          }
        } catch (err) {
          console.error(`获取PostgreSQL表统计信息失败:`, err);
        }
      }, 0);

      return {
        name: tableName,
        schema: schema,
        columns,
        indexes,
        foreignKeys: [],
        rowCount,
        size: 0
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`PostgreSQL获取表结构失败: ${errorMessage}`);
    }
  }

  async listTables(): Promise<string[]> {
    try {
      const result = await this.connection.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
      `);
      return result.rows.map((row: any) => row.table_name);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`获取表列表失败: ${errorMessage}`);
    }
  }

  async listDatabases(): Promise<string[]> {
    try {
      const result = await this.connection.query('SELECT datname FROM pg_database WHERE datistemplate = false');
      return result.rows.map((row: any) => row.datname);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`获取数据库列表失败: ${errorMessage}`);
    }
  }

  // 重写事务执行方法，使用PostgreSQL的事务支持
  async executeTransaction(queries: Array<{query: string, params?: any[]}>): Promise<boolean> {
    try {
      await this.connection.query('BEGIN');
      
      for (const { query, params } of queries) {
        await this.connection.query(query, params || []);
      }
      
      await this.connection.query('COMMIT');
      return true;
    } catch (error) {
      await this.connection.query('ROLLBACK');
      return false;
    }
  }
}

// 其他数据库连接的占位实现
class OracleConnection extends BaseDatabaseConnection {
  // Oracle连接实现（需要oracledb驱动）
  async connect(): Promise<boolean> { return false; }
  async disconnect(): Promise<void> {}
  async executeQuery(query: string, params?: any[]): Promise<QueryResult> { return { success: false, error: 'Oracle连接未实现' }; }
  async getDatabaseInfo(): Promise<DatabaseInfo> { throw new Error('未实现'); }
  async getTableStructure(tableName: string): Promise<TableStructure> { throw new Error('未实现'); }
}

class GaussDBConnection extends BaseDatabaseConnection {
  // GaussDB连接实现
  async connect(): Promise<boolean> { return false; }
  async disconnect(): Promise<void> {}
  async executeQuery(query: string, params?: any[]): Promise<QueryResult> { return { success: false, error: 'GaussDB连接未实现' }; }
  async getDatabaseInfo(): Promise<DatabaseInfo> { throw new Error('未实现'); }
  async getTableStructure(tableName: string): Promise<TableStructure> { throw new Error('未实现'); }
}

class RedisConnection extends BaseDatabaseConnection {
  private client: any = null;
  protected isConnecting: boolean = false;
  private subscriber: any = null;
  private subscribedChannels: Set<string> = new Set();

  // Redis连接实现
  async connect(): Promise<boolean> {
    if (this.isConnected()) {
      return true;
    }

    this.isConnecting = true;
    try {
      const { createClient } = require('redis');
      const config = this.getConfig();
      
      // 构建Redis连接选项
      const redisOptions: any = {
        socket: {
          host: config.host,
          port: Number(config.port) || 6379,
          connectTimeout: (config.timeout || 30) * 1000
        }
      };

      // 根据认证类型设置认证信息（并对缺省authType且提供了密码的情况做兼容）
      const hasPassword = typeof config.password === 'string' && config.password.trim().length > 0;
      const hasUsername = typeof config.username === 'string' && config.username.trim().length > 0;
      if (config.authType === 'username_password') {
        if (hasUsername) {
          redisOptions.username = config.username;
        }
        if (hasPassword) {
          redisOptions.password = config.password;
        }
      } else if (config.authType === 'password') {
        if (hasPassword) {
          redisOptions.password = config.password;
        }
      } else {
        // 兼容：如果未声明认证类型但给了密码（目标实例未启用ACL，仅requirepass），仍然传入password
        if (hasPassword) {
          redisOptions.password = config.password;
        }
      }

      // 如果提供了默认数据库，选择数据库
      if (config.database && !isNaN(Number(config.database))) {
        this.selectedDb = Number(config.database);
      }

      // 记录简化后的连接选项（不打印敏感字段）便于诊断
      try {
        const safeOpts = { socket: redisOptions.socket, username: !!redisOptions.username, passwordPresent: !!redisOptions.password };
        console.log('[REDIS MAIN] createClient options:', JSON.stringify(safeOpts));
      } catch {}

      // 创建Redis客户端
      this.client = createClient(redisOptions);

      // 监听错误事件
      this.client.on('error', (err: Error) => {
        console.error('Redis client error:', err);
      });

      // 连接到Redis
      await this.client.connect();
      console.log('Redis connection established');

      // 如果有默认数据库，切换到该数据库
      if (this.selectedDb !== undefined) {
        await this.client.select(this.selectedDb);
      }

      this.isConnecting = false;
      return true;
    } catch (error) {
      console.error('Redis connection failed:', error);
      this.isConnecting = false;
      this.client = null;
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
        console.log('Redis connection closed');
      } catch (error) {
        console.error('Error closing Redis connection:', error);
      }
      this.client = null;
    }
  }

  async executeQuery(command: string, params?: any[]): Promise<QueryResult> {
    try {
      // 移除冗长的命令执行日志，避免Terminal刷屏

      if (!this.client || !this.isConnected()) {
         // 尝试重新连接
         console.log(`[REDIS MAIN] 客户端未连接，尝试重新连接`);
         const reconnected = await this.connect();
         if (!reconnected || !this.isConnected()) {
           console.error(`[REDIS MAIN] 重新连接失败`);
           throw new Error('Redis client not connected');
         }
       }
      
      // 将命令转换为小写
      const cmd = command.toLowerCase();
      
      // 根据Redis命令执行相应操作
      let result: any;
      switch (cmd) {
        case 'info': {
          // 获取Redis信息（静默执行，移除噪音日志）
          const section = (params && params.length > 0 && typeof params[0] === 'string') ? params[0] : undefined;
          if (section) {
            result = await this.client.info(section);
          } else {
            result = await this.client.info();
          }
          break;
        }
        case 'select':
          // 切换数据库
          if (params && params.length > 0) {
            this.selectedDb = Number(params[0]);
            await this.client.select(String(this.selectedDb));
            result = 'OK';
          } else {
            throw new Error('Database index is required for SELECT command');
          }
          break;
        case 'keys':
          // 列出键
          if (params && params.length > 0) {
            result = await this.client.keys(params[0]);
          } else {
            result = await this.client.keys('*');
          }
          break;
        case 'get':
          // 获取键的值
          if (params && params.length > 0) {
            result = await this.client.get(params[0]);
          } else {
            throw new Error('Key name is required for GET command');
          }
          break;
        case 'set':
          // 设置键的值
          if (params && params.length >= 2) {
            result = await this.client.set(params[0], params[1]);
          } else {
            throw new Error('Key and value are required for SET command');
          }
          break;
        case 'del':
          // 删除键
          if (params && params.length > 0) {
            result = await this.client.del(params[0]);
          } else {
            throw new Error('Key name is required for DEL command');
          }
          break;
        case 'type':
          if (!params || params.length < 1) throw new Error('Key is required for TYPE');
          result = await this.client.type(params[0]);
          break;
        case 'ttl':
          if (!params || params.length < 1) throw new Error('Key is required for TTL');
          result = await this.client.ttl(params[0]);
          break;
        case 'pttl':
          if (!params || params.length < 1) throw new Error('Key is required for PTTL');
          result = await this.client.pttl(params[0]);
          break;
        case 'exists':
          if (!params || params.length < 1) throw new Error('Key is required for EXISTS');
          result = await this.client.exists(params[0]);
          break;
        case 'scan': {
          // 支持 SCAN cursor MATCH pattern COUNT n
          if (!params || params.length < 1) throw new Error('Cursor is required for SCAN');
          const cursor = String(params[0]);
          let MATCH: string | undefined;
          let COUNT: number | undefined;
          if (params.length >= 3) {
            // parse tokens
            for (let i = 1; i < params.length; i += 2) {
              const token = String(params[i]).toUpperCase();
              const val = params[i + 1];
              if (token === 'MATCH') MATCH = String(val);
              if (token === 'COUNT') COUNT = Number(val);
            }
          }
          result = await this.client.scan(cursor, { MATCH, COUNT });
          break;
        }
        case 'dbsize':
          // 兼容 node-redis v4/v5 的 camelCase 方法名
          result = await this.client.dbSize();
          break;
        case 'lrange':
          if (!params || params.length < 3) throw new Error('LRANGE requires key, start, stop');
          result = await this.client.lRange(params[0], Number(params[1]), Number(params[2]));
          break;
        case 'smembers':
          if (!params || params.length < 1) throw new Error('SMEMBERS requires key');
          result = await this.client.sMembers(params[0]);
          break;
        case 'hgetall':
          if (!params || params.length < 1) throw new Error('HGETALL requires key');
          result = await this.client.hGetAll(params[0]);
          break;
        case 'zrange': {
          if (!params || params.length < 3) throw new Error('ZRANGE requires key, start, stop');
          const key = params[0];
          const start = Number(params[1]);
          const stop = Number(params[2]);
          const withScores = params && params.some((p: any) => String(p).toLowerCase() === 'withscores');
          result = withScores ? await this.client.zRange(key, start, stop, { WITHSCORES: true }) : await this.client.zRange(key, start, stop);
          break;
        }
        // ---- New explicit command handlers for camelCase methods in node-redis v4 ----
        case 'hset': {
          if (!params || params.length < 3) throw new Error('HSET requires key and field/value pairs');
          const key = String(params[0]);
          const rest = params.slice(1);
          if (rest.length % 2 !== 0) throw new Error('HSET requires field/value pairs');
          const obj: any = {};
          for (let i = 0; i < rest.length; i += 2) {
            obj[String(rest[i])] = String(rest[i + 1]);
          }
          result = await this.client.hSet(key, obj);
          break;
        }
        case 'lpush': {
          if (!params || params.length < 2) throw new Error('LPUSH requires key and at least one value');
          const key = String(params[0]);
          const values = params.slice(1).map((v: any) => String(v));
          result = await this.client.lPush(key, values);
          break;
        }
        case 'sadd': {
          if (!params || params.length < 2) throw new Error('SADD requires key and at least one member');
          const key = String(params[0]);
          const members = params.slice(1).map((v: any) => String(v));
          result = await this.client.sAdd(key, members);
          break;
        }
        case 'zadd': {
          if (!params || params.length < 3) throw new Error('ZADD requires key followed by score/member pairs');
          const key = String(params[0]);
          const rest = params.slice(1);
          if (rest.length % 2 !== 0) throw new Error('ZADD requires score/member pairs');
          const entries = [] as Array<{ score: number; value: string }>;
          for (let i = 0; i < rest.length; i += 2) {
            const score = Number(rest[i]);
            const value = String(rest[i + 1]);
            if (!Number.isFinite(score)) throw new Error('Invalid ZADD score');
            entries.push({ score, value });
          }
          result = await this.client.zAdd(key, entries);
          break;
        }
        case 'pubsub': {
          const subcmd = String(params?.[0] ?? '').toLowerCase();
          if (subcmd === 'channels') {
            const pattern = (params && params.length > 1 && typeof params[1] === 'string') ? String(params[1]) : undefined;
            if (typeof (this.client as any).pubSubChannels === 'function') {
              result = await (this.client as any).pubSubChannels(pattern);
            } else if (typeof (this.client as any).sendCommand === 'function') {
              const args = ['PUBSUB', 'CHANNELS'];
              if (pattern) args.push(pattern);
              result = await (this.client as any).sendCommand(args);
            } else {
              throw new Error('PUBSUB CHANNELS not supported by client');
            }
          } else if (subcmd === 'numsub') {
            const channels = params?.slice(1)?.map((c: any) => String(c)) || [];
            if (typeof (this.client as any).pubSubNumSub === 'function') {
              result = await (this.client as any).pubSubNumSub(channels);
            } else if (typeof (this.client as any).sendCommand === 'function') {
              const args = ['PUBSUB', 'NUMSUB', ...channels];
              result = await (this.client as any).sendCommand(args);
            } else {
              throw new Error('PUBSUB NUMSUB not supported by client');
            }
          } else if (subcmd === 'numpat') {
            if (typeof (this.client as any).pubSubNumPat === 'function') {
              result = await (this.client as any).pubSubNumPat();
            } else if (typeof (this.client as any).sendCommand === 'function') {
              result = await (this.client as any).sendCommand(['PUBSUB', 'NUMPAT']);
            } else {
              throw new Error('PUBSUB NUMPAT not supported by client');
            }
          } else {
            throw new Error(`Unsupported PUBSUB subcommand: ${subcmd}`);
          }
          break;
        }
        case 'slowlog': {
          const subcmd = String(params?.[0] ?? '').toLowerCase();
          if (typeof (this.client as any).sendCommand !== 'function') {
            throw new Error('SLOWLOG not supported by client');
          }
          if (subcmd === 'get') {
            const count = params?.[1];
            const args = ['SLOWLOG', 'GET'];
            if (typeof count !== 'undefined') args.push(String(count));
            result = await (this.client as any).sendCommand(args);
          } else if (subcmd === 'len') {
            result = await (this.client as any).sendCommand(['SLOWLOG', 'LEN']);
          } else if (subcmd === 'reset') {
            result = await (this.client as any).sendCommand(['SLOWLOG', 'RESET']);
          } else {
            throw new Error(`Unsupported SLOWLOG subcommand: ${subcmd}`);
          }
          break;
        }
        default:
          // 尝试直接执行命令（仅当存在同名方法）
          if (typeof (this.client as any)[cmd] === 'function') {
            result = await (this.client as any)[cmd](...(params || []));
          } else {
            throw new Error(`Unsupported Redis command: ${cmd}`);
          }
      }

      // 格式化返回结果
      return {
        success: true,
        data: this.formatResult(result, cmd)
      };
    } catch (error: any) {
      console.error('Redis query execution failed:', error);
      return {
        success: false,
        error: error.message || 'Redis query execution failed'
      };
    }
  }

  async getDatabaseInfo(): Promise<DatabaseInfo> {
    try {
      if (!this.client || !this.isConnected()) {
        throw new Error('Redis client not connected');
      }

      const info = await this.client.info();
      const infoLines = info.split('\r\n');
      const infoObj: Record<string, string> = {};

      infoLines.forEach((line: string) => {
        const parts = line.split(':');
        if (parts.length === 2) {
          infoObj[parts[0]] = parts[1];
        }
      });

      return {
        version: infoObj['redis_version'] || 'Unknown',
        uptime: parseInt(infoObj['uptime_in_seconds'] || '0'),
        connections: parseInt(infoObj['connected_clients'] || '0'),
        storage: {
          total: parseInt(infoObj['total_system_memory'] || '0'),
          used: parseInt(infoObj['used_memory'] || '0'),
          free: 0 // Redis不直接提供空闲内存信息
        },
        storageInstance: { total: 0, used: 0, free: 0 },
        performance: {
          queriesPerSecond: parseInt(infoObj['instantaneous_ops_per_sec'] || '0'),
          slowQueries: parseInt(infoObj['slowlog_length'] || '0')
        }
      };
    } catch (error) {
      console.error('Failed to get Redis info:', error);
      throw error;
    }
  }

  async getTableStructure(tableName: string): Promise<TableStructure> {
    // Redis没有表的概念，这里返回键空间信息
    try {
      if (!this.client || !this.isConnected()) {
        throw new Error('Redis client not connected');
      }

      // 尝试获取键的类型
      let type = 'unknown';
      try {
        type = await this.client.type(tableName);
      } catch {
        // 如果键不存在，type命令会失败
      }

      // 构建类似表结构的信息
      return {
        name: tableName,
        columns: [
          {
            name: 'key',
            type: 'string',
            nullable: false,
            primaryKey: true,
            autoIncrement: false
          },
          {
            name: 'value',
            type: type,
            nullable: false,
            primaryKey: false,
            autoIncrement: false
          },
          {
            name: 'type',
            type: 'string',
            nullable: false,
            primaryKey: false,
            autoIncrement: false
          }
        ],
        indexes: [],
        foreignKeys: [],
        rowCount: 1, // Redis键是单个记录
        size: 0 // 暂时不计算大小
      };
    } catch (error) {
      console.error('Failed to get Redis key structure:', error);
      throw error;
    }
  }

  async listTables(): Promise<string[]> {
    // Redis没有表的概念，但我们可以返回当前数据库中的所有键
    try {
      if (!this.client || !this.isConnected()) {
        return [];
      }

      const keys = await this.client.keys('*');
      return keys.sort();
    } catch (error) {
      console.error('Failed to list Redis keys:', error);
      return [];
    }
  }

  async listDatabases(): Promise<string[]> {
    // 获取Redis数据库列表
    try {
      if (!this.client || !this.isConnected()) {
        // 尝试重新连接
        await this.connect();
        if (!this.isConnected()) {
          return ['db0'];
        }
      }

      const info = await this.client.info('keyspace');
      const dbNames: string[] = [];
      
      // 增强的解析逻辑，支持不同的换行符格式
      const lines = String(info || '').split(/\r?\n/);
      lines.forEach((line: string) => {
        // 更精确的数据库名匹配
        const match = line.match(/^db(\d+)/);
        if (match) {
          dbNames.push(match[0]);
        }
      });
      
      // 如果没有找到数据库信息，返回默认的数据库列表
      if (dbNames.length === 0) {
        return ['db0'];
      }
      
      // 按数字顺序排序
      return dbNames.sort((a, b) => {
        const numA = parseInt(a.replace('db', ''), 10);
        const numB = parseInt(b.replace('db', ''), 10);
        return numA - numB;
      });
    } catch (error) {
      console.error('Failed to list Redis databases:', error);
      // 即使出错也尝试通过dbsize获取当前数据库信息
      try {
        if (this.isConnected()) {
          await this.client.dbSize();
          return ['db0'];
        }
      } catch (innerError) {
        console.error('Failed to get current Redis DB size:', innerError);
      }
      return ['db0'];
    }
  }

  isConnected(): boolean {
    // 增强连接状态检测，增加更多条件确保准确性
    return this.client !== null && typeof this.client.isReady === 'boolean' && this.client.isReady;
  }

  async ping(): Promise<boolean> {
    try {
      if (!this.isConnected()) {
        return false;
      }
      
      const pong = await this.client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }

  // 辅助方法：格式化Redis结果以便前端处理
  private formatResult(result: any, command: string): any {
    // 对于info命令，返回原始字符串
    if (command === 'info') {
      return result;
    }
    
    // 对于其他命令，尝试格式化结果为数组
    if (Array.isArray(result)) {
      return result;
    }
    
    // 对于单个键值对，包装为对象数组
    if (typeof result !== 'object' || result === null) {
      return [{ value: result }];
    }
    
    return [result];
  }

  // Pub/Sub：确保订阅客户端
  private async ensureSubscriber(): Promise<any> {
    if (this.subscriber && this.subscriber.isReady) return this.subscriber;
    const { createClient } = require('redis');
    const cfg = this.getConfig();
    const opts: any = {
      socket: {
        host: cfg.host,
        port: Number(cfg.port) || 6379,
        connectTimeout: (cfg.timeout || 30) * 1000
      }
    };
    const hasPassword = typeof cfg.password === 'string' && cfg.password.trim().length > 0;
    const hasUsername = typeof cfg.username === 'string' && cfg.username.trim().length > 0;
    if (cfg.authType === 'username_password') {
      if (hasUsername) opts.username = cfg.username;
      if (hasPassword) opts.password = cfg.password;
    } else if (cfg.authType === 'password') {
      if (hasPassword) opts.password = cfg.password;
    } else {
      if (hasPassword) opts.password = cfg.password;
    }
    this.subscriber = createClient(opts);
    this.subscriber.on('error', (err: Error) => console.error('Redis subscriber error:', err));
    await this.subscriber.connect();
    if (this.selectedDb !== undefined) {
      try { await this.subscriber.select(this.selectedDb); } catch {}
    }
    return this.subscriber;
  }

  // 订阅普通频道
  async subscribeChannels(channels: string[], onMessage: (channel: string, message: string) => void): Promise<void> {
    const sub = await this.ensureSubscriber();
    for (const ch of channels) {
      const name = String(ch).trim();
      if (!name) continue;
      if (!this.subscribedChannels.has(name)) {
        await sub.subscribe(name, (msg: string) => onMessage(name, msg));
        this.subscribedChannels.add(name);
      }
    }
  }

  // 订阅模式频道（PSUBSCRIBE）
  async psubscribePatterns(patterns: string[], onMessage: (channel: string, message: string) => void): Promise<void> {
    const sub = await this.ensureSubscriber();
    for (const p of patterns) {
      const pat = String(p).trim();
      if (!pat) continue;
      if (!this.subscribedChannels.has(pat)) {
        await sub.pSubscribe(pat, (msg: string, ch: string) => onMessage(ch, msg));
        this.subscribedChannels.add(pat);
      }
    }
  }

  // 取消订阅
  async unsubscribeChannels(channels: string[], isPattern: boolean = false): Promise<void> {
    if (!this.subscriber) return;
    for (const ch of channels) {
      const name = String(ch).trim();
      if (!name) continue;
      try {
        if (isPattern) {
          await this.subscriber.pUnsubscribe(name);
        } else {
          await this.subscriber.unsubscribe(name);
        }
      } catch {}
      this.subscribedChannels.delete(name);
    }
    // 如果没有订阅，释放订阅连接
    if (this.subscribedChannels.size === 0) {
      try { await this.subscriber.quit(); } catch {}
      this.subscriber = null;
    }
  }

  // 存储当前选择的数据库
  private selectedDb?: number;
}

class SQLiteConnection extends BaseDatabaseConnection {
  // SQLite连接实现
  async connect(): Promise<boolean> { return false; }
  async disconnect(): Promise<void> {}
  async executeQuery(query: string, params?: any[]): Promise<QueryResult> { return { success: false, error: 'SQLite连接未实现' }; }
  async getDatabaseInfo(): Promise<DatabaseInfo> { throw new Error('未实现'); }
  async getTableStructure(tableName: string): Promise<TableStructure> { throw new Error('未实现'); }
}

// ... 数据库连接工厂（恢复主进程依赖）
export class DatabaseConnectionFactory implements IDatabaseConnectionFactory {
  createConnection(config: DatabaseConnection): IDatabaseConnection {
    let conn: IDatabaseConnection;
    switch (config.type) {
      case 'mysql':
        conn = new MySQLConnection();
        break;
      case 'postgresql':
        conn = new PostgreSQLConnection();
        break;
      case 'oracle':
        conn = new OracleConnection();
        break;
      case 'gaussdb':
        conn = new GaussDBConnection();
        break;
      case 'redis':
        conn = new RedisConnection();
        break;
      case 'sqlite':
        conn = new SQLiteConnection();
        break;
      default:
        throw new Error(`不支持的数据库类型: ${config.type}`);
    }
    // 将配置注入到连接实例（基类持有 config 属性）
    (conn as any).config = config;
    return conn;
  }

  getSupportedTypes(): DatabaseType[] {
    return ['mysql', 'postgresql', 'oracle', 'gaussdb', 'redis', 'sqlite'];
  }

  static validateConnectionConfig(config: DatabaseConnection): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    if (!config.type) errors.push('数据库类型不能为空');
    if (!config.host) errors.push('主机地址不能为空');
    if (!config.port) errors.push('端口号不能为空');
    if (config.port && (config.port < 1 || config.port > 65535)) errors.push('端口号必须在1-65535之间');
    if (config.type !== 'redis' && !config.username) errors.push('用户名不能为空');
    return { valid: errors.length === 0, errors };
  }
}

// 简易连接池（单连接）服务，满足主进程调用需求
export class DatabaseService extends EventEmitter {
  private connections: Map<string, IDatabaseConnection> = new Map();
  private configs: Map<string, DatabaseConnection> = new Map();
  private poolTypes: Map<string, DatabaseType> = new Map();

  constructor() { super(); }

  private generatePoolId(config: DatabaseConnection): string {
    const databaseName = config.database || '';
    return `${config.type}_${config.host}_${config.port}_${databaseName}`;
  }

  async createConnectionPool(config: DatabaseConnection, _poolConfig?: Partial<IConnectionPoolConfig>): Promise<string> {
    const poolId = this.generatePoolId(config);
    if (this.connections.has(poolId)) return poolId;
    const factory = new DatabaseConnectionFactory();
    const conn = factory.createConnection(config);
    await conn.connect();
    this.connections.set(poolId, conn);
    this.configs.set(poolId, config);
    this.poolTypes.set(poolId, config.type);
    return poolId;
  }

  getConnectionPool(poolId: string): IDatabaseConnection | undefined {
    return this.connections.get(poolId);
  }

  async disconnect(poolId: string): Promise<void> {
    const conn = this.connections.get(poolId);
    if (conn) {
      try { await conn.disconnect(); } finally {
        this.connections.delete(poolId);
        this.configs.delete(poolId);
        this.poolTypes.delete(poolId);
      }
    }
  }

  async disconnectAll(): Promise<void> {
    const ids = Array.from(this.connections.keys());
    for (const id of ids) await this.disconnect(id);
  }

  async executeQuery(poolId: string, query: string, params?: any[]): Promise<QueryResult> {
    const conn = this.getConnectionPool(poolId);
    if (!conn) throw new Error('连接池不存在');
    const result = await conn.executeQuery(query, params);
    this.emit('queryExecuted', poolId, query, result.success);
    return result;
  }

  async executeBatch(poolId: string, queries: Array<{query: string, params?: any[]}>): Promise<QueryResult[]> {
    const conn = this.getConnectionPool(poolId);
    if (!conn) throw new Error('连接池不存在');
    const results: QueryResult[] = [];
    for (const { query, params } of queries) {
      const res = await conn.executeQuery(query, params);
      this.emit('queryExecuted', poolId, query, res.success);
      results.push(res);
    }
    return results;
  }

  async getDatabaseInfo(poolId: string): Promise<DatabaseInfo> {
    const conn = this.getConnectionPool(poolId);
    if (!conn) throw new Error('连接池不存在');
    return await conn.getDatabaseInfo();
  }

  async getTableStructure(poolId: string, tableName: string): Promise<TableStructure> {
    const conn = this.getConnectionPool(poolId);
    if (!conn) throw new Error('连接池不存在');
    return await conn.getTableStructure(tableName);
  }

  async listTables(poolId: string): Promise<string[]> {
    const conn = this.getConnectionPool(poolId);
    if (!conn) throw new Error('连接池不存在');
    return await (conn as any).listTables();
  }

  async listDatabases(poolId: string): Promise<string[]> {
    const conn = this.getConnectionPool(poolId);
    if (!conn) throw new Error('连接池不存在');
    return await (conn as any).listDatabases();
  }

  // Redis 发布/订阅
  async redisSubscribe(poolId: string, channels: string[], isPattern: boolean = false): Promise<boolean> {
    const conn = this.getConnectionPool(poolId) as any;
    if (!conn || typeof conn.subscribeChannels !== 'function') return false;
    if (isPattern && typeof conn.psubscribePatterns === 'function') {
      await conn.psubscribePatterns(channels, (ch: string, msg: string) => this.emit('redisPubSubMessage', poolId, ch, msg));
      return true;
    } else {
      await conn.subscribeChannels(channels, (ch: string, msg: string) => this.emit('redisPubSubMessage', poolId, ch, msg));
      return true;
    }
  }

  async redisUnsubscribe(poolId: string, channels: string[], isPattern: boolean = false): Promise<boolean> {
    const conn = this.getConnectionPool(poolId) as any;
    if (!conn || typeof conn.unsubscribeChannels !== 'function') return false;
    await conn.unsubscribeChannels(channels, isPattern);
    return true;
  }

  // 连接池状态与配置（最小实现）
  getConnectionPoolStatus(_poolId: string): IConnectionPoolStatus | undefined {
    return { maxConnections: 1, minConnections: 1, acquireTimeout: 60000, idleTimeout: 60000, testOnBorrow: true };
  }
  updateConnectionPoolConfig(_poolId: string, _config: Partial<IConnectionPoolConfig>): void {}
  getAllConnectionPoolIds(): string[] { return Array.from(this.connections.keys()); }
  getConnectionPoolConfig(_poolId: string): IConnectionPoolConfig | undefined {
    return { maxConnections: 1, minConnections: 1, acquireTimeout: 60000, idleTimeout: 60000, testOnBorrow: true };
  }

  // PostgreSQL 专用方法（仅对 pgsql 类型优化）
  async listSchemas(poolId: string): Promise<string[]> {
    const t = this.poolTypes.get(poolId);
    if (t !== 'postgresql' && t !== 'gaussdb') return [];
    const conn = this.getConnectionPool(poolId);
    if (!conn) throw new Error('连接池不存在');
    const res = await conn.executeQuery('SELECT schema_name FROM information_schema.schemata ORDER BY schema_name');
    const schemas = (res?.data || []).map((row: any) => row.schema_name || Object.values(row)[0]);
    // 过滤系统schema
    return schemas.filter((s: string) => !['pg_toast', 'pg_temp_1', 'pg_toast_temp_1'].includes(s));
  }

  async listTablesWithSchema(poolId: string, schema: string): Promise<string[]> {
    const t = this.poolTypes.get(poolId);
    if (t !== 'postgresql' && t !== 'gaussdb') return [];
    const conn = this.getConnectionPool(poolId);
    if (!conn) throw new Error('连接池不存在');
    const res = await conn.executeQuery('SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name', [schema]);
    return (res?.data || []).map((row: any) => row.table_name || Object.values(row)[0]);
  }

  async getTableStructureWithSchema(poolId: string, schema: string, tableName: string): Promise<TableStructure> {
    const t = this.poolTypes.get(poolId);
    if (t !== 'postgresql' && t !== 'gaussdb') return await this.getTableStructure(poolId, tableName);
    const conn = this.getConnectionPool(poolId);
    if (!conn) throw new Error('连接池不存在');
    const columnsRes = await conn.executeQuery(
      'SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = $1 AND table_schema = $2',
      [tableName, schema]
    );
    const indexesRes = await conn.executeQuery(
      'SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2',
      [schema, tableName]
    );
    const columns = (columnsRes?.data || []).map((col: any) => ({
      name: col.column_name,
      type: col.data_type,
      nullable: col.is_nullable === 'YES',
      default: col.column_default
    }));
    const indexes = (indexesRes?.data || []).map((idx: any) => ({ name: idx.indexname, definition: idx.indexdef }));
    return { name: tableName, schema, columns, indexes, foreignKeys: [], rowCount: 0, size: 0 } as any;
  }
}