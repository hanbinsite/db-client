import type { DatabaseConnection } from '../../types';
import { BaseDbUtils } from './base';
import type { DatabaseItem } from '../database-utils';
import { execRedisQueued } from '../redis-exec-queue';

export class RedisDbUtils extends BaseDbUtils {
  async getDatabases(connection: DatabaseConnection): Promise<DatabaseItem[]> {
    return this.callWithReconnect(connection, async () => {
      const poolId = connection.connectionId || connection.id;
      if (!window.electronAPI || !poolId) return [];
      const infoResult = await execRedisQueued(poolId, 'info', ['keyspace']);
      if (infoResult && infoResult.success) {
        const data = Array.isArray(infoResult.data) ? (infoResult.data[0]?.value ?? infoResult.data[0]) : infoResult.data;
        const infoText = String(data || '');
        const lines = infoText.split('\n');
        const dbNames: string[] = [];
        for (const line of lines) {
          const match = line.match(/^db(\d+):/);
          if (match) {
            dbNames.push(`db${match[1]}`);
          }
        }
        if (dbNames.length > 0) {
          return dbNames.map((name) => ({ name, tables: [], views: [], procedures: [], functions: [], schemas: [] }));
        }
      }
      const dbsizeResult = await execRedisQueued(poolId, 'dbsize', []);
      if (dbsizeResult && dbsizeResult.success) {
        const name = connection.database || 'db0';
        return [{ name, tables: [], views: [], procedures: [], functions: [], schemas: [] }];
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