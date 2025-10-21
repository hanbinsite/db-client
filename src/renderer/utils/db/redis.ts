// Redis数据库工具类 - 完全重构版本
import type { DatabaseConnection } from '../../types';
import { BaseDbUtils } from './base';
import type { DatabaseItem } from '../database-utils';
import { execRedisQueued } from '../redis-exec-queue';

// 增强的全局Window类型声明
declare global {
  interface Window {
    __dataLoaderRef?: { clearCache: () => void };
    __redisDbCache?: Record<string, any>;
    __redisKeyspaceInfo?: Record<string, any>;
  }
}

/**
 * Redis数据库工具类
 * 负责处理Redis数据库的所有操作，包括获取数据库列表、键数量等
 */
export class RedisDbUtils extends BaseDbUtils {
  /**
   * 获取Redis数据库列表
   * 采用双路径策略：首先尝试INFO keyspace命令，失败则使用SELECT/DBSIZE命令逐个查询
   */
  async getDatabases(connection: DatabaseConnection): Promise<DatabaseItem[]> {
    console.log('[REDIS DB UTILS] =============== 获取数据库列表开始 ===============');
    
    // 验证连接信息
    if (!connection) {
      console.error('[REDIS DB UTILS] 错误: 无效的连接信息');
      return this.getDefaultDatabases();
    }
    
    const connectionId = connection.connectionId || connection.id;
    console.log('[REDIS DB UTILS] 连接信息:', {
      connectionId,
      host: connection.host,
      port: connection.port,
      isConnected: connection.isConnected
    });
    
    // 清除所有可能的缓存
    this.clearCaches();
    
    try {
      // 首先尝试使用INFO keyspace命令（首选方法）
      console.log('[REDIS DB UTILS] 尝试方法1: 使用INFO keyspace命令');
      const databases = await this.getDatabasesWithInfoKeyspace(connection);
      
      // 如果获取成功且有数据，返回结果
      if (databases && databases.length > 0) {
        console.log(`[REDIS DB UTILS] INFO keyspace方法成功，获取到 ${databases.length} 个数据库`);
        return databases;
      }
      
      // 否则回退到备用方法
      console.log('[REDIS DB UTILS] INFO keyspace方法失败或返回空结果，切换到备用方法');
    } catch (error) {
      console.error('[REDIS DB UTILS] INFO keyspace方法发生异常:', error);
    }
    
    // 使用备用方法：SELECT/DBSIZE命令逐个查询
    try {
      console.log('[REDIS DB UTILS] 尝试方法2: 使用SELECT/DBSIZE命令逐个查询');
      const fallbackDatabases = await this.getDatabasesWithFallback(connection);
      
      console.log(`[REDIS DB UTILS] 备用方法完成，获取到 ${fallbackDatabases.length} 个数据库`);
      return fallbackDatabases;
    } catch (error) {
      console.error('[REDIS DB UTILS] 备用方法发生异常:', error);
    }
    
    // 所有方法都失败时，返回默认的0-15号数据库列表
    console.log('[REDIS DB UTILS] 所有方法都失败，返回默认的0-15号数据库列表');
    return this.getDefaultDatabases();
  }

  /**
   * 清除所有相关缓存
   */
  private clearCaches(): void {
    console.log('[REDIS DB UTILS] 开始清除所有缓存');
    
    // 清除window对象上可能存在的缓存
    if (typeof window !== 'undefined') {
      // 清除Redis特定缓存
      if (window.__redisDbCache) {
        delete window.__redisDbCache;
        console.log('[REDIS DB UTILS] window.__redisDbCache 已清除');
      }
      
      if (window.__redisKeyspaceInfo) {
        delete window.__redisKeyspaceInfo;
        console.log('[REDIS DB UTILS] window.__redisKeyspaceInfo 已清除');
      }
      
      // 清除localStorage中的缓存
      try {
        if (typeof localStorage !== 'undefined') {
          const keysToRemove: string[] = [];
          
          Object.keys(localStorage).forEach(key => {
            if (key.includes('redis') || key.includes('database') || key.includes('db')) {
              keysToRemove.push(key);
            }
          });
          
          keysToRemove.forEach(key => {
            localStorage.removeItem(key);
            console.log(`[REDIS DB UTILS] 已清除localStorage键: ${key}`);
          });
          
          console.log(`[REDIS DB UTILS] 共清除 ${keysToRemove.length} 个localStorage缓存项`);
        }
      } catch (e) {
        console.warn('[REDIS DB UTILS] 无法清除localStorage缓存:', e);
      }
      
      // 尝试清除DataLoader的缓存
      if (window.__dataLoaderRef?.clearCache) {
        try {
          window.__dataLoaderRef.clearCache();
          console.log('[REDIS DB UTILS] DataLoader缓存已清除');
        } catch (e) {
          console.warn('[REDIS DB UTILS] 无法清除DataLoader缓存:', e);
        }
      }
    }
    
    console.log('[REDIS DB UTILS] 缓存清除完成');
  }

  /**
   * 使用INFO keyspace命令获取数据库列表
   */
  private async getDatabasesWithInfoKeyspace(connection: DatabaseConnection): Promise<DatabaseItem[]> {
    console.log('[REDIS DB UTILS] 开始执行INFO keyspace方法');
    
    const connectionId = connection.connectionId || connection.id;
    if (!connectionId) {
      console.error('[REDIS DB UTILS] 缺少有效connectionId');
      return [];
    }
    
    // 执行INFO keyspace命令，带重试机制
    const infoResult = await this.executeInfoKeyspaceCommand(connectionId);
    if (!infoResult || !infoResult.success) {
      console.log('[REDIS DB UTILS] INFO keyspace命令执行失败');
      return [];
    }
    
    // 解析keyspace信息
    const keyspaceInfo = this.parseKeyspaceInfo(infoResult.data);
    
    // 构建数据库列表
    const databases = await this.buildDatabaseList(keyspaceInfo, connectionId);
    
    console.log(`[REDIS DB UTILS] INFO keyspace方法最终获取到 ${databases.length} 个数据库`);
    return databases;
  }

  /**
   * 执行INFO keyspace命令，带重试机制
   */
  private async executeInfoKeyspaceCommand(connectionId: string): Promise<any> {
    console.log('[REDIS DB UTILS] 执行INFO keyspace命令');
    
    const maxRetries = 3;
    const timeoutMs = 5000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[REDIS DB UTILS] INFO keyspace尝试 ${attempt}/${maxRetries}`);
        
        // 使用execRedisQueued执行命令
        const result = await execRedisQueued(connectionId, 'info', ['keyspace'], timeoutMs);
        
        console.log(`[REDIS DB UTILS] INFO keyspace尝试 ${attempt} 结果:`, result);
        
        // 立即返回成功结果
        if (result && result.success) {
          return result;
        }
      } catch (error) {
        console.error(`[REDIS DB UTILS] INFO keyspace尝试 ${attempt} 失败:`, error);
      }
      
      // 如果不是最后一次尝试，等待后重试
      if (attempt < maxRetries) {
        const waitTime = 1000 * attempt; // 递增等待时间
        console.log(`[REDIS DB UTILS] ${waitTime}ms后进行下一次尝试`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    return null;
  }

  /**
   * 解析keyspace信息
   */
  private parseKeyspaceInfo(data: any): Record<string, number> {
    const keyspaceInfo: Record<string, number> = {};
    
    try {
      console.log('[REDIS DB UTILS] 开始解析keyspace信息');
      
      // 处理不同格式的返回数据
      let infoText = '';
      if (typeof data === 'string') {
        infoText = data;
      } else if (Array.isArray(data) && data.length > 0) {
        // 处理数组格式的结果
        const firstItem = data[0];
        if (typeof firstItem === 'object' && firstItem.value !== undefined) {
          infoText = String(firstItem.value);
        } else if (typeof firstItem === 'string') {
          infoText = firstItem;
        } else {
          infoText = String(firstItem);
        }
      } else if (typeof data === 'object' && data !== null) {
        // 处理对象格式的结果
        infoText = String((data as any).value ?? data);
      } else {
        // 处理其他格式
        infoText = String(data);
      }
      
      console.log('[REDIS DB UTILS] 解析keyspace原始文本:', infoText);
      
      // 按行分割并解析
      const lines = infoText.split(/\r?\n/);
      console.log(`[REDIS DB UTILS] 解析 ${lines.length} 行数据`);
      
      // 支持多种格式的解析
      const dbPatterns = [
        /^(db\d+):keys=(\d+)/i,  // 标准格式: db0:keys=12345
        /^db(\d+):keys=(\d+)/,    // 简化格式: db0:keys=12345
        /^db(\d+) keys=(\d+)/     // 空格格式: db0 keys=12345
      ];
      
      for (const line of lines) {
        if (!line.trim()) continue;
        
        // 尝试所有支持的格式
        let matched = false;
        for (const pattern of dbPatterns) {
          const match = line.match(pattern);
          if (match) {
            const dbNum = match[1].replace('db', '') || match[1];
            const keyCount = parseInt(match[2], 10);
            keyspaceInfo[dbNum] = keyCount;
            console.log(`[REDIS DB UTILS] 解析到数据库 ${dbNum}，键数量: ${keyCount}`);
            matched = true;
            break;
          }
        }
        
        // 如果没有匹配，记录该行
        if (!matched) {
          console.log(`[REDIS DB UTILS] 无法解析行: ${line}`);
        }
      }
      
      if (Object.keys(keyspaceInfo).length === 0) {
        console.log('[REDIS DB UTILS] 未能解析到任何数据库信息');
      } else {
        console.log(`[REDIS DB UTILS] 成功解析到 ${Object.keys(keyspaceInfo).length} 个数据库的键信息`);
      }
    } catch (error) {
      console.error('[REDIS DB UTILS] 解析keyspace信息失败:', error);
    }
    
    return keyspaceInfo;
  }

  /**
   * 构建数据库列表
   */
  private async buildDatabaseList(keyspaceInfo: Record<string, number>, connectionId: string): Promise<DatabaseItem[]> {
    console.log('[REDIS DB UTILS] 构建数据库列表');
    
    const databases: DatabaseItem[] = [];
    const existingDbs = new Set(Object.keys(keyspaceInfo).map(Number));
    
    // 确保添加0-15个标准数据库
    for (let i = 0; i <= 15; i++) {
      const dbInfo: DatabaseItem = {
        name: `db${i}`,
        tables: [],
        views: [],
        procedures: [],
        functions: [],
        schemas: [],
        keyCount: keyspaceInfo[i.toString()] || 0
      };
      databases.push(dbInfo);
      existingDbs.delete(i);
    }
    
    // 添加大于15的额外数据库
    const extraDbs = Array.from(existingDbs).sort((a, b) => a - b);
    for (const dbNum of extraDbs) {
      databases.push({
        name: `db${dbNum}`,
        tables: [],
        views: [],
        procedures: [],
        functions: [],
        schemas: [],
        keyCount: keyspaceInfo[dbNum.toString()] || 0
      });
    }
    
    // 如果没有解析到任何信息，尝试获取db0的准确键数量
    if (Object.keys(keyspaceInfo).length === 0) {
      console.log('[REDIS DB UTILS] 使用DBSIZE命令获取db0的准确键数量');
      const db0KeyCount = await this.getDatabaseKeyCount(connectionId, 0);
      if (db0KeyCount !== null) {
        const db0Index = databases.findIndex(db => db.name === 'db0');
        if (db0Index >= 0) {
          databases[db0Index].keyCount = db0KeyCount;
          console.log(`[REDIS DB UTILS] 更新db0键数量为: ${db0KeyCount}`);
        }
      }
    }
    
    console.log(`[REDIS DB UTILS] 数据库列表构建完成，共 ${databases.length} 个数据库`);
    return databases;
  }

  /**
   * 获取指定数据库的键数量，带重试机制
   */
  private async getDatabaseKeyCount(connectionId: string, dbIndex: number): Promise<number | null> {
    console.log(`[REDIS DB UTILS] 获取数据库 ${dbIndex} 的键数量`);
    
    const maxRetries = 2;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // 使用带超时的Promise确保命令不会无限等待
        const result = await Promise.race([
          this.executeDatabaseKeyCountCommand(connectionId, dbIndex),
          new Promise<null>(resolve => {
            setTimeout(() => {
              console.warn(`[REDIS DB UTILS] 获取数据库 ${dbIndex} 键数量超时`);
              resolve(null);
            }, 3000); // 3秒超时
          })
        ]);
        
        if (result !== null) {
          return result;
        }
      } catch (error) {
        console.error(`[REDIS DB UTILS] 获取数据库 ${dbIndex} 键数量失败 (尝试 ${attempt}/${maxRetries}):`, error);
      }
      
      // 如果不是最后一次尝试，等待后重试
      if (attempt < maxRetries) {
        console.log(`[REDIS DB UTILS] 等待500ms后重试...`);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    console.warn(`[REDIS DB UTILS] 获取数据库 ${dbIndex} 键数量的所有尝试都失败`);
    return null;
  }

  /**
   * 执行获取数据库键数量的命令
   */
  private async executeDatabaseKeyCountCommand(connectionId: string, dbIndex: number): Promise<number | null> {
    try {
      // 切换到目标数据库
      console.log(`[REDIS DB UTILS] 执行 SELECT ${dbIndex}`);
      const selectResult = await execRedisQueued(connectionId, 'SELECT', [dbIndex.toString()], 2000);
      console.log(`[REDIS DB UTILS] SELECT ${dbIndex} 结果:`, selectResult);
      
      // 验证SELECT命令是否成功
      if (!selectResult || !selectResult.success) {
        console.error(`[REDIS DB UTILS] SELECT ${dbIndex} 失败`);
        return null;
      }
      
      // 执行DBSIZE命令
      console.log(`[REDIS DB UTILS] 执行 DBSIZE`);
      const dbsizeResult = await execRedisQueued(connectionId, 'DBSIZE', [], 3000);
      console.log(`[REDIS DB UTILS] DBSIZE 结果:`, dbsizeResult);
      
      // 解析键数量
      if (dbsizeResult && dbsizeResult.success) {
        let keyCount = 0;
        const data = dbsizeResult.data;
        
        // 处理多种可能的返回格式
        if (typeof data === 'number') {
          keyCount = data;
        } else if (Array.isArray(data) && data.length > 0) {
          keyCount = Number(data[0]) || 0;
        } else if (typeof data === 'object' && data !== null) {
          keyCount = Number((data as any).value ?? data) || 0;
        } else {
          keyCount = Number(data) || 0;
        }
        
        console.log(`[REDIS DB UTILS] 数据库 ${dbIndex} 键数量: ${keyCount}`);
        return keyCount;
      }
    } catch (error) {
      console.error(`[REDIS DB UTILS] 执行数据库键数量命令失败:`, error);
    }
    
    return null;
  }

  /**
   * 备用方法：使用SELECT/DBSIZE命令获取数据库列表
   */
  private async getDatabasesWithFallback(connection: DatabaseConnection): Promise<DatabaseItem[]> {
    console.log('[REDIS DB UTILS] 执行备用SELECT/DBSIZE方法');
    
    const connectionId = connection.connectionId || connection.id;
    if (!connectionId) {
      console.error('[REDIS DB UTILS] 缺少有效connectionId');
      return this.getDefaultDatabases();
    }
    
    const databases: DatabaseItem[] = [];
    let successCount = 0;
    let errorCount = 0;
    
    // 并发查询所有0-15号数据库，提高效率
    const promises = [];
    for (let i = 0; i <= 15; i++) {
      const promise = this.getDatabaseKeyCount(connectionId, i)
        .then(keyCount => {
          databases.push({
            name: `db${i}`,
            tables: [],
            views: [],
            procedures: [],
            functions: [],
            schemas: [],
            keyCount: keyCount ?? 0
          });
          
          successCount++;
          return keyCount;
        })
        .catch(error => {
          console.error(`[REDIS DB UTILS] 处理数据库 db${i} 失败:`, error);
          
          // 即使失败也添加数据库条目
          databases.push({
            name: `db${i}`,
            tables: [],
            views: [],
            procedures: [],
            functions: [],
            schemas: [],
            keyCount: 0
          });
          
          errorCount++;
          return null;
        });
      
      promises.push(promise);
    }
    
    // 等待所有查询完成
    await Promise.allSettled(promises);
    
    console.log(`[REDIS DB UTILS] 备用方法完成: 成功 ${successCount}, 失败 ${errorCount}`);
    
    // 确保数据库按顺序排序
    databases.sort((a, b) => {
      const numA = parseInt(a.name.replace('db', ''), 10);
      const numB = parseInt(b.name.replace('db', ''), 10);
      return numA - numB;
    });
    
    return databases;
  }

  /**
   * 获取默认的数据库列表（0-15号数据库）
   */
  private getDefaultDatabases(): DatabaseItem[] {
    console.log('[REDIS DB UTILS] 返回默认数据库列表');
    
    const databases: DatabaseItem[] = [];
    // 添加0-15个默认数据库
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
    
    return databases;
  }

  /**
   * 获取表列表（Redis中不适用，返回空数组）
   * 确保参数兼容基类接口
   */
  async getTables(connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> {
    console.log(`[REDIS DB UTILS] getTables 调用，数据库: ${databaseName}，Redis不支持表概念`);
    return [];
  }

  /**
   * 获取视图列表（Redis中不适用，返回空数组）
   * 确保参数兼容基类接口
   */
  async getViews(connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> {
    console.log(`[REDIS DB UTILS] getViews 调用，数据库: ${databaseName}，Redis不支持视图概念`);
    return [];
  }

  /**
   * 获取存储过程列表（Redis中不适用，返回空数组）
   * 确保参数兼容基类接口
   */
  async getProcedures(connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> {
    console.log(`[REDIS DB UTILS] getProcedures 调用，数据库: ${databaseName}，Redis不支持存储过程概念`);
    return [];
  }

  /**
   * 获取函数列表（Redis中不适用，返回空数组）
   * 确保参数兼容基类接口
   */
  async getFunctions(connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> {
    console.log(`[REDIS DB UTILS] getFunctions 调用，数据库: ${databaseName}，Redis不支持函数概念`);
    return [];
  }

  /**
   * 获取模式列表（Redis中不适用，返回空数组）
   * 确保参数兼容基类接口
   */
  async getSchemas(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    console.log(`[REDIS DB UTILS] getSchemas 调用，数据库: ${databaseName}，Redis不支持模式概念`);
    return [];
  }
}