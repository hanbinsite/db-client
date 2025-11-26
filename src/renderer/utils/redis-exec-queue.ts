// Lightweight per-pool execution queue for Redis commands
// Ensures commands for single-connection pools run in serial to avoid contention/timeouts.

export type ExecParams = any[] | undefined;

// 使用Map代替Record以提高键查找和删除性能
const poolChains = new Map<string, Promise<void>>();
const poolMaxConns = new Map<string, { value: number, timestamp: number }>();
const poolStatus = new Map<string, { active: boolean, lastCheck: number }>();
const poolQueuedCommands = new Map<string, number>(); // 跟踪每个池的排队命令数

// 配置常量
const POOL_STATUS_CHECK_INTERVAL = 5000; // 5秒
const DEFAULT_TIMEOUT_MS = 8000;
const SHORT_TIMEOUT_MS = 3000;
const MAX_QUEUE_LENGTH = 10; // 最大允许排队命令数
const POOL_MAX_CONNS_CACHE_TTL = 60000; // 连接池配置缓存过期时间

// 检查连接池是否有效，并在无效时尝试重新创建
async function checkPoolValid(poolId: string): Promise<boolean> {
  const now = Date.now();
  const currentStatus = poolStatus.get(poolId);
  
  // 避免频繁检查
  if (currentStatus && now - currentStatus.lastCheck < POOL_STATUS_CHECK_INTERVAL) {
    return currentStatus.active;
  }
  
  try {
    // 使用ping命令快速检查连接状态
    const result = await (window as any).electronAPI?.executeQuery(poolId, 'ping', [], SHORT_TIMEOUT_MS);
    const isValid = result && result.success;
    poolStatus.set(poolId, { active: isValid, lastCheck: now });
    return isValid;
  } catch (error) {
    console.warn(`[REDIS QUEUE] 连接池 ${poolId} 检查失败:`, error);
    poolStatus.set(poolId, { active: false, lastCheck: now });
    
    // 如果连接池无效，尝试清理相关资源
    cleanupPoolResources(poolId);
    return false;
  }
}

// 清理池相关资源
function cleanupPoolResources(poolId: string): void {
  poolChains.delete(poolId);
  // 保留池状态但标记为不活跃，以便快速失败
  if (poolStatus.has(poolId)) {
    const status = poolStatus.get(poolId)!;
    poolStatus.set(poolId, { ...status, active: false });
  }
  poolQueuedCommands.delete(poolId);
}

async function getMaxConnections(poolId: string): Promise<number> {
  try {
    // 检查缓存是否有效
    const now = Date.now();
    const cached = poolMaxConns.get(poolId);
    if (cached && now - cached.timestamp < POOL_MAX_CONNS_CACHE_TTL) {
      return cached.value;
    }
    
    const cfg = await (window as any).electronAPI?.getConnectionPoolConfig?.(poolId);
    const max = (cfg && typeof cfg.maxConnections === 'number') ? cfg.maxConnections : 1;
    poolMaxConns.set(poolId, { value: max, timestamp: now });
    return max;
  } catch (error) {
    console.warn(`[REDIS QUEUE] 获取连接池配置失败:`, error);
    // 安全默认值
    poolMaxConns.set(poolId, { value: 1, timestamp: Date.now() });
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
  const retryDelays = [500, 1000]; // 指数退避重试
  let attempt = 0;
  
  while (attempt <= maxRetries) {
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
            testOnBorrow: true,
            idleTimeoutMillis: 30000 // 空闲连接超时时间
          } });
          
          if (res?.success) {
            console.log(`[REDIS QUEUE] 连接池 ${poolId} 重新创建成功`);
            // 重置池状态
            poolStatus.set(poolId, { active: true, lastCheck: Date.now() });
          } else {
            console.log(`[REDIS QUEUE] 连接池 ${poolId} 重新创建失败，将重试...`);
          }
        } else {
          console.log(`[REDIS QUEUE] 无法解析poolId: ${poolId}`);
        }
        
        // 再次检查连接池状态
        if (!(await checkPoolValid(poolId))) {
          attempt++;
          if (attempt > maxRetries) {
            throw new Error('连接池不可用，请检查连接状态');
          }
          // 指数退避等待
          await new Promise(resolve => setTimeout(resolve, retryDelays[Math.min(attempt - 1, retryDelays.length - 1)]));
          continue;
        }
      }
      
      // 执行命令，带超时
      const startTime = Date.now();
      let result;
      
      if (timeoutMs > 0) {
        result = await Promise.race([
          (window as any).electronAPI?.executeQuery(poolId, query, params),
          new Promise((_, reject) => setTimeout(() => reject(new Error(`Redis命令 ${query} 执行超时`)), timeoutMs))
        ]);
      } else {
        result = await (window as any).electronAPI?.executeQuery(poolId, query, params);
      }
      
      const executionTime = Date.now() - startTime;
      if (executionTime > timeoutMs * 0.8) {
        console.warn(`[REDIS QUEUE] 命令 ${query} 执行时间较长: ${executionTime}ms`);
      }
      
      return result;
    } catch (error) {
      attempt++;
      const isError = error instanceof Error;
      
      // 记录详细错误信息
      console.warn(`[REDIS QUEUE] 命令 ${query} 执行失败 (尝试 ${attempt}/${maxRetries+1}):`, error);
      
      if (attempt > maxRetries || (isError && error.message.includes('Redis命令'))) {
        // 重试次数耗尽或不是连接池相关错误，抛出异常
        throw error;
      }
      
      // 指数退避等待
      await new Promise(resolve => setTimeout(resolve, retryDelays[Math.min(attempt - 1, retryDelays.length - 1)]));
    }
  }
  
  throw new Error('连接池不可用，请检查连接状态');
}

export async function execRedisQueued(poolId: string, query: string, params?: ExecParams, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<any> {
  try {
    const max = await getMaxConnections(poolId);
    const run = () => executeWithRetryAndFallback(poolId, query, params, timeoutMs);
    
    if (max <= 1) {
      // 检查队列长度限制，防止队列积压
      const currentQueueLength = poolQueuedCommands.get(poolId) || 0;
      if (currentQueueLength >= MAX_QUEUE_LENGTH) {
        console.warn(`[REDIS QUEUE] 连接池 ${poolId} 队列长度超过限制 (${currentQueueLength}/${MAX_QUEUE_LENGTH})`);
        // 清理队列并快速失败
        cleanupPoolResources(poolId);
        throw new Error('连接池队列已满，请稍后重试');
      }
      
      let result: any;
      // 更新队列计数
      poolQueuedCommands.set(poolId, (currentQueueLength || 0) + 1);
      
      // 确保队列不会被卡住，添加错误捕获和清理
      const prev = poolChains.get(poolId) || Promise.resolve();
      const next = prev.then(async () => {
        try {
          result = await run();
          return result;
        } catch (error) {
          // 清除队列，避免后续命令继续失败
          cleanupPoolResources(poolId);
          throw error;
        } finally {
          // 减少队列计数
          const current = poolQueuedCommands.get(poolId);
          if (current && current > 0) {
            poolQueuedCommands.set(poolId, current - 1);
          } else {
            poolQueuedCommands.delete(poolId);
          }
        }
      }).catch(error => {
        // 减少队列计数
        const current = poolQueuedCommands.get(poolId);
        if (current && current > 0) {
          poolQueuedCommands.set(poolId, current - 1);
        } else {
          poolQueuedCommands.delete(poolId);
        }
        
        // 记录但不抛出，让队列继续
        console.warn(`[REDIS QUEUE] 命令执行失败: ${query}`, error);
        throw error; // 重新抛出以便调用者可以处理
      });
      
      poolChains.set(poolId, next);
      await next;
      return result;
    }
    
    // 多连接模式，直接执行
    return await run();
  } catch (error) {
    // 清理状态
    cleanupPoolResources(poolId);
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
    const criticalCommands = ['info', 'dbsize', 'config', 'client', 'slowlog'];
    if (criticalCommands.some(cmd => query.toLowerCase().includes(cmd))) {
      await checkPoolValid(poolId);
    }
    
    if (max <= 1) {
      let result: any;
      // 检查队列长度限制
      const currentQueueLength = poolQueuedCommands.get(poolId) || 0;
      if (currentQueueLength >= MAX_QUEUE_LENGTH) {
        console.warn(`[REDIS QUEUE] 连接池 ${poolId} 队列长度超过限制 (${currentQueueLength}/${MAX_QUEUE_LENGTH})`);
        cleanupPoolResources(poolId);
        throw new Error('连接池队列已满，请稍后重试');
      }
      
      // 快速失败机制：如果队列中有超过3个待执行命令，考虑队列可能被卡住
      if (currentQueueLength > 3) {
        console.warn(`[REDIS QUEUE] 连接池 ${poolId} 队列积压，清除队列重试`);
        cleanupPoolResources(poolId);
      }
      
      // 更新队列计数
      poolQueuedCommands.set(poolId, (currentQueueLength || 0) + 1);
      
      const prev = poolChains.get(poolId) || Promise.resolve();
      const next = prev.then(async () => {
        try {
          result = await run();
          return result;
        } catch (error) {
          // 清理队列以避免阻塞
          cleanupPoolResources(poolId);
          throw error;
        } finally {
          // 减少队列计数
          const current = poolQueuedCommands.get(poolId);
          if (current && current > 0) {
            poolQueuedCommands.set(poolId, current - 1);
          } else {
            poolQueuedCommands.delete(poolId);
          }
        }
      }).catch(error => {
        // 减少队列计数
        const current = poolQueuedCommands.get(poolId);
        if (current && current > 0) {
          poolQueuedCommands.set(poolId, current - 1);
        } else {
          poolQueuedCommands.delete(poolId);
        }
        
        console.warn(`[REDIS QUEUE] 超时命令执行失败: ${query}`, error);
        throw error;
      });
      
      poolChains.set(poolId, next);
      await next;
      return result;
    }
    
    // 多连接模式，直接执行
    return await run();
  } catch (error) {
    // 清理状态以便下次重试
    cleanupPoolResources(poolId);
    throw error;
  }
}

// 导出队列状态监控函数，便于调试和监控
export function getQueueStatus(): { pools: Record<string, { chain: boolean, status: { active: boolean, lastCheck: number } | undefined, queuedCommands: number }> } {
  const pools: Record<string, { chain: boolean, status: { active: boolean, lastCheck: number } | undefined, queuedCommands: number }> = {};
  
  // 遍历所有活跃的池
  const allPoolIds = new Set<string>();
  poolChains.forEach((_, id) => allPoolIds.add(id));
  poolStatus.forEach((_, id) => allPoolIds.add(id));
  poolQueuedCommands.forEach((_, id) => allPoolIds.add(id));
  
  allPoolIds.forEach(poolId => {
    pools[poolId] = {
      chain: poolChains.has(poolId),
      status: poolStatus.get(poolId),
      queuedCommands: poolQueuedCommands.get(poolId) || 0
    };
  });
  
  return { pools };
}