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
    
    try {
      // 直接使用SQL查询，确保按数据库名和模式名过滤
      const sql = `SELECT table_name FROM information_schema.tables 
                  WHERE table_catalog = $1 AND table_schema = $2 
                  ORDER BY table_name`;
      const res = await window.electronAPI.executeQuery(poolId, sql, [databaseName, currentSchema]);
      
      if (res && res.success && Array.isArray(res.data)) {
        // 确保正确提取表名
        return res.data.map((row: any) => {
          // 安全地获取表名，确保返回完整的表名而不是仅第一个字符
          const tableName = row.table_name || row[0] || '';
          // 确保返回字符串类型
          return String(tableName);
        }).filter((tableName: string) => tableName.length > 0); // 过滤空表名
      }
    } catch (error) {
      console.error('PostgreSQL getTables error:', error);
    }
    
    // 降级方案：使用原来的方法
    const res = await window.electronAPI.listTablesWithSchema(poolId, currentSchema);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data.map((row: any) => {
         const tableName = row.table_name || Object.values(row)[0] || row;
         return String(tableName);
       }).filter((tableName: string) => tableName.length > 0);
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
    
    try {
      // 先执行查询切换到目标数据库，确保获取的是指定数据库的模式列表
      // PostgreSQL使用SET search_path的方式不会真正切换数据库，需要使用专门的查询
      // 通过直接在查询中指定数据库名来获取对应数据库的模式
      const sql = `SELECT schema_name FROM information_schema.schemata WHERE catalog_name = $1`;
      const res = await window.electronAPI.executeQuery(poolId, sql, [databaseName]);
      
      if (res && res.success && Array.isArray(res.data)) {
        return res.data.map((row: any) => {
          const schemaName = row.schema_name || row.nspname || row.name;
          if (schemaName && typeof schemaName === 'string') {
            return schemaName;
          }
          return String(Object.values(row)[0]);
        }).filter((schemaName: string) => schemaName && schemaName.trim().length > 0);
      }
    } catch (error) {
      console.error('PostgreSQL getSchemas error:', error);
    }
    
    // 降级方案：使用原来的listSchemas方法
    const res = await window.electronAPI.listSchemas(poolId);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data.map((row: any) => {
        const schemaName = row.schema_name || row.nspname || row.name;
        if (schemaName && typeof schemaName === 'string') {
          return schemaName;
        }
        if (typeof row === 'object' && row !== null) {
          try {
            const values = Object.values(row);
            if (values.length > 0) {
              const firstValue = values[0];
              if (typeof firstValue === 'string') {
                return firstValue;
              }
              return String(firstValue);
            }
          } catch (e) {
            console.warn('Error extracting schema value:', e);
          }
        }
        return String(row);
      }).filter(schemaName => schemaName && schemaName.trim().length > 0);
    }
    return [];
  }
}