import type { DatabaseConnection } from '../../types';
import { BaseDbUtils } from './base';
import type { DatabaseItem } from '../database-utils';
import { PostgresDbUtils } from './postgresql';

export class GaussDbUtils extends BaseDbUtils {
  async getDatabases(connection: DatabaseConnection): Promise<DatabaseItem[]> {
    const pg = new PostgresDbUtils();
    return pg.getDatabases(connection);
  }

  async getTables(connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> {
    const pg = new PostgresDbUtils();
    return pg.getTables(connection, databaseName, schema);
  }

  async getViews(connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> {
    const pg = new PostgresDbUtils();
    return pg.getViews(connection, databaseName, schema);
  }

  async getProcedures(connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> {
    const pg = new PostgresDbUtils();
    return pg.getProcedures(connection, databaseName, schema);
  }

  async getFunctions(connection: DatabaseConnection, databaseName: string, schema?: string): Promise<string[]> {
    const pg = new PostgresDbUtils();
    return pg.getFunctions(connection, databaseName, schema);
  }

  async getSchemas(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const pg = new PostgresDbUtils();
    return pg.getSchemas(connection, databaseName);
  }
}