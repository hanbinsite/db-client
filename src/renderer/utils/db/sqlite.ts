import type { DatabaseConnection } from '../../types';
import { BaseDbUtils } from './base';
import type { DatabaseItem } from '../database-utils';

export class SqliteDbUtils extends BaseDbUtils {
  async getDatabases(connection: DatabaseConnection): Promise<DatabaseItem[]> {
    const name = connection.database || 'main';
    return [{ name, tables: [], views: [], procedures: [], functions: [], schemas: [] }];
  }

  async getTables(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const result = await window.electronAPI.executeQuery(
      poolId,
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    if (result && result.success && Array.isArray(result.data)) {
      return result.data.map((row: any) => row.name);
    }
    return [];
  }

  async getViews(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const result = await window.electronAPI.executeQuery(
      poolId,
      "SELECT name FROM sqlite_master WHERE type='view' AND name NOT LIKE 'sqlite_%'"
    );
    if (result && result.success && Array.isArray(result.data)) {
      return result.data.map((row: any) => row.name);
    }
    return [];
  }

  async getProcedures(): Promise<string[]> {
    // SQLite不支持存储过程
    return [];
  }

  async getFunctions(): Promise<string[]> {
    // SQLite不支持用户定义函数查询（除非额外管理），此处返回空
    return [];
  }

  async getSchemas(): Promise<string[]> {
    // SQLite无多模式概念，返回空
    return [];
  }
}