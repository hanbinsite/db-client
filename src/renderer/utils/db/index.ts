import type { DatabaseType } from '../../types'
import { RedisDbUtils } from './redis'
import { MySqlDbUtils } from './mysql'
import { PostgresDbUtils } from './postgresql'
import { GaussDbUtils } from './gauss'
import { OracleDbUtils } from './oracle'
import { SqliteDbUtils } from './sqlite'

export type DbUtilsInstance =
  | RedisDbUtils
  | MySqlDbUtils
  | PostgresDbUtils
  | GaussDbUtils
  | OracleDbUtils
  | SqliteDbUtils

export function getDbUtils(type: DatabaseType): DbUtilsInstance {
  switch (type) {
    case 'redis':
      return new RedisDbUtils()
    case 'mysql':
      return new MySqlDbUtils()
    case 'postgresql':
      return new PostgresDbUtils()
    case 'gaussdb':
      return new GaussDbUtils()
    case 'oracle':
      return new OracleDbUtils()
    case 'sqlite':
      return new SqliteDbUtils()
    default:
      return new RedisDbUtils()
  }
}