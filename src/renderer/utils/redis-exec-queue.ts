// Lightweight per-pool execution queue for Redis commands
// Ensures commands for single-connection pools run in serial to avoid contention/timeouts.

export type ExecParams = any[] | undefined;

const poolChains: Record<string, Promise<void>> = {};
const poolMaxConns: Record<string, number> = {};
const poolStatus: Record<string, { active: boolean, lastCheck: number }> = {};

// 配置常量
const POOL_STATUS_CHECK_INTERVAL = 5000; // 5秒
const DEFAULT_TIMEOUT_MS = 8000;
const SHORT_TIMEOUT_MS = 3000;

// 检查连接池是否有效，并在无效时尝试重新创建
async function checkPoolValid(poolId: string): Promise<boolean> {
  const now = Date.now();
  // 避免频繁检查
  if (poolStatus[poolId] && now - poolStatus[poolId].lastCheck < POOL_STATUS_CHECK_INTERVAL) {
    return poolStatus[poolId].active;
  }
  
  try {
    // 使用ping命令快速检查连接状态
    const result = await (window as any).electronAPI?.executeQuery(poolId, 'ping', [], SHORT_TIMEOUT_MS);
    const isValid = result && result.success;
    poolStatus[poolId] = { active: isValid, lastCheck: now };
    return isValid;
  } catch {
    poolStatus[poolId] = { active: false, lastCheck: now };
    return false;
  }
}

async function getMaxConnections(poolId: string): Promise<number> {
  try {
    // 每次获取时检查缓存是否过期，避免长期使用错误的连接数配置
    const now = Date.now();
    if (poolMaxConns[poolId] != null && now - (poolStatus[poolId]?.lastCheck || 0) < 60000) {
      return poolMaxConns[poolId];
    }
    
    const cfg = await (window as any).electronAPI?.getConnectionPoolConfig?.(poolId);
    const max = (cfg && typeof cfg.maxConnections === 'number') ? cfg.maxConnections : 1;
    poolMaxConns[poolId] = max;
    return max;
  } catch (error) {
    console.warn(`[REDIS QUEUE] 获取连接池配置失败: ${error}`);
    poolMaxConns[poolId] = 1; // 安全默认值
    return 1;
  }
}

// 核心执行函数，添加重试和更健壮的错误处理
async function executeWithRetryAndFallback(
  poolId: string,
  query: string,
  params?: ExecParams,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<any> {
  const maxRetries = 2;
  let attempt = 0;
  
  while (attempt < maxRetries) {
    try {
      // 先检查连接池状态
      if (poolId && !(await checkPoolValid(poolId))) {
        // 连接池无效，尝试重新创建
        console.log(`[REDIS QUEUE] 连接池 ${poolId} 无效，尝试重新创建...`);
        
        // 从poolId解析出连接信息
        // poolId格式: redis_host_port_db
        const parts = poolId.split('_');
        if (parts.length >= 3) {
          const type = parts[0];
          const host = parts[1];
          const port = parts[2];
          const db = parts[3] || '0';
          
          // 创建连接配置
          const connection = {
            id: `connection_${poolId}`,
            name: `Redis_${host}_${port}`,
            type: type,
            host: host,
            port: port,
            database: db,
            ssl: false,
            timeout: 30,
            isConnected: true,
            connectionId: poolId
          };
          
          // 调用主进程创建连接池
          const res = await (window as any).electronAPI?.['create-connection-pool']?.({ config: connection, poolConfig: { 
            maxConnections: 5, 
            minConnections: 1, 
            testOnBorrow: true
          } });
          
          if (res?.success) {
            console.log(`[REDIS QUEUE] 连接池 ${poolId} 重新创建成功`);
          } else {
            console.log(`[REDIS QUEUE] 连接池 ${poolId} 重新创建失败，将重试...`);
          }
        } else {
          console.log(`[REDIS QUEUE] 无法解析poolId: ${poolId}`);
        }
        
        // 再次检查连接池状态
        if (!(await checkPoolValid(poolId))) {
          attempt++;
          if (attempt >= maxRetries) {
            throw new Error('连接池不可用，请检查连接状态');
          }
          // 等待一段时间后重试
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
      }
      
      // 执行命令，带超时
      if (timeoutMs > 0) {
        return await Promise.race([
          (window as any).electronAPI?.executeQuery(poolId, query, params),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`Redis命令 ${query} 执行超时`)), timeoutMs))
        ]);
      }
      return await (window as any).electronAPI?.executeQuery(poolId, query, params);
    } catch (error) {
      attempt++;
      // 检查error是否为Error类型
      const isError = error instanceof Error;
      if (attempt >= maxRetries || (isError && error.message.includes('Redis命令'))) {
        // 重试次数耗尽或不是连接池相关错误，抛出异常
        throw error;
      }
      // 等待一段时间后重试
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  throw new Error('连接池不可用，请检查连接状态');
}

export async function execRedisQueued(poolId: string, query: string, params?: ExecParams, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<any> {
  try {
    const max = await getMaxConnections(poolId);
    const run = () => executeWithRetryAndFallback(poolId, query, params, timeoutMs);
    
    if (max <= 1) {
      let result: any;
      // 确保队列不会被卡住，添加错误捕获和清理
      const prev = poolChains[poolId] || Promise.resolve();
      const next = prev.then(async () => {
        try {
          result = await run();
        } catch (error) {
          // 清除队列，避免后续命令继续失败
          delete poolChains[poolId];
          throw error;
        }
      }).catch(error => {
        // 记录但不抛出，让队列继续
        console.warn(`[REDIS QUEUE] 命令执行失败: ${query} - ${error}`);
        throw error; // 重新抛出以便调用者可以处理
      });
      
      poolChains[poolId] = next;
      await next;
      return result;
    }
    return await run();
  } catch (error) {
    // 清理状态
    delete poolChains[poolId];
    delete poolStatus[poolId];
    throw error;
  }
}

// 优化的超时版本，队列更健壮，支持更可靠的错误处理
export async function execRedisQueuedWithTimeout(
  poolId: string,
  query: string,
  params?: ExecParams,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<any> {
  try {
    const max = await getMaxConnections(poolId);
    const run = () => executeWithRetryAndFallback(poolId, query, params, timeoutMs);
    
    // 对重要命令优先检查连接
    if (['info', 'dbsize'].includes(query.toLowerCase())) {
      await checkPoolValid(poolId);
    }
    
    if (max <= 1) {
      let result: any;
      // 快速失败机制：如果队列中有超过3个待执行命令，考虑队列可能被卡住
      const queueLength = Object.keys(poolChains).filter(id => id === poolId).length;
      if (queueLength > 3) {
        console.warn(`[REDIS QUEUE] 连接池 ${poolId} 队列积压，清除队列重试`);
        delete poolChains[poolId];
      }
      
      const prev = poolChains[poolId] || Promise.resolve();
      const next = prev.then(async () => {
        try {
          result = await run();
        } catch (error) {
          // 清理队列以避免阻塞
          delete poolChains[poolId];
          throw error;
        }
      }).catch(error => {
        console.warn(`[REDIS QUEUE] 超时命令执行失败: ${query} - ${error}`);
        throw error;
      });
      
      poolChains[poolId] = next;
      await next;
      return result;
    }
    return await run();
  } catch (error) {
    // 清理状态以便下次重试
    delete poolChains[poolId];
    delete poolStatus[poolId];
    throw error;
  }
}