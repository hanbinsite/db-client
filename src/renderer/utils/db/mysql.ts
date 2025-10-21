import type { DatabaseConnection } from '../../types';
import { BaseDbUtils } from './base';
import type { DatabaseItem } from '../database-utils';

export class MySqlDbUtils extends BaseDbUtils {
  async getDatabases(connection: DatabaseConnection): Promise<DatabaseItem[]> {
    try {
      if (!window.electronAPI || !connection) return [];
      const poolId = connection.connectionId || connection.id;
      if (!poolId) return [];
      const res = await window.electronAPI.listDatabases(poolId);
      if (res && res.success && Array.isArray(res.data)) {
        return res.data.map((name: string) => ({ name, tables: [], views: [], procedures: [], functions: [], schemas: [] }));
      }
      const fallback = await window.electronAPI.executeQuery(poolId, 'SHOW DATABASES');
      if (fallback && fallback.success && Array.isArray(fallback.data)) {
        return fallback.data.map((row: any) => ({ name: String(row.Database || Object.values(row)[0]), tables: [], views: [], procedures: [], functions: [], schemas: [] }));
      }
      return [];
    } catch {
      return [];
    }
  }

  async getTables(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const sql = `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`;
    const res = await window.electronAPI.executeQuery(poolId, sql, [databaseName]);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data.map((row: any) => row.TABLE_NAME || Object.values(row)[0]);
    }
    return [];
  }

  async getViews(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const sql = `SELECT TABLE_NAME FROM information_schema.views WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`;
    const res = await window.electronAPI.executeQuery(poolId, sql, [databaseName]);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data.map((row: any) => row.TABLE_NAME || Object.values(row)[0]);
    }
    return [];
  }

  async getProcedures(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const sql = `SELECT ROUTINE_NAME FROM information_schema.routines WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE' ORDER BY ROUTINE_NAME`;
    const res = await window.electronAPI.executeQuery(poolId, sql, [databaseName]);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data.map((row: any) => row.ROUTINE_NAME || Object.values(row)[0]);
    }
    return [];
  }

  async getFunctions(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const sql = `SELECT ROUTINE_NAME FROM information_schema.routines WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION' ORDER BY ROUTINE_NAME`;
    const res = await window.electronAPI.executeQuery(poolId, sql, [databaseName]);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data.map((row: any) => row.ROUTINE_NAME || Object.values(row)[0]);
    }
    return [];
  }

  async getSchemas(): Promise<string[]> {
    // MySQL的schema即database，前端已在数据库维度展示，此处返回空
    return [];
  }
}