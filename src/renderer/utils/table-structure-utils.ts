import { DatabaseConnection } from '../types';

/**
 * 表结构信息接口
 */
export interface TableInfo {
  name: string;
  comment: string;
  options: TableOptions;
  fields: TableField[];
  indexes: TableIndex[];
  foreignKeys: TableForeignKey[];
  checks: TableCheck[];
  triggers: TableTrigger[];
}

/**
 * 表字段接口
 */
export interface TableField {
  name: string;
  type: string;
  length?: number;
  decimal?: number;
  notNull: boolean;
  virtual: boolean;
  key: string;
  comment: string;
  defaultValue?: string;
  autoIncrement?: boolean;
}

/**
 * 表索引接口
 */
export interface TableIndex {
  name: string;
  type: string; // PRIMARY, UNIQUE, INDEX, FULLTEXT, SPATIAL
  method?: string; // BTREE, HASH 等索引方法
  columns: string[];
  comment: string;
  unique: boolean;
}

/**
 * 表外键接口
 */
export interface TableForeignKey {
  name: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete: string;
  onUpdate: string;
}

/**
 * 表检查约束接口
 */
export interface TableCheck {
  name: string;
  condition: string;
  comment: string;
}

/**
 * 表触发器接口
 */
export interface TableTrigger {
  name: string;
  event: string; // INSERT, UPDATE, DELETE
  timing: string; // BEFORE, AFTER
  action: string;
  comment: string;
}

/**
 * 表选项接口
 */
export interface TableOptions {
  engine?: string;
  charset?: string;
  collation?: string;
  tablespace?: string;
  rowFormat?: string;
  autoIncrement?: number;
  avgRowLength?: number;
  maxRows?: number;
}

/**
 * 表结构查询结果接口
 */
export interface TableQueryResult<T> {
  success: boolean;
  data: T;
  error?: string;
}

/**
 * 表结构获取策略接口
 * 定义了获取表结构信息的统一方法
 */
export interface TableStructureStrategy {
  // 获取表字段信息
  getFields(poolId: string, database: string, table: string): Promise<TableQueryResult<TableField[]>>;
  
  // 获取表索引信息
  getIndexes(poolId: string, database: string, table: string): Promise<TableQueryResult<TableIndex[]>>;
  
  // 获取表外键信息
  getForeignKeys(poolId: string, database: string, table: string): Promise<TableQueryResult<TableForeignKey[]>>;
  
  // 获取表检查约束信息
  getChecks(poolId: string, database: string, table: string): Promise<TableQueryResult<TableCheck[]>>;
  
  // 获取表触发器信息
  getTriggers(poolId: string, database: string, table: string): Promise<TableQueryResult<TableTrigger[]>>;
  
  // 获取表选项信息
  getOptions(poolId: string, database: string, table: string): Promise<TableQueryResult<TableOptions>>;
  
  // 获取表注释
  getComment(poolId: string, database: string, table: string): Promise<TableQueryResult<string>>;
}

/**
 * MySQL数据库表结构获取策略
 */
export class MySQLTableStructureStrategy implements TableStructureStrategy {
  async getFields(poolId: string, database: string, table: string): Promise<TableQueryResult<TableField[]>> {
    try {
      const query = `
        SELECT 
          column_name, 
          column_type, 
          data_type, 
          character_maximum_length AS length, 
          numeric_scale AS decimal_places, 
          is_nullable = 'NO' AS not_null, 
          column_key, 
          column_comment, 
          column_default, 
          extra
        FROM information_schema.columns 
        WHERE table_schema = ? AND table_name = ? 
        ORDER BY ordinal_position
      `;
      const params = [database, table];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
          return { success: false, data: [], error: result?.error || '查询执行失败' };
        }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      // 查看原始行数据结构，帮助诊断字段名问题
      if (rows.length > 0) {
        console.log('MySQL字段原始行数据结构示例:', JSON.stringify(rows[0], null, 2));
        console.log('MySQL字段行数据所有键:', Object.keys(rows[0]));
        console.log('MySQL字段数据行数:', rows.length);
      }
      
      // 从日志分析发现，MySQL返回的字段名是大写的（COLUMN_NAME, COLUMN_TYPE等）
      // 因此我们需要优先使用大写的字段名
      const processedFields = rows.map((row: any, index: number) => {
        // 确保key字段处理正确
        let key = '';
        if (row.COLUMN_KEY) {
          key = row.COLUMN_KEY;
        } else if (row.column_key) {
          key = row.column_key;
        } else if (row.pk && row.pk === 1) {
          key = 'PRI';
        }
        
        // 获取字段类型和列类型
        const dataType = row.DATA_TYPE || row.data_type || '';
        const columnType = row.COLUMN_TYPE || row.column_type || '';
        
        // 从column_type中提取长度信息，适用于所有类型（如int(11), varchar(255)等）
        let length: number | undefined;
        const typeMatch = columnType.match(/^([a-zA-Z]+)(?:\((\d+)(?:,(\d+))?\))?$/i);
        if (typeMatch && typeMatch[2]) {
          length = parseInt(typeMatch[2], 10);
        } 
        // 如果从column_type中没有提取到长度，则使用系统表中的相应字段
        else if (row.length != null) {
          length = Number(row.length);
        } else if (row.CHARACTER_MAXIMUM_LENGTH != null) {
          length = Number(row.CHARACTER_MAXIMUM_LENGTH);
        } else if (row.NUMERIC_PRECISION != null) {
          // 对于数值类型，如果没有CHARACTER_MAXIMUM_LENGTH，尝试使用NUMERIC_PRECISION
          length = Number(row.NUMERIC_PRECISION);
        } else if (row.numeric_precision != null) {
          length = Number(row.numeric_precision);
        }
        
        // 处理小数位
        let decimal: number | undefined;
        if (typeMatch && typeMatch[3]) {
          decimal = parseInt(typeMatch[3], 10);
        } else if (row.decimal_places != null) {
          decimal = Number(row.decimal_places);
        } else if (row.NUMERIC_SCALE != null) {
          decimal = Number(row.NUMERIC_SCALE);
        } else if (row.numeric_scale != null) {
          decimal = Number(row.numeric_scale);
        }
        
        // 对于数值类型，如果没有显式设置length但有decimal，根据MySQL的行为设置默认长度
        // 这是为了确保int、bigint等类型的字段能够显示正确的长度
        if (['int', 'bigint', 'smallint', 'tinyint', 'mediumint', 'float', 'double', 'decimal'].includes(dataType.toLowerCase()) && 
            length === undefined) {
          // 设置常见数值类型的默认长度
          const defaultLengths: Record<string, number> = {
            'tinyint': 4,
            'smallint': 6,
            'mediumint': 9,
            'int': 11,
            'bigint': 20,
            'float': 10,
            'double': 22,
            'decimal': 10
          };
          length = defaultLengths[dataType.toLowerCase()] || 11;
        }
        // 优先使用大写字段名，因为MySQL返回的是大写
        const processedField = {
          name: row.COLUMN_NAME || row.column_name || '',
          type: dataType.toLowerCase(),
          length: length,
          decimal: decimal,
          // 确保notNull字段有明确的布尔值
          notNull: row.not_null !== undefined ? !!row.not_null : (row.IS_NULLABLE === 'NO'),
          // MySQL不直接支持virtual字段，默认设为false
          virtual: false,
          // 确保key字段不为空
          key: key || '',
          // 确保comment字段不为空
          comment: row.COLUMN_COMMENT || row.column_comment || '',
          defaultValue: row.COLUMN_DEFAULT !== undefined ? row.COLUMN_DEFAULT : (row.column_default !== undefined ? row.column_default : ''),
          autoIncrement: (row.EXTRA && row.EXTRA.includes('auto_increment')) || (row.extra && row.extra.includes('auto_increment'))
        };
        
        console.log(`处理第${index+1}个字段的原始数据:`, row);
        console.log(`处理第${index+1}个字段的结果:`, processedField);
        return processedField;
      });
      
      console.log('MySQL字段数据处理完成:', JSON.stringify(processedFields, null, 2));
      return { success: true, data: processedFields };
    } catch (error) {
      console.error('MySQL获取表字段信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getIndexes(poolId: string, database: string, table: string): Promise<TableQueryResult<TableIndex[]>> {
    try {
      // 先切换到正确的数据库
      await window.electronAPI.executeQuery(poolId, `USE ${database}`);
      
      // 使用SHOW INDEX语句获取更完整的索引信息
      const query = `SHOW INDEX FROM \`${table}\``;
      const result = await window.electronAPI.executeQuery(poolId, query, []);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      // 按索引名分组处理
      const indexMap = new Map<string, {columns: string[], type: string, method: string, comment: string, unique: boolean}>();
      
      rows.forEach((row: any) => {
        // 标准化字段名
        const keyName = row.Key_name || row.key_name || '';
        const columnName = row.Column_name || row.column_name || '';
        const indexType = row.Index_type || row.index_type || 'BTREE';
        const nonUnique = row.Non_unique !== undefined ? row.Non_unique : (row.non_unique !== undefined ? row.non_unique : 1);
        const comment = row.Comment || row.comment || '';
        const indexComment = row.Index_comment || row.index_comment || '';
        
        // 确定索引类型
        let type = 'INDEX'; // 默认类型
        if (keyName.toUpperCase() === 'PRIMARY') {
          type = 'PRIMARY';
        } else if (nonUnique === 0) {
          type = 'UNIQUE';
        } else if (comment.toUpperCase().includes('FULLTEXT')) {
          type = 'FULLTEXT';
        } else if (comment.toUpperCase().includes('SPATIAL')) {
          type = 'SPATIAL';
        }
        
        // 索引方法
        const method = indexType.toUpperCase();
        
        if (!indexMap.has(keyName)) {
          indexMap.set(keyName, {
            columns: [columnName],
            type: type,
            method: method,
            comment: indexComment,
            unique: nonUnique === 0
          });
        } else {
          const indexInfo = indexMap.get(keyName)!;
          indexInfo.columns.push(columnName);
        }
      });
      
      // 转换为TableIndex数组
      const processedIndexes = Array.from(indexMap.entries()).map(([name, info]) => ({
        name: name,
        type: info.type,
        method: info.method, // 添加索引方法字段
        columns: info.columns,
        comment: info.comment,
        unique: info.unique
      }));
      
      return { success: true, data: processedIndexes };
    } catch (error) {
      console.error('MySQL获取表索引信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getForeignKeys(poolId: string, database: string, table: string): Promise<TableQueryResult<TableForeignKey[]>> {
    try {
      const query = `
        SELECT 
          rc.constraint_name, 
          group_concat(kcu.column_name ORDER BY kcu.ordinal_position SEPARATOR ', ') AS columns, 
          referenced_table_name, 
          group_concat(kcu.referenced_column_name ORDER BY kcu.ordinal_position SEPARATOR ', ') AS referenced_columns,
          delete_rule AS on_delete,
          update_rule AS on_update
        FROM information_schema.referential_constraints rc
        JOIN information_schema.key_column_usage kcu ON rc.constraint_name = kcu.constraint_name AND rc.constraint_schema = kcu.constraint_schema
        WHERE rc.constraint_schema = ? AND kcu.table_name = ?
        GROUP BY rc.constraint_name, referenced_table_name, delete_rule, update_rule
      `;
      const params = [database, table];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      const processedForeignKeys = rows.map((row: any) => ({
        name: row.constraint_name,
        columns: row.columns ? row.columns.split(', ') : [row.columns],
        referencedTable: row.referenced_table_name,
        referencedColumns: row.referenced_columns ? row.referenced_columns.split(', ') : [row.referenced_columns],
        onDelete: row.on_delete || 'NO ACTION',
        onUpdate: row.on_update || 'NO ACTION'
      }));
      
      return { success: true, data: processedForeignKeys };
    } catch (error) {
      console.error('MySQL获取表外键信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getChecks(poolId: string, database: string, table: string): Promise<TableQueryResult<TableCheck[]>> {
    try {
      const query = `
        SELECT 
          constraint_name, 
          check_clause AS \`condition\`
        FROM information_schema.check_constraints
        WHERE constraint_schema = ? AND table_name = ?
      `;
      const params = [database, table];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      const processedChecks = rows.map((row: any) => ({
        name: row.constraint_name,
        condition: row.condition || row.check_clause,
        comment: '' // 简化处理
      }));
      
      return { success: true, data: processedChecks };
    } catch (error) {
      console.error('MySQL获取表检查约束信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getTriggers(poolId: string, database: string, table: string): Promise<TableQueryResult<TableTrigger[]>> {
    try {
      const query = `
        SHOW TRIGGERS FROM ${database}
      `;
      const result = await window.electronAPI.executeQuery(poolId, query, []);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      const processedTriggers = rows.map((row: any) => ({
        name: row.Trigger || row.trigger_name,
        event: row.Event || row.event,
        timing: row.Timing || row.timing,
        action: row.Action || row.action,
        comment: '' // 简化处理
      }));
      
      return { success: true, data: processedTriggers };
    } catch (error) {
      console.error('MySQL获取表触发器信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getOptions(poolId: string, database: string, table: string): Promise<TableQueryResult<TableOptions>> {
    try {
      const query = `
        SELECT 
          engine, 
          table_collation AS collation, 
          create_options,
          auto_increment
        FROM information_schema.tables 
        WHERE table_schema = ? AND table_name = ?
      `;
      const params = [database, table];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: {}, error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: {} };
      }
      
      const row = rows[0];
      const options: TableOptions = {};
      
      if (row.engine) options.engine = row.engine;
      if (row.collation) {
        options.collation = row.collation;
        // 从collation中提取charset
        const charsetMatch = row.collation.match(/^(.+)_/);
        if (charsetMatch && charsetMatch[1]) {
          options.charset = charsetMatch[1];
        }
      }
      if (row.auto_increment) options.autoIncrement = row.auto_increment;
      
      return { success: true, data: options };
    } catch (error) {
      console.error('MySQL获取表选项信息异常:', error);
      return { success: false, data: {}, error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getComment(poolId: string, database: string, table: string): Promise<TableQueryResult<string>> {
    try {
      const query = `
        SELECT table_comment 
        FROM information_schema.tables 
        WHERE table_schema = ? AND table_name = ?
      `;
      const params = [database, table];
      console.log(`MySQL获取表注释 - 执行查询: ${query}`);
      console.log(`MySQL获取表注释 - 查询参数: [${database}, ${table}]`);
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result) {
        console.error('MySQL获取表注释 - 查询结果为空');
        return { success: false, data: '', error: '查询结果为空' };
      }
      
      if (!result.success) {
        console.error('MySQL获取表注释 - 查询失败:', result.error);
        return { success: false, data: '', error: result?.error || '查询执行失败' };
      }
      
      console.log('MySQL获取表注释 - 查询结果:', JSON.stringify(result, null, 2));
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
        console.log('MySQL获取表注释 - 直接从data获取行数据，行数:', rows.length);
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
        console.log('MySQL获取表注释 - 从data.rows获取行数据，行数:', rows.length);
      } else {
        console.log('MySQL获取表注释 - 结果数据格式:', typeof result.data);
      }
      
      if (rows.length === 0) {
        console.log('MySQL获取表注释 - 未找到表注释数据');
        return { success: true, data: '' };
      }
      
      console.log('MySQL获取表注释 - 找到的表注释行数据:', JSON.stringify(rows[0], null, 2));
      
      // 处理大小写敏感性问题
      let commentValue = '';
      if (rows[0].table_comment) {
        commentValue = rows[0].table_comment;
        console.log('MySQL获取表注释 - 通过小写table_comment找到值:', commentValue);
      } else if (rows[0].TABLE_COMMENT) {
        commentValue = rows[0].TABLE_COMMENT;
        console.log('MySQL获取表注释 - 通过大写TABLE_COMMENT找到值:', commentValue);
      }
      
      console.log('MySQL获取表注释 - 最终表注释值:', commentValue);
      
      return { success: true, data: commentValue || '' };
    } catch (error) {
      console.error('MySQL获取表注释异常:', error);
      return { success: false, data: '', error: `查询过程出错: ${(error as Error).message}` };
    }
  }
}

/**
 * PostgreSQL数据库表结构获取策略
 */
export class PostgreSQLTableStructureStrategy implements TableStructureStrategy {
  async getFields(poolId: string, database: string, table: string): Promise<TableQueryResult<TableField[]>> {
    try {
      const query = `
        SELECT 
          column_name, 
          data_type, 
          character_maximum_length AS length, 
          numeric_scale AS decimal, 
          is_nullable = 'NO' AS not_null, 
          CASE 
            WHEN constraint_type = 'PRIMARY KEY' THEN 'PRI' 
            WHEN constraint_type = 'UNIQUE' THEN 'UNI' 
            ELSE '' 
          END AS column_key, 
          column_comment, 
          column_default, 
          'generated' AS extra
        FROM information_schema.columns 
        LEFT JOIN information_schema.key_column_usage USING (table_schema, table_name, column_name)
        LEFT JOIN information_schema.table_constraints USING (table_schema, table_name, constraint_name)
        WHERE table_schema = 'public' AND table_name = ? 
        ORDER BY ordinal_position
      `;
      const params = [table];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      const processedFields = rows.map((row: any) => {
        let key = '';
        if (row.column_key) {
          key = row.column_key;
        } else if (row.pk && row.pk === 1) {
          key = 'PRI';
        }
        
        // 确保所有字段都有默认值并与前端期望的格式匹配
        return {
          name: row.column_name || row.name || '',
          type: row.data_type || row.type || '',
          // 转换为字符串格式，确保前端能正确显示
          length: row.length !== undefined ? row.length.toString() : (row.character_maximum_length !== undefined ? row.character_maximum_length.toString() : undefined),
          // 统一小数位数字段，转换为字符串格式
          decimal: row.decimal !== undefined ? row.decimal.toString() : (row.numeric_scale !== undefined ? row.numeric_scale.toString() : undefined),
          notNull: row.not_null !== undefined ? !!row.not_null : (row.nullable === 'N'),
          virtual: !!row.virtual,
          key: key,
          comment: row.column_comment || row.comment || '',
          defaultValue: row.column_default || row.dflt_value || '',
          autoIncrement: false // PostgreSQL使用序列而非AUTO_INCREMENT
        };
      });
      
      return { success: true, data: processedFields };
    } catch (error) {
      console.error('PostgreSQL获取表字段信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getIndexes(poolId: string, database: string, table: string): Promise<TableQueryResult<TableIndex[]>> {
    try {
      const query = `
        SELECT 
          i.relname AS index_name, 
          am.amname AS index_type, 
          array_to_string(array_agg(a.attname), ', ') AS columns, 
          d.description AS index_comment
        FROM pg_class t
        JOIN pg_index ix ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_am am ON i.relam = am.oid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
        LEFT JOIN pg_description d ON d.objoid = i.oid
        WHERE t.relname = ? AND t.relkind = 'r'
        GROUP BY i.relname, am.amname, d.description
      `;
      const params = [table];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      const processedIndexes = rows.map((row: any) => ({
        name: row.index_name || row.name,
        type: row.index_type || 'INDEX',
        columns: row.columns ? row.columns.split(', ') : [],
        comment: row.index_comment || row.description || '',
        unique: (row.index_type || '').toUpperCase() === 'UNIQUE' || (row.type || '').toUpperCase() === 'UNIQUE'
      }));
      
      return { success: true, data: processedIndexes };
    } catch (error) {
      console.error('PostgreSQL获取表索引信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getForeignKeys(poolId: string, database: string, table: string): Promise<TableQueryResult<TableForeignKey[]>> {
    try {
      const query = `
        SELECT 
          conname AS constraint_name, 
          a.attname AS columns, 
          c.relname AS referenced_table_name, 
          a_ref.attname AS referenced_columns,
          CASE confdeltype
            WHEN 'a' THEN 'NO ACTION'
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT'
            ELSE 'NO ACTION'
          END AS on_delete,
          CASE confupdtype
            WHEN 'a' THEN 'NO ACTION'
            WHEN 'r' THEN 'RESTRICT'
            WHEN 'c' THEN 'CASCADE'
            WHEN 'n' THEN 'SET NULL'
            WHEN 'd' THEN 'SET DEFAULT'
            ELSE 'NO ACTION'
          END AS on_update
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_class rel_ref ON rel_ref.oid = con.confrelid
        JOIN pg_attribute a ON a.attrelid = rel.oid AND a.attnum = con.conkey[1]
        JOIN pg_attribute a_ref ON a_ref.attrelid = rel_ref.oid AND a_ref.attnum = con.confkey[1]
        WHERE con.contype = 'f' AND rel.relname = ?
      `;
      const params = [table];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      const processedForeignKeys = rows.map((row: any) => ({
        name: row.constraint_name,
        columns: row.columns ? row.columns.split(', ') : [row.columns],
        referencedTable: row.referenced_table_name,
        referencedColumns: row.referenced_columns ? row.referenced_columns.split(', ') : [row.referenced_columns],
        onDelete: row.on_delete || 'NO ACTION',
        onUpdate: row.on_update || 'NO ACTION'
      }));
      
      return { success: true, data: processedForeignKeys };
    } catch (error) {
      console.error('PostgreSQL获取表外键信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getChecks(poolId: string, database: string, table: string): Promise<TableQueryResult<TableCheck[]>> {
    try {
      const query = `
        SELECT 
          conname AS constraint_name, 
          pg_get_constraintdef(oid) AS condition
        FROM pg_constraint
        WHERE contype = 'c' AND conrelid = (SELECT oid FROM pg_class WHERE relname = ?)
      `;
      const params = [table];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      const processedChecks = rows.map((row: any) => ({
        name: row.constraint_name,
        condition: row.condition || row.check_clause || row.search_condition,
        comment: '' // 简化处理
      }));
      
      return { success: true, data: processedChecks };
    } catch (error) {
      console.error('PostgreSQL获取表检查约束信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getTriggers(poolId: string, database: string, table: string): Promise<TableQueryResult<TableTrigger[]>> {
    try {
      const query = `
        SELECT 
          tgname AS trigger_name, 
          tgevent AS event, 
          tgwhen AS timing,
          pg_get_triggerdef(t.oid) AS action
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        WHERE c.relname = ?
      `;
      const params = [table];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      const processedTriggers = rows.map((row: any) => ({
        name: row.trigger_name,
        event: row.event,
        timing: row.timing,
        action: row.action,
        comment: '' // 简化处理
      }));
      
      return { success: true, data: processedTriggers };
    } catch (error) {
      console.error('PostgreSQL获取表触发器信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getOptions(poolId: string, database: string, table: string): Promise<TableQueryResult<TableOptions>> {
    try {
      const query = `
        SELECT 
          reloptions,
          tablespace
        FROM pg_class
        WHERE relname = ? AND relkind = 'r'
      `;
      const params = [table];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: {}, error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: {} };
      }
      
      const row = rows[0];
      const options: TableOptions = {};
      
      if (row.tablespace) options.tablespace = row.tablespace;
      
      return { success: true, data: options };
    } catch (error) {
      console.error('PostgreSQL获取表选项信息异常:', error);
      return { success: false, data: {}, error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getComment(poolId: string, database: string, table: string): Promise<TableQueryResult<string>> {
    try {
      // 确保数据库名不为空，默认为'public'
      const schemaName = database || 'public';
      
      const query = `
        SELECT obj_description(c.oid) AS table_comment
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = ? AND c.relkind = 'r' AND n.nspname = ?
      `;
      const params = [table, schemaName];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      console.log(`PostgreSQL获取表注释 - 执行查询: ${query}`);
      console.log(`PostgreSQL获取表注释 - 查询参数: [${table}, ${schemaName}]`);
      
      if (!result) {
        console.error('PostgreSQL获取表注释 - 查询结果为空');
        return { success: false, data: '', error: '查询结果为空' };
      }
      
      if (!result.success) {
        console.error('PostgreSQL获取表注释 - 查询失败:', result.error);
        return { success: false, data: '', error: result?.error || '查询执行失败' };
      }
      
      console.log('PostgreSQL获取表注释 - 查询结果:', JSON.stringify(result, null, 2));
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
        console.log('PostgreSQL获取表注释 - 直接从data获取行数据，行数:', rows.length);
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
        console.log('PostgreSQL获取表注释 - 从data.rows获取行数据，行数:', rows.length);
      } else {
        console.log('PostgreSQL获取表注释 - 结果数据格式:', typeof result.data);
      }
      
      if (rows.length === 0) {
        return { success: true, data: '' };
      }
      
      return { success: true, data: rows[0].table_comment || '' };
    } catch (error) {
      console.error('PostgreSQL获取表注释异常:', error);
      return { success: false, data: '', error: `查询过程出错: ${(error as Error).message}` };
    }
  }
}

/**
 * Oracle数据库表结构获取策略
 */
export class OracleTableStructureStrategy implements TableStructureStrategy {
  async getFields(poolId: string, database: string, table: string): Promise<TableQueryResult<TableField[]>> {
    try {
      const query = `
        SELECT 
          tc.column_name, 
          tc.data_type, 
          tc.data_length AS length, 
          tc.data_scale AS decimal, 
          tc.nullable = 'N' AS not_null, 
          CASE 
            WHEN ac.constraint_type = 'P' THEN 'PRI' 
            WHEN ac.constraint_type = 'U' THEN 'UNI' 
            ELSE '' 
          END AS column_key, 
          tcc.comments AS column_comment, 
          tc.data_default AS column_default
        FROM all_tab_columns tc
        LEFT JOIN all_col_comments tcc ON tc.owner = tcc.owner AND tc.table_name = tcc.table_name AND tc.column_name = tcc.column_name
        LEFT JOIN all_constraints ac ON tc.owner = ac.owner AND tc.table_name = ac.table_name
        LEFT JOIN all_cons_columns acc ON ac.constraint_name = acc.constraint_name AND ac.owner = acc.owner AND ac.table_name = acc.table_name AND tc.column_name = acc.column_name
        WHERE tc.owner = ? AND tc.table_name = ? 
        ORDER BY tc.column_id
      `;
      const params = [database.toUpperCase(), table.toUpperCase()];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      const processedFields = rows.map((row: any) => {
        let key = '';
        if (row.column_key) {
          key = row.column_key;
        }
        
        // 确保所有字段都有默认值并与前端期望的格式匹配
        return {
          name: row.column_name || row.name || '',
          type: row.data_type || row.type || '',
          // 转换为字符串格式，确保前端能正确显示
          length: row.length !== undefined ? row.length.toString() : undefined,
          // 统一小数位数字段，转换为字符串格式
          decimal: (row.decimal !== undefined || row.data_scale !== undefined) ? (row.decimal || row.data_scale || 0).toString() : undefined,
          notNull: row.not_null !== undefined ? !!row.not_null : (row.nullable === 'N'),
          virtual: !!row.virtual,
          key: key,
          comment: row.column_comment || row.comments || '',
          defaultValue: row.column_default || row.data_default || '',
          autoIncrement: false // Oracle使用序列而非AUTO_INCREMENT
        };
      });
      
      return { success: true, data: processedFields };
    } catch (error) {
      console.error('Oracle获取表字段信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getIndexes(poolId: string, database: string, table: string): Promise<TableQueryResult<TableIndex[]>> {
    try {
      const query = `
        SELECT 
          i.index_name, 
          i.uniqueness AS index_type, 
          listagg(c.column_name, ', ') WITHIN GROUP (ORDER BY c.column_position) AS columns,
          c.comments AS index_comment
        FROM all_indexes i
        JOIN all_ind_columns c ON i.index_name = c.index_name AND i.table_name = c.table_name AND i.owner = c.index_owner
        WHERE i.table_owner = ? AND i.table_name = ?
        GROUP BY i.index_name, i.uniqueness, c.comments
      `;
      const params = [database.toUpperCase(), table.toUpperCase()];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      const processedIndexes = rows.map((row: any) => ({
        name: row.index_name || row.name,
        type: row.index_type || row.uniqueness || 'INDEX',
        columns: row.columns ? row.columns.split(', ') : [],
        comment: row.index_comment || row.comments || '',
        unique: (row.uniqueness || '').toUpperCase() === 'UNIQUE' || (row.index_type || '').toUpperCase() === 'UNIQUE'
      }));
      
      return { success: true, data: processedIndexes };
    } catch (error) {
      console.error('Oracle获取表索引信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getForeignKeys(poolId: string, database: string, table: string): Promise<TableQueryResult<TableForeignKey[]>> {
    try {
      const query = `
        SELECT 
          rc.constraint_name, 
          c.column_name AS columns, 
          rcc.table_name AS referenced_table_name, 
          rcc.column_name AS referenced_columns,
          rc.delete_rule AS on_delete,
          rc.update_rule AS on_update
        FROM all_constraints rc
        JOIN all_cons_columns c ON rc.constraint_name = c.constraint_name AND rc.owner = c.owner
        JOIN all_cons_columns rcc ON rc.r_constraint_name = rcc.constraint_name AND rc.r_owner = rcc.owner
        WHERE rc.constraint_type = 'R' AND rc.table_name = ? AND rc.owner = ?
      `;
      const params = [table.toUpperCase(), database.toUpperCase()];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      const processedForeignKeys = rows.map((row: any) => ({
        name: row.constraint_name,
        columns: row.columns ? row.columns.split(', ') : [row.columns],
        referencedTable: row.referenced_table_name,
        referencedColumns: row.referenced_columns ? row.referenced_columns.split(', ') : [row.referenced_columns],
        onDelete: row.on_delete || 'NO ACTION',
        onUpdate: row.on_update || 'NO ACTION'
      }));
      
      return { success: true, data: processedForeignKeys };
    } catch (error) {
      console.error('Oracle获取表外键信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getChecks(poolId: string, database: string, table: string): Promise<TableQueryResult<TableCheck[]>> {
    try {
      const query = `
        SELECT 
          constraint_name, 
          search_condition AS condition
        FROM all_constraints
        WHERE constraint_type = 'C' AND table_name = ? AND owner = ?
      `;
      const params = [table.toUpperCase(), database.toUpperCase()];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      const processedChecks = rows.map((row: any) => ({
        name: row.constraint_name,
        condition: row.condition || row.check_clause || row.search_condition,
        comment: '' // 简化处理
      }));
      
      return { success: true, data: processedChecks };
    } catch (error) {
      console.error('Oracle获取表检查约束信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getTriggers(poolId: string, database: string, table: string): Promise<TableQueryResult<TableTrigger[]>> {
    try {
      const query = `
        SELECT 
          trigger_name, 
          triggering_event AS event, 
          trigger_type AS timing,
          trigger_body AS action
        FROM all_triggers
        WHERE table_name = ? AND owner = ?
      `;
      const params = [table.toUpperCase(), database.toUpperCase()];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      const processedTriggers = rows.map((row: any) => ({
        name: row.trigger_name,
        event: row.event || row.triggering_event,
        timing: row.timing || row.trigger_type,
        action: row.action || row.trigger_body,
        comment: '' // 简化处理
      }));
      
      return { success: true, data: processedTriggers };
    } catch (error) {
      console.error('Oracle获取表触发器信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getOptions(poolId: string, database: string, table: string): Promise<TableQueryResult<TableOptions>> {
    try {
      // Oracle不支持通过简单查询获取表选项，返回空对象
      return { success: true, data: {} };
    } catch (error) {
      console.error('Oracle获取表选项信息异常:', error);
      return { success: false, data: {}, error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getComment(poolId: string, database: string, table: string): Promise<TableQueryResult<string>> {
    try {
      const query = `
        SELECT comments AS table_comment
        FROM all_tab_comments
        WHERE table_name = ? AND owner = ?
      `;
      const params = [table.toUpperCase(), database.toUpperCase()];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: '', error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: '' };
      }
      
      return { success: true, data: rows[0].table_comment || '' };
    } catch (error) {
      console.error('Oracle获取表注释异常:', error);
      return { success: false, data: '', error: `查询过程出错: ${(error as Error).message}` };
    }
  }
}

/**
 * SQLite数据库表结构获取策略
 */
export class SQLiteTableStructureStrategy implements TableStructureStrategy {
  async getFields(poolId: string, database: string, table: string): Promise<TableQueryResult<TableField[]>> {
    try {
      const query = `PRAGMA table_info(${table})`;
      const result = await window.electronAPI.executeQuery(poolId, query, []);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      // 确保所有字段都有默认值并与前端期望的格式匹配
      const processedFields = rows.map((row: any) => ({
        name: row.name || '',
        type: row.type || '',
        length: undefined, // SQLite不直接支持长度
        decimal: undefined, // SQLite不直接支持小数位数
        notNull: row.notnull === 1,
        virtual: !!row.virtual,
        key: row.pk === 1 ? 'PRI' : '',
        comment: '', // SQLite不支持字段注释
        defaultValue: row.dflt_value || '',
        autoIncrement: false // SQLite使用AUTOINCREMENT关键字，但这里简化处理
      }));
      
      return { success: true, data: processedFields };
    } catch (error) {
      console.error('SQLite获取表字段信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getIndexes(poolId: string, database: string, table: string): Promise<TableQueryResult<TableIndex[]>> {
    try {
      const query = `PRAGMA index_list(${table})`;
      const result = await window.electronAPI.executeQuery(poolId, query, []);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      // SQLite的index_list只返回索引名称，需要进一步查询每个索引的列信息
      const processedIndexes: TableIndex[] = [];
      for (const row of rows) {
        // 安全地处理索引名称，避免SQL注入
        const indexName = row.name || '';
        if (!indexName) continue;
        
        const indexInfoQuery = `PRAGMA index_info('${indexName.replace(/'/g, "''")}')`;
        const indexInfoResult = await window.electronAPI.executeQuery(poolId, indexInfoQuery, []);
        
        if (indexInfoResult && indexInfoResult.success) {
          let indexRows: any[] = [];
          if (Array.isArray(indexInfoResult.data)) {
            indexRows = indexInfoResult.data;
          } else if (indexInfoResult.data && Array.isArray(indexInfoResult.data.rows)) {
            indexRows = indexInfoResult.data.rows;
          }
          
          // 确保索引行数据正确
          if (!Array.isArray(indexRows)) {
            console.warn(`索引${indexName}的列信息格式不正确:`, indexInfoResult.data);
            continue;
          }
          
          const columns = indexRows.map((col: any) => col.name || '').filter((name: string) => name);
          processedIndexes.push({
            name: indexName,
            type: row.unique ? 'UNIQUE' : 'INDEX',
            columns: columns,
            comment: '' // SQLite不支持索引注释
            , unique: row.unique === true
          });
        } else {
          console.warn(`获取索引${indexName}信息失败:`, indexInfoResult?.error);
          // 即使获取索引列信息失败，也添加索引基本信息
          processedIndexes.push({
            name: indexName,
            type: row.unique ? 'UNIQUE' : 'INDEX',
            columns: [],
            comment: '',
            unique: row.unique === true
          });
        }
      }
      
      // 记录处理后的索引数量以便调试
      console.log(`SQLite表${table}处理后的索引数量:`, processedIndexes.length);
      
      return { success: true, data: processedIndexes };
    } catch (error) {
      console.error('SQLite获取表索引信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getForeignKeys(poolId: string, database: string, table: string): Promise<TableQueryResult<TableForeignKey[]>> {
    try {
      const query = `PRAGMA foreign_key_list(${table})`;
      const result = await window.electronAPI.executeQuery(poolId, query, []);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      // 按外键名称分组，因为SQLite的foreign_key_list为每个列返回一行
      const foreignKeyGroups: Record<string, any[]> = {};
      for (const row of rows) {
        const fkName = row.id; // SQLite使用id标识外键组
        if (!foreignKeyGroups[fkName]) {
          foreignKeyGroups[fkName] = [];
        }
        foreignKeyGroups[fkName].push(row);
      }
      
      const processedForeignKeys: TableForeignKey[] = [];
      for (const fkName in foreignKeyGroups) {
        const fkRows = foreignKeyGroups[fkName];
        if (fkRows.length > 0) {
          const firstRow = fkRows[0];
          const columns = fkRows.map(row => row.from);
          const referencedColumns = fkRows.map(row => row.to);
          
          processedForeignKeys.push({
            name: firstRow.id.toString(), // SQLite不存储外键名称，使用id代替
            columns: columns,
            referencedTable: firstRow.table,
            referencedColumns: referencedColumns,
            onDelete: firstRow.on_delete || 'NO ACTION',
            onUpdate: firstRow.on_update || 'NO ACTION'
          });
        }
      }
      
      return { success: true, data: processedForeignKeys };
    } catch (error) {
      console.error('SQLite获取表外键信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getChecks(poolId: string, database: string, table: string): Promise<TableQueryResult<TableCheck[]>> {
    try {
      // SQLite不支持显式的检查约束，返回空数组
      return { success: true, data: [] };
    } catch (error) {
      console.error('SQLite获取表检查约束信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getTriggers(poolId: string, database: string, table: string): Promise<TableQueryResult<TableTrigger[]>> {
    try {
      const query = `SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?`;
      const params = [table];
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      
      if (!result || !result.success) {
        return { success: false, data: [], error: result?.error || '查询执行失败' };
      }
      
      let rows: any[] = [];
      if (Array.isArray(result.data)) {
        rows = result.data;
      } else if (result.data && Array.isArray(result.data.rows)) {
        rows = result.data.rows;
      }
      
      if (rows.length === 0) {
        return { success: true, data: [] };
      }
      
      const processedTriggers = rows.map((row: any) => ({
        name: row.name,
        event: 'UNKNOWN', // SQLite不直接提供触发器事件类型
        timing: 'UNKNOWN', // SQLite不直接提供触发器时机
        action: row.sql || '',
        comment: '' // SQLite不支持触发器注释
      }));
      
      return { success: true, data: processedTriggers };
    } catch (error) {
      console.error('SQLite获取表触发器信息异常:', error);
      return { success: false, data: [], error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getOptions(poolId: string, database: string, table: string): Promise<TableQueryResult<TableOptions>> {
    try {
      // SQLite不支持表选项，返回空对象
      return { success: true, data: {} };
    } catch (error) {
      console.error('SQLite获取表选项信息异常:', error);
      return { success: false, data: {}, error: `查询过程出错: ${(error as Error).message}` };
    }
  }
  
  async getComment(poolId: string, database: string, table: string): Promise<TableQueryResult<string>> {
    try {
      // SQLite不支持表注释，返回空字符串
      return { success: true, data: '' };
    } catch (error) {
      console.error('SQLite获取表注释异常:', error);
      return { success: false, data: '', error: `查询过程出错: ${(error as Error).message}` };
    }
  }
}

/**
 * 表结构获取策略工厂类
 * 根据数据库类型返回相应的表结构获取策略
 */
export class TableStructureStrategyFactory {
  /**
   * 根据数据库连接对象获取对应的表结构获取策略
   * @param connection 数据库连接对象
   * @returns 表结构获取策略实例
   */
  static getStrategy(connection: DatabaseConnection): TableStructureStrategy {
    switch (connection.type) {
      case 'mysql':
        return new MySQLTableStructureStrategy();
      case 'postgresql':
      case 'gaussdb':
        return new PostgreSQLTableStructureStrategy();
      case 'oracle':
        return new OracleTableStructureStrategy();
      case 'sqlite':
        return new SQLiteTableStructureStrategy();
      default:
        // 对于不支持的数据库类型，使用MySQL策略作为默认策略
        // 实际应用中可能需要提供一个默认策略或抛出异常
        console.warn(`不支持的数据库类型: ${connection.type}，使用MySQL策略作为默认策略`);
        return new MySQLTableStructureStrategy();
    }
  }
}

/**
 * 表结构数据类型定义
 */
export type TableStructureDataType = 'fields' | 'indexes' | 'foreignKeys' | 'checks' | 'triggers' | 'options' | 'comment';

/**
 * 表结构数据加载状态
 */
export interface TableStructureLoadingStatus {
  fields: boolean;
  indexes: boolean;
  foreignKeys: boolean;
  checks: boolean;
  triggers: boolean;
  options: boolean;
  comment: boolean;
}

/**
 * 表结构数据加载结果
 */
export interface ProgressiveTableStructureResult {
  success: boolean;
  data: Partial<TableInfo>;
  loadingStatus?: TableStructureLoadingStatus;
  error?: string;
  completedTypes: TableStructureDataType[];
}

/**
 * 获取完整的表结构信息
 * @param connection 数据库连接对象
 * @param database 数据库名称
 * @param table 表名称
 * @returns Promise<TableQueryResult<TableInfo>> 表结构信息查询结果
 */
export const getCompleteTableStructure = async (
  connection: DatabaseConnection,
  database: string,
  table: string
): Promise<TableQueryResult<TableInfo>> => {
  try {
    if (!connection || !database || !table || !connection.isConnected) {
      return { success: false, data: {} as TableInfo, error: '连接信息不完整或未连接' };
    }
    
    const poolId = connection.connectionId || connection.id;
    const strategy = TableStructureStrategyFactory.getStrategy(connection);
    
    // 并行获取所有表结构信息
    const [
      fieldsResult,
      indexesResult,
      foreignKeysResult,
      checksResult,
      triggersResult,
      optionsResult,
      commentResult
    ] = await Promise.all([
      strategy.getFields(poolId, database, table),
      strategy.getIndexes(poolId, database, table),
      strategy.getForeignKeys(poolId, database, table),
      strategy.getChecks(poolId, database, table),
      strategy.getTriggers(poolId, database, table),
      strategy.getOptions(poolId, database, table),
      strategy.getComment(poolId, database, table)
    ]);
    
    // 构建完整的表结构信息
    const tableInfo: TableInfo = {
      name: table,
      comment: commentResult.success ? commentResult.data : '',
      options: optionsResult.success ? optionsResult.data : {},
      fields: fieldsResult.success ? fieldsResult.data : [],
      indexes: indexesResult.success ? indexesResult.data : [],
      foreignKeys: foreignKeysResult.success ? foreignKeysResult.data : [],
      checks: checksResult.success ? checksResult.data : [],
      triggers: triggersResult.success ? triggersResult.data : []
    };
    
    return { success: true, data: tableInfo };
  } catch (error) {
    console.error('获取完整表结构信息异常:', error);
    return { success: false, data: {} as TableInfo, error: `查询过程出错: ${(error as Error).message}` };
  }
};

/**
 * 渐进式获取表结构信息（优化版）
 * @param connection 数据库连接对象
 * @param database 数据库名称
 * @param table 表名称
 * @param onPartialResult 部分结果回调函数
 * @param priorityTypes 优先加载的数据类型
 * @returns Promise<TableQueryResult<TableInfo>> 表结构信息查询结果
 */
export const getProgressiveTableStructure = async (
  connection: DatabaseConnection,
  database: string,
  table: string,
  onPartialResult?: (result: ProgressiveTableStructureResult) => void,
  priorityTypes: TableStructureDataType[] = ['fields', 'indexes', 'foreignKeys']
): Promise<TableQueryResult<TableInfo>> => {
  try {
    if (!connection || !database || !table || !connection.isConnected) {
      return { success: false, data: {} as TableInfo, error: '连接信息不完整或未连接' };
    }
    
    const poolId = connection.connectionId || connection.id;
    const strategy = TableStructureStrategyFactory.getStrategy(connection);
    
    // 初始化结果对象
    const tableInfo: TableInfo = {
      name: table,
      comment: '',
      options: {},
      fields: [],
      indexes: [],
      foreignKeys: [],
      checks: [],
      triggers: []
    };
    
    // 初始化加载状态
    const loadingStatus: TableStructureLoadingStatus = {
      fields: true,
      indexes: true,
      foreignKeys: true,
      checks: true,
      triggers: true,
      options: true,
      comment: true
    };
    
    const completedTypes: TableStructureDataType[] = [];
    
    // 优先加载的查询
    const priorityQueries: Array<{type: TableStructureDataType, query: Promise<any>}> = [];
    const secondaryQueries: Array<{type: TableStructureDataType, query: Promise<any>}> = [];
    
    // 根据优先级分组查询
    const queryMap = {
      fields: strategy.getFields(poolId, database, table),
      indexes: strategy.getIndexes(poolId, database, table),
      foreignKeys: strategy.getForeignKeys(poolId, database, table),
      checks: strategy.getChecks(poolId, database, table),
      triggers: strategy.getTriggers(poolId, database, table),
      options: strategy.getOptions(poolId, database, table),
      comment: strategy.getComment(poolId, database, table)
    };
    
    // 如果priorityTypes只有一个类型，说明是在刷新特定类型的数据，只执行该类型的查询
    if (priorityTypes.length === 1) {
      const dataType = priorityTypes[0];
      // 直接添加查询，因为queryMap中已经为所有TableStructureDataType定义了对应的查询函数
      priorityQueries.push({ type: dataType, query: queryMap[dataType] });
    } else {
      // 否则按正常的优先级分组
      Object.entries(queryMap).forEach(([type, query]) => {
        const dataType = type as TableStructureDataType;
        if (priorityTypes.includes(dataType)) {
          priorityQueries.push({ type: dataType, query });
        } else {
          secondaryQueries.push({ type: dataType, query });
        }
      });
    }
    
    // 处理查询结果的函数
    const processQueryResult = async (type: TableStructureDataType, result: any) => {
      try {
        const queryResult = await result;
        loadingStatus[type] = false;
        
        if (queryResult.success) {
          switch (type) {
            case 'fields':
              tableInfo.fields = queryResult.data || [];
              break;
            case 'indexes':
              tableInfo.indexes = queryResult.data || [];
              break;
            case 'foreignKeys':
              tableInfo.foreignKeys = queryResult.data || [];
              break;
            case 'checks':
              tableInfo.checks = queryResult.data || [];
              break;
            case 'triggers':
              tableInfo.triggers = queryResult.data || [];
              break;
            case 'options':
              tableInfo.options = queryResult.data || {};
              break;
            case 'comment':
              tableInfo.comment = queryResult.data || '';
              break;
          }
        } else {
          console.warn(`获取${type}信息失败:`, queryResult.error);
          // 失败时设置为空数组或空对象
          if (['fields', 'indexes', 'foreignKeys', 'checks', 'triggers'].includes(type)) {
            (tableInfo as any)[type] = [];
          } else if (type === 'options') {
            tableInfo.options = {};
          } else if (type === 'comment') {
            tableInfo.comment = '';
          }
        }
        
        completedTypes.push(type);
        
        // 发送部分结果更新
        if (onPartialResult) {
          onPartialResult({
            success: true,
            data: { ...tableInfo },
            loadingStatus: { ...loadingStatus },
            completedTypes: [...completedTypes]
          });
        }
      } catch (error) {
        console.error(`处理${type}查询结果异常:`, error);
        loadingStatus[type] = false;
        
        // 失败时设置为空数组或空对象
        if (['fields', 'indexes', 'foreignKeys', 'checks', 'triggers'].includes(type)) {
          (tableInfo as any)[type] = [];
        } else if (type === 'options') {
          tableInfo.options = {};
        } else if (type === 'comment') {
          tableInfo.comment = '';
        }
        
        completedTypes.push(type);
        
        if (onPartialResult) {
          onPartialResult({
            success: true,
            data: { ...tableInfo },
            loadingStatus: { ...loadingStatus },
            completedTypes: [...completedTypes],
            error: `处理${type}数据时出错: ${(error as Error).message}`
          });
        }
      }
    };
    
    // 先执行高优先级查询
    await Promise.all(
      priorityQueries.map(async ({ type, query }) => {
        return processQueryResult(type, query);
      })
    );
    
    // 然后执行低优先级查询
    await Promise.all(
      secondaryQueries.map(async ({ type, query }) => {
        return processQueryResult(type, query);
      })
    );
    
    return { success: true, data: tableInfo };
  } catch (error) {
    console.error('渐进式获取表结构信息异常:', error);
    return { success: false, data: {} as TableInfo, error: `查询过程出错: ${(error as Error).message}` };
  }
};

/**
 * 带重试机制的表结构信息获取函数
 * @param connection 数据库连接对象
 * @param database 数据库名称
 * @param table 表名称
 * @param maxRetries 最大重试次数（默认3次）
 * @param retryInterval 重试间隔（默认500ms）
 * @returns Promise<TableQueryResult<TableInfo>> 表结构信息查询结果
 */
export const getCompleteTableStructureWithRetry = async (
  connection: DatabaseConnection,
  database: string,
  table: string,
  maxRetries: number = 3,
  retryInterval: number = 500
): Promise<TableQueryResult<TableInfo>> => {
  let lastError: Error | null = null;
  
  for (let retry = 0; retry < maxRetries; retry++) {
    try {
      const result = await getCompleteTableStructure(connection, database, table);
      
      if (result.success) {
        return result;
      } else {
        lastError = new Error(result.error || '查询执行失败');
        if (retry < maxRetries - 1) {
          console.warn(`获取表结构信息失败，准备重试 (${retry + 1}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, retryInterval));
        }
      }
    } catch (error) {
      lastError = error as Error;
      if (retry < maxRetries - 1) {
        console.warn(`获取表结构信息异常，准备重试 (${retry + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
      }
    }
  }
  
  return {
    success: false,
    data: {} as TableInfo,
    error: lastError?.message || '获取表结构信息失败，已达到最大重试次数'
  };
};

/**
 * 带重试机制的渐进式表结构信息获取函数
 * @param connection 数据库连接对象
 * @param database 数据库名称
 * @param table 表名称
 * @param onPartialResult 部分结果回调函数
 * @param priorityTypes 优先加载的数据类型
 * @param maxRetries 最大重试次数（默认3次）
 * @param retryInterval 重试间隔（默认500ms）
 * @returns Promise<TableQueryResult<TableInfo>> 表结构信息查询结果
 */
export const getProgressiveTableStructureWithRetry = async (
  connection: DatabaseConnection,
  database: string,
  table: string,
  onPartialResult?: (result: ProgressiveTableStructureResult) => void,
  priorityTypes: TableStructureDataType[] = ['fields', 'indexes', 'foreignKeys'],
  maxRetries: number = 3,
  retryInterval: number = 500
): Promise<TableQueryResult<TableInfo>> => {
  let lastError: Error | null = null;
  
  // 确保回调函数始终接收到有效的数据结构
  const safeOnPartialResult = (result: ProgressiveTableStructureResult) => {
    if (onPartialResult) {
      // 确保数据结构完整性，特别是索引数据
      const safeData = {
        ...result.data,
        fields: result.data?.fields || [],
        indexes: result.data?.indexes || [],
        foreignKeys: result.data?.foreignKeys || [],
        checks: result.data?.checks || [],
        triggers: result.data?.triggers || [],
        options: result.data?.options || {},
        comment: result.data?.comment || ''
      };
      
      onPartialResult({
        ...result,
        data: safeData
      });
    }
  };
  
  for (let retry = 0; retry < maxRetries; retry++) {
    try {
      console.log(`[getProgressiveTableStructureWithRetry] 尝试获取表结构信息 (${retry + 1}/${maxRetries})`, {
        connectionType: connection?.type,
        database,
        table,
        priorityTypes
      });
      
      // 使用新的渐进式加载函数，并传递安全的回调函数
      const result = await getProgressiveTableStructure(connection, database, table, safeOnPartialResult, priorityTypes);
      
      if (result.success) {
        console.log(`[getProgressiveTableStructureWithRetry] 成功获取表结构信息`, {
          hasIndexes: result.data?.indexes?.length > 0,
          indexCount: result.data?.indexes?.length || 0
        });
        return result;
      } else {
        lastError = new Error(result.error || '查询执行失败');
        console.warn(`[getProgressiveTableStructureWithRetry] 获取表结构信息失败`, {
          error: lastError.message,
          retry: retry + 1,
          maxRetries
        });
        
        if (retry < maxRetries - 1) {
          console.warn(`[getProgressiveTableStructureWithRetry] 准备重试 (${retry + 1}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, retryInterval));
        }
      }
    } catch (error) {
      lastError = error as Error;
      console.error(`[getProgressiveTableStructureWithRetry] 获取表结构信息异常`, {
        error: lastError.message,
        retry: retry + 1,
        maxRetries
      });
      
      if (retry < maxRetries - 1) {
        console.warn(`[getProgressiveTableStructureWithRetry] 准备重试 (${retry + 1}/${maxRetries})...`);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
      }
    }
  }
  
  // 如果所有重试都失败，仍然尝试通知UI当前状态
  if (onPartialResult) {
    safeOnPartialResult({
      success: false,
      data: {
        name: table,
        comment: '',
        options: {},
        fields: [],
        indexes: [], // 确保索引数组始终存在
        foreignKeys: [],
        checks: [],
        triggers: []
      },
      error: lastError?.message || '获取表结构信息失败，已达到最大重试次数',
      completedTypes: [],
      loadingStatus: {
        fields: false,
        indexes: false,
        foreignKeys: false,
        checks: false,
        triggers: false,
        options: false,
        comment: false
      }
    });
  }
  
  return {
    success: false,
    data: {
      name: table,
      comment: '',
      options: {},
      fields: [],
      indexes: [], // 确保索引数组始终存在
      foreignKeys: [],
      checks: [],
      triggers: []
    },
    error: lastError?.message || '获取表结构信息失败，已达到最大重试次数'
  };
};

/**
 * 检查表是否存在
 * @param connection 数据库连接对象
 * @param database 数据库名称
 * @param table 表名称
 * @returns Promise<boolean> 表是否存在
 */
export const checkTableExists = async (
  connection: DatabaseConnection,
  database: string,
  table: string
): Promise<boolean> => {
  try {
    if (!connection || !database || !table || !connection.isConnected) {
      return false;
    }
    
    const poolId = connection.connectionId || connection.id;
    let query = '';
    let params: any[] = [];
    
    switch (connection.type) {
      case 'mysql':
        query = `SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`;
        params = [database, table];
        break;
      case 'postgresql':
      case 'gaussdb':
        query = `SELECT COUNT(*) as count FROM pg_class WHERE relname = ? AND relkind = 'r' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')`;
        params = [table];
        break;
      case 'oracle':
        query = `SELECT COUNT(*) as count FROM all_tables WHERE owner = ? AND table_name = ?`;
        params = [database.toUpperCase(), table.toUpperCase()];
        break;
      case 'sqlite':
        query = `SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table' AND name = ?`;
        params = [table];
        break;
      default:
        return false;
    }
    
    const result = await window.electronAPI.executeQuery(poolId, query, params);
    
    if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
      const count = result.data[0].count;
      return count > 0;
    }
    
    return false;
  } catch (error) {
    console.error('检查表是否存在异常:', error);
    return false;
  }
};

/**
 * 获取默认表字段配置
 * @returns 默认的表字段配置
 */
export const getDefaultField = (): TableField => {
  return {
    name: '',
    type: 'varchar',
    length: 255,
    decimal: undefined,
    notNull: false,
    virtual: false,
    key: '',
    comment: '',
    defaultValue: undefined,
    autoIncrement: false
  };
};