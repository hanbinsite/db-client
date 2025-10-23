// 数据库类型
export type DatabaseType = 'mysql' | 'oracle' | 'postgresql' | 'gaussdb' | 'redis' | 'sqlite';

// 数据库连接配置
export interface DatabaseConnection {
  id: string;
  name: string;
  type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database?: string;
  schema?: string; // PostgreSQL模式
  ssl?: boolean;
  timeout?: number;
  isConnected: boolean;
  lastConnectTime?: Date;
  connectionId?: string; // 真实的连接池ID
  authType?: 'none' | 'password' | 'username_password'; // Redis认证类型
  redisType?: 'standalone' | 'cluster' | 'sentinel'; // Redis部署类型
}

// Electron API 类型定义
declare global {
  interface Window {
    electronAPI: {
      // 连接存储相关
      getAllConnections: () => Promise<{
        success: boolean;
        connections: DatabaseConnection[];
        message?: string;
      }>;
      saveConnection: (connection: DatabaseConnection) => Promise<{
        success: boolean;
        message?: string;
      }>;
      deleteConnection: (connectionId: string) => Promise<{
        success: boolean;
        message?: string;
      }>;
      
      // 数据库连接相关
      connectDatabase: (config: any) => Promise<any>;
      disconnectDatabase: (connectionId: string) => Promise<any>;
      executeQuery: (connectionId: string, query: string, params?: any[]) => Promise<any>;
      getDatabaseInfo: (connectionId: string) => Promise<any>;
      getTableStructure: (connectionId: string, tableName: string) => Promise<any>;
      listTables: (connectionId: string) => Promise<any>;
      listDatabases: (connectionId: string) => Promise<any>;
      // 新增：连接池配置（返回配置对象或null）
      getConnectionPoolConfig: (connectionId: string) => Promise<{
        maxConnections: number;
        idleTimeoutMs?: number;
      } | null>;

      // Redis 发布/订阅
      redisSubscribe: (
        connectionId: string,
        channels: string[],
        isPattern?: boolean
      ) => Promise<{ success: boolean; error?: string }>;
      redisUnsubscribe: (
        connectionId: string,
        channels: string[],
        isPattern?: boolean
      ) => Promise<{ success: boolean; error?: string }>;
      onRedisPubSubMessage: (
        callback: (payload: { connectionId: string; channel: string; message: string; ts: number }) => void
      ) => void;
      
      // 连接测试
      testConnection: (config: any) => Promise<any>;
      closeTestConnection: (config: any) => Promise<any>;
      
      // 导出功能
      exportQueryResult: (connectionId: string, query: string, format: string) => Promise<any>;
      exportTableData: (connectionId: string, tableName: string, format: string) => Promise<any>;
      showSaveDialog: (defaultFileName: string, format: string) => Promise<any>;
      writeExportFile: (filePath: string, data: any, format: string, dbType?: string) => Promise<{success: boolean; error?: string}>;
      
      // 菜单事件监听
      onMenuNewConnection: (callback: () => void) => void;
      removeAllListeners: (channel: string) => void;

      // 新增：检查更新（打包后使用）
      checkForUpdates: () => Promise<{ ok: boolean; result?: any; message?: string }>;
    };
  }
}

// 数据库服务器信息
export interface DatabaseInfo {
  version: string;
  uptime: number;
  connections: number;
  storage: {
    total: number;
    used: number;
    free: number;
  };
  // 新增：全实例存储统计（可选）
  storageInstance?: {
    total: number;
    used: number;
    free: number;
  };
  performance: {
    queriesPerSecond: number;
    // 短期滑动平均QPS（可选）
    queriesPerSecondAvg?: number;
    // 最近采样窗口大小（样本数，可选）
    queriesPerSecondAvgWindowSize?: number;
    slowQueries: number;
    threadsRunning?: number;
    openTables?: number;
    innodbBufferPoolSize?: number;
    innodbBufferPoolReads?: number;
    innodbBufferPoolWriteRequests?: number;
    innodbBufferPoolReadRequests?: number; // 新增：用于计算缓冲池命中率
  };
}

// 表结构信息
export interface TableStructure {
  name: string;
  schema?: string;
  columns: TableColumn[];
  indexes: TableIndex[];
  foreignKeys: ForeignKey[];
  rowCount: number;
  size: number;
}

// 表列信息
export interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  primaryKey: boolean;
  autoIncrement: boolean;
  comment?: string;
}

// 表索引信息
export interface TableIndex {
  name: string;
  columns: string[];
  unique: boolean;
  type: string;
  comment: string;
}

// 外键信息
export interface ForeignKey {
  name: string;
  column: string;
  referencedTable: string;
  referencedColumn: string;
  onDelete: string;
  onUpdate: string;
}

// 查询结果
export interface QueryResult {
  success: boolean;
  data?: any[];
  columns?: string[];
  rowCount?: number;
  executionTime?: number;
  error?: string;
}

// 数据库对象（表、视图、存储过程等）
export interface DatabaseObject {
  name: string;
  type: 'table' | 'view' | 'procedure' | 'function' | 'index';
  schema?: string;
  comment?: string;
}

// 事务配置
export interface TransactionConfig {
  isolationLevel?: 'READ_UNCOMMITTED' | 'READ_COMMITTED' | 'REPEATABLE_READ' | 'SERIALIZABLE';
  timeout?: number;
}

// 数据编辑操作
export interface DataEditOperation {
  type: 'insert' | 'update' | 'delete';
  table: string;
  data: any;
  where?: any;
}