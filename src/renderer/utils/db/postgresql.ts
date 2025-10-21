import type { DatabaseConnection } from '../../types';
import { BaseDbUtils } from './base';
import type { DatabaseItem } from '../database-utils';

export class PostgresDbUtils extends BaseDbUtils {
  async getDatabases(connection: DatabaseConnection): Promise<DatabaseItem[]> {
    try {
      if (!window.electronAPI || !connection) return [];
      const poolId = connection.connectionId || connection.id;
      if (!poolId) return [];
      const res = await window.electronAPI.listDatabases(poolId);
      if (res && res.success && Array.isArray(res.data)) {
        return res.data.map((name: string) => ({ name, tables: [], views: [], procedures: [], functions: [], schemas: [] }));
      }
      return [];
    } catch {
      return [];
    }
  }

  async getTables(connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const currentSchema = schema || 'public';
    const sql = `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`;
    const res = await window.electronAPI.executeQuery(poolId, sql, [currentSchema]);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data.map((row: any) => row.table_name || Object.values(row)[0]);
    }
    return [];
  }

  async getViews(connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const currentSchema = schema || 'public';
    const sql = `SELECT table_name FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name`;
    const res = await window.electronAPI.executeQuery(poolId, sql, [currentSchema]);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data.map((row: any) => row.table_name || Object.values(row)[0]);
    }
    return [];
  }

  async getProcedures(connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const currentSchema = schema || 'public';
    const sql = `SELECT p.proname AS procedure_name
                 FROM pg_proc p
                 JOIN pg_namespace n ON p.pronamespace = n.oid
                 WHERE n.nspname = $1 AND p.prokind = 'p'
                 ORDER BY p.proname`;
    const res = await window.electronAPI.executeQuery(poolId, sql, [currentSchema]);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data.map((row: any) => row.procedure_name || row.proname || Object.values(row)[0]);
    }
    return [];
  }

  async getFunctions(connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const currentSchema = schema || 'public';
    const sql = `SELECT p.proname AS function_name
                 FROM pg_proc p
                 JOIN pg_namespace n ON p.pronamespace = n.oid
                 WHERE n.nspname = $1 AND p.prokind = 'f'
                 ORDER BY p.proname`;
    const res = await window.electronAPI.executeQuery(poolId, sql, [currentSchema]);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data.map((row: any) => row.function_name || row.proname || Object.values(row)[0]);
    }
    return [];
  }

  async getSchemas(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const sqlPrimary = `SELECT schema_name FROM information_schema.schemata ORDER BY schema_name`;
    const primary = await window.electronAPI.executeQuery(poolId, sqlPrimary);
    if (primary && primary.success && Array.isArray(primary.data)) {
      const schemas = primary.data.map((row: any) => row.schema_name || Object.values(row)[0]);
      return schemas.filter((s: string) => !['pg_toast', 'pg_temp_1', 'pg_toast_temp_1'].includes(s));
    }
    const sqlFallback = `SELECT nspname AS schema_name FROM pg_namespace ORDER BY nspname`;
    const fallback = await window.electronAPI.executeQuery(poolId, sqlFallback);
    if (fallback && fallback.success && Array.isArray(fallback.data)) {
      const schemas = fallback.data.map((row: any) => row.schema_name || row.nspname || Object.values(row)[0]);
      return schemas.filter((s: string) => !['pg_toast', 'pg_temp_1', 'pg_toast_temp_1'].includes(s));
    }
    return [];
  }
}