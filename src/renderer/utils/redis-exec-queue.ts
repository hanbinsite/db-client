// Lightweight per-pool execution queue for Redis commands
// Ensures commands for single-connection pools run in serial to avoid contention/timeouts.

export type ExecParams = any[] | undefined;

const poolChains: Record<string, Promise<void>> = {};
const poolMaxConns: Record<string, number> = {};

async function getMaxConnections(poolId: string): Promise<number> {
  if (poolMaxConns[poolId] != null) return poolMaxConns[poolId];
  try {
    const cfg = await (window as any).electronAPI?.getConnectionPoolConfig?.(poolId);
    const max = (cfg && typeof cfg.maxConnections === 'number') ? cfg.maxConnections : 1;
    poolMaxConns[poolId] = max;
    return max;
  } catch {
    poolMaxConns[poolId] = 1;
    return 1;
  }
}

export async function execRedisQueued(poolId: string, query: string, params?: ExecParams): Promise<any> {
  const max = await getMaxConnections(poolId);
  const run = async () => (window as any).electronAPI?.executeQuery(poolId, query, params);
  if (max <= 1) {
    let result: any;
    const prev = poolChains[poolId] || Promise.resolve();
    const next = prev.then(async () => { result = await run(); });
    poolChains[poolId] = next.catch(() => {});
    await next;
    return result;
  }
  return await run();
}

// 新增：仅在进入队列执行时才开始计时的超时版本，避免排队时间触发"调用超时"
export async function execRedisQueuedWithTimeout(
  poolId: string,
  query: string,
  params?: ExecParams,
  timeoutMs: number = 0
): Promise<any> {
  const max = await getMaxConnections(poolId);
  const run = async () => (window as any).electronAPI?.executeQuery(poolId, query, params);
  const withTimeout = async () => {
    if (timeoutMs && timeoutMs > 0) {
      return await Promise.race([
        run(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('调用超时')), timeoutMs))
      ]);
    }
    return await run();
  };
  if (max <= 1) {
    let result: any;
    const prev = poolChains[poolId] || Promise.resolve();
    const next = prev.then(async () => { result = await withTimeout(); });
    poolChains[poolId] = next.catch(() => {});
    await next;
    return result;
  }
  return await withTimeout();
}