import type { DatabaseConnection } from '../../types';
import { BaseDbUtils } from './base';
import type { DatabaseItem } from '../database-utils';

export class OracleDbUtils extends BaseDbUtils {
  async getDatabases(connection: DatabaseConnection): Promise<DatabaseItem[]> {
    try {
      if (!window.electronAPI || !connection) return [];
      const poolId = connection.connectionId || connection.id;
      if (!poolId) return [];
      let dbName: string | undefined = connection.database;
      try {
        const res = await window.electronAPI.executeQuery(poolId, 'SELECT NAME FROM V$DATABASE');
        if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
          const row = res.data[0];
          dbName = String((row as any).NAME ?? Object.values(row)[0] ?? dbName ?? 'ORCL');
        }
      } catch {
        dbName = dbName || connection.username || 'ORCL';
      }
      const name = dbName || connection.username || 'ORCL';
      return [{ name, tables: [], views: [], procedures: [], functions: [], schemas: [] }];
    } catch {
      return [];
    }
  }

  async getTables(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const result = await window.electronAPI.executeQuery(
      poolId,
      "SELECT table_name FROM all_tables WHERE owner = ?",
      [databaseName.toUpperCase()]
    );
    if (result && result.success && Array.isArray(result.data)) {
      return result.data.map((row: any) => row.TABLE_NAME);
    }
    return [];
  }

  async getViews(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const result = await window.electronAPI.executeQuery(
      poolId,
      "SELECT view_name FROM all_views WHERE owner = ?",
      [databaseName.toUpperCase()]
    );
    if (result && result.success && Array.isArray(result.data)) {
      return result.data.map((row: any) => row.VIEW_NAME);
    }
    return [];
  }

  async getProcedures(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const result = await window.electronAPI.executeQuery(
      poolId,
      "SELECT object_name FROM all_objects WHERE owner = ? AND object_type = 'PROCEDURE'",
      [databaseName.toUpperCase()]
    );
    if (result && result.success && Array.isArray(result.data)) {
      return result.data.map((row: any) => row.OBJECT_NAME);
    }
    return [];
  }

  async getFunctions(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const result = await window.electronAPI.executeQuery(
      poolId,
      "SELECT object_name FROM all_objects WHERE owner = ? AND object_type = 'FUNCTION'",
      [databaseName.toUpperCase()]
    );
    if (result && result.success && Array.isArray(result.data)) {
      return result.data.map((row: any) => row.OBJECT_NAME);
    }
    return [];
  }

  async getSchemas(): Promise<string[]> {
    // Oracle 模式列表目前不展示，返回空
    return [];
  }
}