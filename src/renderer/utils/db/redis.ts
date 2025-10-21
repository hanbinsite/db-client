import type { DatabaseConnection } from '../../types';
import { BaseDbUtils } from './base';
import type { DatabaseItem } from '../database-utils';
import { execRedisQueued } from '../redis-exec-queue';

export class RedisDbUtils extends BaseDbUtils {
  async getDatabases(connection: DatabaseConnection): Promise<DatabaseItem[]> {
    return this.callWithReconnect(connection, async () => {
      const poolId = connection.connectionId || connection.id;
      if (!window.electronAPI || !poolId) return [];
      // 优先：INFO keyspace，失败时尝试重连后重试
      let infoResult = await execRedisQueued(poolId, 'info', ['keyspace']);
      if (infoResult && infoResult.success === false) {
        const msg = String((infoResult as any)?.message || (infoResult as any)?.error || '');
        if (msg.includes('连接池不存在') || msg.includes('Redis client not connected') || msg.includes('获取连接超时')) {
          try {
            const reconnect = await window.electronAPI.connectDatabase(connection);
            if (reconnect && reconnect.success && reconnect.connectionId) {
              connection.connectionId = reconnect.connectionId;
              connection.isConnected = true;
              {
                const retryPid = connection.connectionId || connection.id;
                if (!retryPid) return [];
                infoResult = await execRedisQueued(retryPid, 'info', ['keyspace']);
              }
            }
          } catch {}
        }
      }
      if (infoResult && infoResult.success) {
        const data = Array.isArray(infoResult.data) ? (infoResult.data[0]?.value ?? infoResult.data[0]) : infoResult.data;
        const infoText = String(data || '');
        const lines = infoText.split(/\r?\n/);
        const items: DatabaseItem[] = [];
        for (const line of lines) {
          // 例如: db0:keys=12345,expires=10,avg_ttl=0
          const m = line.match(/^db(\d+):\s*keys=(\d+)/i);
          if (m) {
            const name = `db${m[1]}`;
            const keyCount = parseInt(m[2], 10) || 0;
            items.push({ name, tables: [], views: [], procedures: [], functions: [], schemas: [], keyCount } as any);
          }
        }
        if (items.length > 0) {
          return items;
        }
      }
      // 回退：若未解析到keyspace信息，使用当前数据库的dbsize作为键数（失败时尝试重连后重试）
      const pidForDbsize = connection.connectionId || connection.id;
      if (!pidForDbsize) return [];
      let dbsizeResult = await execRedisQueued(pidForDbsize, 'dbsize', []);
      if (dbsizeResult && dbsizeResult.success === false) {
        const msg = String((dbsizeResult as any)?.message || (dbsizeResult as any)?.error || '');
        if (msg.includes('连接池不存在') || msg.includes('Redis client not connected') || msg.includes('获取连接超时')) {
          try {
            const reconnect = await window.electronAPI.connectDatabase(connection);
            if (reconnect && reconnect.success && reconnect.connectionId) {
              connection.connectionId = reconnect.connectionId;
              connection.isConnected = true;
              {
                const retryPid = connection.connectionId || connection.id;
                if (!retryPid) return [];
                dbsizeResult = await execRedisQueued(retryPid, 'dbsize', []);
              }
            }
          } catch {}
        }
      }
      if (dbsizeResult && dbsizeResult.success) {
        let keyCount = 0;
        const d = dbsizeResult.data;
        if (typeof d === 'number') keyCount = d;
        else if (Array.isArray(d)) {
          const v = Number(d[0]?.value ?? d[0]);
          if (Number.isFinite(v)) keyCount = v;
        } else if (typeof d === 'object' && d !== null) {
          const v = Number((d as any).value ?? d);
          if (Number.isFinite(v)) keyCount = v;
        }
        const name = connection.database || 'db0';
        return [{ name, tables: [], views: [], procedures: [], functions: [], schemas: [], keyCount } as any];
      }
      return [];
    });
  }

  async getTables(): Promise<string[]> {
    return [];
  }

  async getViews(): Promise<string[]> {
    return [];
  }

  async getProcedures(): Promise<string[]> {
    return [];
  }

  async getFunctions(): Promise<string[]> {
    return [];
  }

  async getSchemas(): Promise<string[]> {
    return [];
  }
}