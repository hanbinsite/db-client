import { format } from 'sql-formatter';

/**
 * SQL格式化配置选项
 */
export interface SqlFormatOptions {
  language?: 'sql' | 'mysql' | 'postgresql' | 'sqlite';
  keywordCase?: 'upper' | 'lower' | 'preserve';
  linesBetweenQueries?: number;
}

/**
 * SQL格式化服务
 */
export class SqlFormatterService {
  /**
   * 格式化SQL语句
   * @param sql SQL语句
   * @param options 格式化选项
   * @returns 格式化后的SQL语句
   */
  static formatSql(sql: string, options: SqlFormatOptions = {}): string {
    const { 
      language = 'sql',
      keywordCase = 'upper',
      linesBetweenQueries = 1
    } = options;

    try {
      return format(sql, {
        language,
        keywordCase,
        linesBetweenQueries
      });
    } catch (error) {
      console.error('SQL格式化失败:', error);
      return sql; // 格式化失败时返回原SQL
    }
  }

  /**
   * 根据数据库类型获取对应的SQL语言
   * @param dbType 数据库类型
   * @returns SQL语言类型
   */
  static getLanguageByDbType(dbType: string): SqlFormatOptions['language'] {
    switch (dbType.toLowerCase()) {
      case 'mysql':
        return 'mysql';
      case 'postgresql':
      case 'gaussdb':
        return 'postgresql';
      case 'sqlite':
        return 'sqlite';
      case 'redis':
        return 'sql'; // Redis命令使用基本SQL格式化
      default:
        return 'sql';
    }
  }
}
