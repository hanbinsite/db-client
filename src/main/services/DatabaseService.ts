import { EventEmitter } from 'events';
import { DatabaseConnection, DatabaseType, QueryResult, DatabaseInfo, TableStructure } from '../../renderer/types';

// 连接池配置接口
export interface IConnectionPoolConfig {
  maxConnections?: number;
  minConnections?: number;
  acquireTimeout?: number;
  idleTimeout?: number;
  testOnBorrow?: boolean;
}

// 连接池状态接口
export interface IConnectionPoolStatus {
  total: number;
  active: number;
  idle: number;
  waiting: number;
}

// 数据库连接池接口
export interface IDatabaseConnectionPool {
  // 连接池管理
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  getStatus(): IConnectionPoolStatus;
  
  // 连接获取和释放
  acquire(): Promise<IDatabaseConnection>;
  release(connection: IDatabaseConnection): void;
  
  // 连接池配置
  getConfig(): IConnectionPoolConfig;
  updateConfig(config: Partial<IConnectionPoolConfig>): void;
}

// 数据库连接接口
export interface IDatabaseConnection {
  // 连接状态
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  ping(): Promise<boolean>;
  
  // 数据操作
  executeQuery(query: string, params?: any[]): Promise<QueryResult>;
  executeTransaction(queries: Array<{query: string, params?: any[]}>): Promise<boolean>;
  
  // 元数据查询
  getDatabaseInfo(): Promise<DatabaseInfo>;
  getTableStructure(tableName: string): Promise<TableStructure>;
  listTables(): Promise<string[]>;
  listDatabases(): Promise<string[]>;
  
  // 连接信息
  getId(): string;
  getConfig(): DatabaseConnection;
}

// 数据库连接工厂接口
export interface IDatabaseConnectionFactory {
  createConnection(config: DatabaseConnection): IDatabaseConnection;
  getSupportedTypes(): DatabaseType[];
}

// 抽象基础连接类
export abstract class BaseDatabaseConnection implements IDatabaseConnection {
  protected connection: any = null;
  protected config: DatabaseConnection;
  protected isConnecting: boolean = false;

  constructor(config: DatabaseConnection) {
    this.config = config;
  }

  abstract connect(): Promise<boolean>;
  abstract disconnect(): Promise<void>;
  abstract executeQuery(query: string, params?: any[]): Promise<QueryResult>;
  abstract getDatabaseInfo(): Promise<DatabaseInfo>;
  abstract getTableStructure(tableName: string): Promise<TableStructure>;

  isConnected(): boolean {
    return this.connection !== null && !this.isConnecting;
  }

  async ping(): Promise<boolean> {
    if (!this.isConnected()) {
      return false;
    }
    
    try {
      // 默认实现：执行一个简单的查询来测试连接
      const result = await this.executeQuery('SELECT 1');
      return result.success;
    } catch {
      return false;
    }
  }

  async executeTransaction(queries: Array<{query: string, params?: any[]}>): Promise<boolean> {
    // 基础实现，子类可以重写
    try {
      for (const { query, params } of queries) {
        const result = await this.executeQuery(query, params);
        if (!result.success) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  listTables(): Promise<string[]> {
    // 默认实现，子类需要重写
    return Promise.resolve([]);
  }

  listDatabases(): Promise<string[]> {
    // 默认实现，子类需要重写
    return Promise.resolve([]);
  }

  getId(): string {
    return this.config.id;
  }

  getConfig(): DatabaseConnection {
    return { ...this.config };
  }
}

// 通用连接池实现
export class GenericConnectionPool implements IDatabaseConnectionPool {
  private factory: IDatabaseConnectionFactory;
  private config: DatabaseConnection;
  private poolConfig: IConnectionPoolConfig;
  private connections: IDatabaseConnection[] = [];
  private idleConnections: IDatabaseConnection[] = [];
  private waitingAcquires: Array<{resolve: (conn: IDatabaseConnection) => void, reject: (error: Error) => void}> = [];
  private destroyed: boolean = false;

  constructor(factory: IDatabaseConnectionFactory, config: DatabaseConnection, poolConfig?: IConnectionPoolConfig) {
    this.factory = factory;
    this.config = config;
    this.poolConfig = {
      maxConnections: poolConfig?.maxConnections || 10,
      minConnections: poolConfig?.minConnections || 2,
      acquireTimeout: poolConfig?.acquireTimeout || 30000,
      idleTimeout: poolConfig?.idleTimeout || 60000,
      testOnBorrow: poolConfig?.testOnBorrow || true,
    };
  }

  async initialize(): Promise<void> {
    // 初始化最小连接数
    for (let i = 0; i < this.poolConfig.minConnections!; i++) {
      await this.createAndAddConnection();
    }
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    
    // 拒绝所有等待的请求
    this.waitingAcquires.forEach(({ reject }) => {
      reject(new Error('连接池已销毁'));
    });
    this.waitingAcquires = [];

    // 关闭所有连接
    const closePromises = this.connections.map(conn => conn.disconnect());
    await Promise.all(closePromises);
    
    this.connections = [];
    this.idleConnections = [];
  }

  getStatus(): IConnectionPoolStatus {
    return {
      total: this.connections.length,
      active: this.connections.length - this.idleConnections.length,
      idle: this.idleConnections.length,
      waiting: this.waitingAcquires.length
    };
  }

  async acquire(): Promise<IDatabaseConnection> {
    if (this.destroyed) {
      throw new Error('连接池已销毁');
    }

    // 如果有空闲连接，直接返回
    if (this.idleConnections.length > 0) {
      const connection = this.idleConnections.pop()!;
      
      // 检查连接是否有效
      if (this.poolConfig.testOnBorrow && !(await connection.ping())) {
        // 连接无效，创建新连接
        this.connections = this.connections.filter(conn => conn !== connection);
        return this.createAndAcquireConnection();
      }
      
      return connection;
    }

    // 如果还可以创建新连接
    if (this.connections.length < this.poolConfig.maxConnections!) {
      return this.createAndAcquireConnection();
    }

    // 等待空闲连接
    return new Promise<IDatabaseConnection>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waitingAcquires.findIndex(w => w.reject === reject);
        if (index !== -1) {
          this.waitingAcquires.splice(index, 1);
        }
        reject(new Error('获取连接超时'));
      }, this.poolConfig.acquireTimeout!);

      this.waitingAcquires.push({
        resolve: (conn) => {
          clearTimeout(timeout);
          resolve(conn);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  release(connection: IDatabaseConnection): void {
    if (this.destroyed) {
      return;
    }

    // 检查连接是否还在连接池中
    if (!this.connections.includes(connection)) {
      return;
    }

    // 如果有等待的请求，直接分配给等待者
    if (this.waitingAcquires.length > 0) {
      const { resolve } = this.waitingAcquires.shift()!;
      resolve(connection);
      return;
    }

    // 否则放回空闲连接池
    this.idleConnections.push(connection);

    // 清理过期的空闲连接
    this.cleanupIdleConnections();
  }

  getConfig(): IConnectionPoolConfig {
    return { ...this.poolConfig };
  }

  updateConfig(config: Partial<IConnectionPoolConfig>): void {
    this.poolConfig = { ...this.poolConfig, ...config };
  }

  private async createAndAcquireConnection(): Promise<IDatabaseConnection> {
    const connection = await this.createAndAddConnection();
    return connection;
  }

  private async createAndAddConnection(): Promise<IDatabaseConnection> {
    const connection = this.factory.createConnection(this.config);
    
    try {
      await connection.connect();
      this.connections.push(connection);
      return connection;
    } catch (error) {
      // 增强错误处理，保留原始错误的详细信息
      let errorMessage = '未知错误';
      let detailedErrorInfo = '';
      
      // 尝试从不同角度提取错误信息
      if (error instanceof Error) {
        errorMessage = error.message;
        
        // 如果错误对象有额外的属性，也将它们包含进来
        const errorObj = error as any;
        if (errorObj.code) detailedErrorInfo += `[${errorObj.code}] `;
        if (errorObj.detail) detailedErrorInfo += `详情: ${errorObj.detail} `;
        if (errorObj.hint) detailedErrorInfo += `提示: ${errorObj.hint} `;
        if (errorObj.address && errorObj.port) {
          detailedErrorInfo += `地址: ${errorObj.address}:${errorObj.port} `;
        }
      } else if (typeof error === 'object' && error !== null) {
        const errorObj = error as any;
        errorMessage = errorObj.message || String(error);
        detailedErrorInfo = JSON.stringify(errorObj);
      } else {
        errorMessage = String(error);
      }
      
      // 记录完整的错误对象以便调试
      console.error(`创建连接失败 - 数据库类型: ${this.config.type}, 主机: ${this.config.host}:${this.config.port}`);
      console.error('连接错误详情:', error);
      
      // 抛出包含详细信息的新错误
      const fullErrorMessage = `创建连接失败: ${errorMessage} ${detailedErrorInfo.trim()}`;
      throw new Error(fullErrorMessage);
    }
  }

  private cleanupIdleConnections(): void {
    // 这里可以实现空闲连接清理逻辑
    // 暂时留空，后续可以添加定时清理功能
  }
}

// 数据库连接工厂实现
export class DatabaseConnectionFactory implements IDatabaseConnectionFactory {
  createConnection(config: DatabaseConnection): IDatabaseConnection {
    switch (config.type) {
      case 'mysql':
        return new MySQLConnection(config);
      case 'postgresql':
        return new PostgreSQLConnection(config);
      case 'oracle':
        return new OracleConnection(config);
      case 'gaussdb':
        return new GaussDBConnection(config);
      case 'redis':
        return new RedisConnection(config);
      case 'sqlite':
        return new SQLiteConnection(config);
      default:
        throw new Error(`不支持的数据库类型: ${config.type}`);
    }
  }

  getSupportedTypes(): DatabaseType[] {
    return ['mysql', 'postgresql', 'oracle', 'gaussdb', 'redis', 'sqlite'];
  }

  // 验证数据库配置
  static validateConnectionConfig(config: DatabaseConnection): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config.type) {
      errors.push('数据库类型不能为空');
    }

    if (!config.host) {
      errors.push('主机地址不能为空');
    }

    if (!config.port) {
      errors.push('端口号不能为空');
    } else if (config.port < 1 || config.port > 65535) {
      errors.push('端口号必须在1-65535之间');
    }

    if (!config.username) {
      errors.push('用户名不能为空');
    }

    // 数据库名称不再是必填项

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// 数据库服务类
export class DatabaseService extends EventEmitter {
  private connectionPools: Map<string, GenericConnectionPool> = new Map();
  private factory: IDatabaseConnectionFactory;

  constructor() {
    super();
    this.factory = new DatabaseConnectionFactory();
  }

  // 创建数据库连接池
  async createConnectionPool(config: DatabaseConnection, poolConfig?: IConnectionPoolConfig): Promise<string> {
    const poolId = this.generatePoolId(config);
    
    if (this.connectionPools.has(poolId)) {
      throw new Error(`连接池已存在: ${poolId}`);
    }

    try {
      // 验证配置
      const validation = DatabaseConnectionFactory.validateConnectionConfig(config);
      if (!validation.valid) {
        throw new Error(`配置验证失败: ${validation.errors.join(', ')}`);
      }

      const pool = new GenericConnectionPool(this.factory, config, poolConfig);
      await pool.initialize();
      
      this.connectionPools.set(poolId, pool);
      this.emit('connectionPoolCreated', config);
      
      return poolId;
    } catch (error) {
      this.emit('connectionError', config, error);
      throw error;
    }
  }

  // 获取连接池
  getConnectionPool(poolId: string): GenericConnectionPool | undefined {
    return this.connectionPools.get(poolId);
  }

  // 断开连接池
  async disconnect(poolId: string): Promise<void> {
    const pool = this.connectionPools.get(poolId);
    if (pool) {
      await pool.destroy();
      this.connectionPools.delete(poolId);
      this.emit('connectionPoolClosed', poolId);
    }
  }

  // 断开所有连接池
  async disconnectAll(): Promise<void> {
    const disconnectPromises = Array.from(this.connectionPools.keys()).map(
      poolId => this.disconnect(poolId)
    );
    await Promise.all(disconnectPromises);
  }

  // 执行查询（使用连接池）
  async executeQuery(poolId: string, query: string, params?: any[]): Promise<QueryResult> {
    const pool = this.getConnectionPool(poolId);
    if (!pool) {
      throw new Error('连接池不存在');
    }

    const connection = await pool.acquire();
    try {
      const result = await connection.executeQuery(query, params);
      this.emit('queryExecuted', poolId, query, result.success);
      return result;
    } catch (error) {
      this.emit('queryExecuted', poolId, query, false);
      throw error;
    } finally {
      pool.release(connection);
    }
  }

  // 执行事务（使用连接池）
  async executeTransaction(poolId: string, queries: Array<{query: string, params?: any[]}>): Promise<boolean> {
    const pool = this.getConnectionPool(poolId);
    if (!pool) {
      throw new Error('连接池不存在');
    }

    const connection = await pool.acquire();
    try {
      return await connection.executeTransaction(queries);
    } finally {
      pool.release(connection);
    }
  }

  // 获取数据库信息
  async getDatabaseInfo(poolId: string): Promise<DatabaseInfo> {
    const pool = this.getConnectionPool(poolId);
    if (!pool) {
      throw new Error('连接池不存在');
    }

    const connection = await pool.acquire();
    try {
      return await connection.getDatabaseInfo();
    } finally {
      pool.release(connection);
    }
  }

  // 获取表结构
  async getTableStructure(poolId: string, tableName: string): Promise<TableStructure> {
    const pool = this.getConnectionPool(poolId);
    if (!pool) {
      throw new Error('连接池不存在');
    }

    const connection = await pool.acquire();
    try {
      return await connection.getTableStructure(tableName);
    } finally {
      pool.release(connection);
    }
  }

  // 获取表列表
  async listTables(poolId: string): Promise<string[]> {
    const pool = this.getConnectionPool(poolId);
    if (!pool) {
      throw new Error('连接池不存在');
    }

    const connection = await pool.acquire();
    try {
      return await connection.listTables();
    } finally {
      pool.release(connection);
    }
  }

  // 获取数据库列表
  async listDatabases(poolId: string): Promise<string[]> {
    const pool = this.getConnectionPool(poolId);
    if (!pool) {
      throw new Error('连接池不存在');
    }

    const connection = await pool.acquire();
    try {
      return await connection.listDatabases();
    } finally {
      pool.release(connection);
    }
  }

  // 获取连接池状态
  getConnectionPoolStatus(poolId: string): IConnectionPoolStatus | undefined {
    const pool = this.getConnectionPool(poolId);
    return pool?.getStatus();
  }

  // 更新连接池配置
  updateConnectionPoolConfig(poolId: string, config: Partial<IConnectionPoolConfig>): void {
    const pool = this.getConnectionPool(poolId);
    if (pool) {
      pool.updateConfig(config);
      this.emit('connectionPoolStatusChanged', poolId, pool.getStatus());
    }
  }

  // 获取所有连接池ID
  getAllConnectionPoolIds(): string[] {
    return Array.from(this.connectionPools.keys());
  }

  // 获取连接池配置
  getConnectionPoolConfig(poolId: string): IConnectionPoolConfig | undefined {
    const pool = this.getConnectionPool(poolId);
    return pool?.getConfig();
  }

  // 生成连接池ID
  private generatePoolId(config: DatabaseConnection): string {
    // 不使用默认数据库名，只使用配置中指定的数据库名
    const databaseName = config.database || '';
    return `${config.type}_${config.host}_${config.port}_${databaseName}`;
  }

  // 获取支持的数据库类型
  getSupportedDatabaseTypes(): string[] {
    return this.factory.getSupportedTypes();
  }
}

// MySQL 连接实现
class MySQLConnection extends BaseDatabaseConnection {
  async connect(): Promise<boolean> {
    try {
      this.isConnecting = true;
      const mysql = require('mysql2/promise');
      this.connection = await mysql.createConnection({
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
  }

  async executeQuery(query: string, params?: any[]): Promise<QueryResult> {
    try {
      const startTime = Date.now();
      const [rows, fields] = await this.connection.execute(query, params || []);
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
      const [versionResult] = await this.connection.execute('SELECT VERSION() as version');
      const [statusResult] = await this.connection.execute('SHOW STATUS LIKE \'Uptime\'');
      const [connectionsResult] = await this.connection.execute('SHOW STATUS LIKE \'Threads_connected\'');
      
      const version = versionResult[0]?.version || 'Unknown';
      const uptime = parseInt(statusResult[0]?.Value || '0');
      const connections = parseInt(connectionsResult[0]?.Value || '0');

      return {
        version,
        uptime,
        connections,
        storage: { total: 0, used: 0, free: 0 },
        performance: { queriesPerSecond: 0, slowQueries: 0 }
      };
    } catch (error) {
      return {
        version: 'Unknown',
        uptime: 0,
        connections: 0,
        storage: { total: 0, used: 0, free: 0 },
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
        column: idx.Column_name,
        unique: idx.Non_unique === 0
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
        performance: { queriesPerSecond: 0, slowQueries: 0 }
      };
    } catch (error) {
      return {
        version: 'Unknown',
        uptime: 0,
        connections: 0,
        storage: { total: 0, used: 0, free: 0 },
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
  async executeQuery(): Promise<QueryResult> { return { success: false, error: 'Oracle连接未实现' }; }
  async getDatabaseInfo(): Promise<DatabaseInfo> { throw new Error('未实现'); }
  async getTableStructure(): Promise<TableStructure> { throw new Error('未实现'); }
}

class GaussDBConnection extends BaseDatabaseConnection {
  // GaussDB连接实现
  async connect(): Promise<boolean> { return false; }
  async disconnect(): Promise<void> {}
  async executeQuery(): Promise<QueryResult> { return { success: false, error: 'GaussDB连接未实现' }; }
  async getDatabaseInfo(): Promise<DatabaseInfo> { throw new Error('未实现'); }
  async getTableStructure(): Promise<TableStructure> { throw new Error('未实现'); }
}

class RedisConnection extends BaseDatabaseConnection {
  private client: any = null;
  protected isConnecting: boolean = false;

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
          port: config.port,
          connectTimeout: (config.timeout || 30) * 1000
        }
      };

      // 如果提供了用户名和密码，添加认证信息
      if (config.username && config.username.trim()) {
        redisOptions.username = config.username;
      }
      if (config.password && config.password.trim()) {
        redisOptions.password = config.password;
      }

      // 如果提供了默认数据库，选择数据库
      if (config.database && !isNaN(Number(config.database))) {
        this.selectedDb = Number(config.database);
      }

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
      if (!this.client || !this.isConnected()) {
        throw new Error('Redis client not connected');
      }

      // 将命令转换为小写
      const cmd = command.toLowerCase();
      
      // 根据Redis命令执行相应操作
      let result: any;
      switch (cmd) {
        case 'info':
          // 获取Redis信息
          if (params && params.length > 0 && params[0] === 'keyspace') {
            // 只获取keyspace信息
            const info = await this.client.info('keyspace');
            result = info;
          } else {
            result = await this.client.info();
          }
          break;
        case 'select':
          // 切换数据库
          if (params && params.length > 0) {
            this.selectedDb = Number(params[0]);
            await this.client.select(this.selectedDb);
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
        default:
          // 尝试直接执行命令
          if (typeof this.client[cmd] === 'function') {
            result = await this.client[cmd](...(params || []));
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
        return [];
      }

      const info = await this.client.info('keyspace');
      const dbNames: string[] = [];
      
      // 解析info keyspace输出，提取数据库名称
      const lines = info.split('\r\n');
      lines.forEach((line: string) => {
        if (line.startsWith('db')) {
          const dbName = line.split(':')[0];
          dbNames.push(dbName);
        }
      });
      
      // 如果没有找到数据库信息，返回默认的数据库列表
      if (dbNames.length === 0) {
        return ['db0'];
      }
      
      return dbNames.sort();
    } catch (error) {
      console.error('Failed to list Redis databases:', error);
      return ['db0'];
    }
  }

  isConnected(): boolean {
    return this.client !== null && this.client.isReady;
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

  // 存储当前选择的数据库
  private selectedDb?: number;
}

class SQLiteConnection extends BaseDatabaseConnection {
  // SQLite连接实现
  async connect(): Promise<boolean> { return false; }
  async disconnect(): Promise<void> {}
  async executeQuery(): Promise<QueryResult> { return { success: false, error: 'SQLite连接未实现' }; }
  async getDatabaseInfo(): Promise<DatabaseInfo> { throw new Error('未实现'); }
  async getTableStructure(): Promise<TableStructure> { throw new Error('未实现'); }
}