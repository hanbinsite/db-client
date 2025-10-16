import React, { useState, useRef, useEffect } from 'react';
import { Button, Input, Select, Space, Table, message, Card, Spin, Tooltip, Tabs } from 'antd';
import {
  PlayCircleOutlined,
  SaveOutlined,
  ClearOutlined,
  DownloadOutlined,
  UploadOutlined,
  CopyOutlined,
  FormOutlined,
  FileSearchOutlined
} from '@ant-design/icons';
import { DatabaseConnection, QueryResult } from '../../types';
import { BaseQueryPanelProps, BatchQueryResult } from './types';
import Editor from '@monaco-editor/react';
import './QueryPanel.css';

const { TextArea } = Input;
const { Option } = Select;
const { TabPane } = Tabs;

const PostgreSqlQueryPanel: React.FC<BaseQueryPanelProps> = ({ connection, database, tabKey, onTabClose, darkMode }) => {
  const [query, setQuery] = useState<string>('SELECT * FROM users LIMIT 10;');
  const [results, setResults] = useState<BatchQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [executionTime, setExecutionTime] = useState<number>(0);
  const editorRef = useRef<any>(null);
  const [tableList, setTableList] = useState<string[]>([]);
  const [schemaCache, setSchemaCache] = useState<Record<string, string[]>>({});

  // 获取编辑器中选中的SQL文本
  const getSelectedSql = (): string => {
    if (editorRef.current) {
      const selection = editorRef.current.getSelection();
      if (!selection.isEmpty()) {
        // 使用更直接的方式获取选中文本
        const model = editorRef.current.getModel();
        if (model) {
          return model.getValueInRange(selection);
        }
      }
    }
    return '';
  };

  // 执行多条SQL查询
  const handleExecuteQuery = async () => {
    const selectedSql = getSelectedSql();
    const sqlToExecute = selectedSql || query;
    
    if (!sqlToExecute.trim()) {
      message.warning('请输入SQL查询语句');
      return;
    }
    await executeQueryInternal(sqlToExecute);
  };
  
  // 内部执行查询的函数，供handleExecuteQuery和handleExecuteExplain使用
  const executeQueryInternal = async (sql: string) => {
    if (!connection || !connection.isConnected) {
      message.warning('请先建立数据库连接');
      return;
    }

    setLoading(true);
    const startTime = Date.now();

    try {
      // 使用真实的数据库连接执行查询
      const poolId = connection.connectionId || connection.id;
      if (!poolId) {
        throw new Error('连接池ID不存在');
      }

      // 分割多条SQL语句
      const queries = splitSqlStatements(sql);
      const queryResults: QueryResult[] = [];
      let allSuccess = true;

      for (const stmt of queries) {
        if (stmt.trim()) {
          const result = await window.electronAPI.executeQuery(poolId, stmt);
          
          if (result && result.success && Array.isArray(result.data)) {
            // 提取列名，添加安全检查
            const data = result.data || [];
            const columns = data.length > 0 ? Object.keys(data[0]) : [];
            
            queryResults.push({
              success: true,
              data: data,
              columns: columns,
              rowCount: data.length,
              executionTime: Date.now() - startTime
            });
          } else if (result && result.success) {
            queryResults.push({
              success: true,
              data: [],
              columns: [],
              rowCount: 0,
              executionTime: Date.now() - startTime
            });
          } else {
            queryResults.push({
              success: false,
              error: result?.error || '查询执行失败'
            });
            allSuccess = false;
            break; // 如果一条失败，可以选择继续执行或停止
          }
        }
      }

      const batchResult: BatchQueryResult = {
        success: allSuccess,
        results: queryResults,
        executionTime: Date.now() - startTime
      };

      setResults(batchResult);
      setExecutionTime(Date.now() - startTime);
      message.success(allSuccess ? '所有查询执行成功' : '部分查询执行失败');
    } catch (error) {
      const batchResult: BatchQueryResult = {
        success: false,
        results: [{
          success: false,
          error: (error as Error)?.message || '查询执行失败'
        }],
        executionTime: Date.now() - startTime
      };
      setResults(batchResult);
      setExecutionTime(Date.now() - startTime);
      message.error('查询执行失败');
    } finally {
      setLoading(false);
    }
  };

  // 分割SQL语句（考虑引号和注释）
  const splitSqlStatements = (sql: string): string[] => {
    const statements: string[] = [];
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inCommentBlock = false;
    let inLineComment = false;
    let currentStatement = '';
    let prevChar = '';

    for (let i = 0; i < sql.length; i++) {
      const char = sql[i];
      
      // 处理行注释
      if (char === '-' && prevChar === '-' && !inSingleQuote && !inDoubleQuote && !inCommentBlock) {
        inLineComment = true;
        currentStatement += char;
        prevChar = char;
        continue;
      }

      // 处理块注释开始
      if (char === '*' && prevChar === '/' && !inSingleQuote && !inDoubleQuote && !inLineComment) {
        inCommentBlock = true;
        currentStatement += char;
        prevChar = char;
        continue;
      }

      // 处理块注释结束
      if (char === '/' && prevChar === '*' && inCommentBlock) {
        inCommentBlock = false;
        currentStatement += char;
        prevChar = char;
        continue;
      }

      // 处理换行符（重置行注释状态）
      if (char === '\n' || char === '\r') {
        inLineComment = false;
      }

      // 处理引号
      if (char === "'" && !inDoubleQuote && !inCommentBlock && !inLineComment && prevChar !== '\\') {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && !inSingleQuote && !inCommentBlock && !inLineComment && prevChar !== '\\') {
        inDoubleQuote = !inDoubleQuote;
      }

      // 如果遇到分号且不在引号或注释中，分割语句
      if (char === ';' && !inSingleQuote && !inDoubleQuote && !inCommentBlock && !inLineComment) {
        statements.push(currentStatement + char);
        currentStatement = '';
      } else {
        currentStatement += char;
      }

      prevChar = char;
    }

    // 添加最后一个语句（如果有）
    if (currentStatement.trim()) {
      statements.push(currentStatement);
    }

    return statements;
  };

  const handleClearQuery = () => {
    setQuery('');
    setResults(null);
    setExecutionTime(0);
    if (editorRef.current) {
      editorRef.current.focus();
    }
  };
  
  // 加载PostgreSQL数据库表列表
  const loadDatabaseTables = async () => {
    if (!connection || !connection.isConnected || !database) return;
    
    try {
      const poolId = connection.connectionId || connection.id;
      const query = "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';";
      
      const result = await window.electronAPI.executeQuery(poolId, query);
      if (result && result.success && result.data && result.data.length > 0) {
        const tables: string[] = [];
        result.data.forEach((row: any) => {
          const tableName = Object.values(row)[0];
          if (typeof tableName === 'string') {
            tables.push(tableName);
          }
        });
        setTableList(tables);
      }
    } catch (error) {
      console.error('加载表列表失败:', error);
    }
  };
  
  // 加载PostgreSQL表结构
  const loadTableSchema = async (tableName: string) => {
    if (!connection || !connection.isConnected || !database || schemaCache[tableName]) return;
    
    try {
      const poolId = connection.connectionId || connection.id;
      const query = "SELECT column_name FROM information_schema.columns WHERE table_name = '" + tableName + "';";
      
      const result = await window.electronAPI.executeQuery(poolId, query);
      if (result && result.success && result.data && result.data.length > 0) {
        const columns: string[] = [];
        result.data.forEach((row: any) => {
          const columnName = row.column_name;
          if (typeof columnName === 'string') {
            columns.push(columnName);
          }
        });
        
        setSchemaCache(prev => ({
          ...prev,
          [tableName]: columns
        }));
      }
    } catch (error) {
      console.error('加载表结构失败:', error);
    }
  };
  
  // 当数据库改变时加载表列表
  useEffect(() => {
    loadDatabaseTables();
    setSchemaCache({});
  }, [connection, database]);
  
  // 配置PostgreSQL特有的SQL补全
  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    
    // 配置SQL语言服务
    monaco.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: (model: any, position: any) => {
        const suggestions: any[] = [];
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        };
        
        // PostgreSQL关键字
        const keywords = [
          'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP',
          'ALTER', 'TABLE', 'DATABASE', 'INDEX', 'VIEW', 'PROCEDURE', 'FUNCTION',
          'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER', 'ON', 'AS', 'GROUP', 'BY',
          'ORDER', 'LIMIT', 'OFFSET', 'AND', 'OR', 'NOT', 'IN', 'EXISTS', 'BETWEEN',
          'LIKE', 'IS', 'NULL', 'TRUE', 'FALSE', 'DISTINCT', 'ALL', 'ANY', 'SOME',
          'HAVING', 'WITH', 'AS', 'UNION', 'EXCEPT', 'INTERSECT', 'VALUES', 'SET',
          'TRUNCATE', 'RENAME', 'USE', 'SHOW', 'DESCRIBE', 'EXPLAIN', 'ANALYZE',
          'HANDLER', 'LOCK', 'UNLOCK', 'CALL', 'PREPARE', 'EXECUTE', 'DEALLOCATE',
          'LOAD', 'INTO', 'DUMPFILE', 'OUTFILE', 'INFILE', 'REPLACE', 'REPAIR',
          'OPTIMIZE', 'CHECK', 'BACKUP', 'RESTORE', 'BINLOG', 'MASTER', 'SLAVE',
          'START', 'STOP', 'RESET', 'CHANGE', 'PURGE', 'KILL', 'SHUTDOWN', 'FLUSH',
          'BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT', 'RELEASE', 'TRANSACTION',
          'DECLARE', 'CURSOR', 'FOR', 'OPEN', 'FETCH', 'CLOSE', 'RETURN', 'RAISE',
          'EXCEPTION', 'WHEN', 'THEN', 'ELSE', 'END', 'LOOP', 'EXIT', 'CONTINUE',
          'FOR', 'IN', 'REVERSE', 'WHILE', 'DO', 'CASE', 'IF', 'ELSIF', 'PERFORM',
          'USING', 'LANGUAGE', 'VOLATILE', 'IMMUTABLE', 'STABLE', 'SECURITY',
          'DEFINER', 'INVOKER', 'RETURNS', 'TABLE', 'AS', '$$', 'LANGUAGE', 'plpgsql',
          'EXTENSION', 'SCHEMA', 'GRANT', 'REVOKE', 'PRIVILEGES', 'USER', 'ROLE',
          'ALTER', 'SYSTEM', 'SHOW', 'VARIABLES', 'SET', 'GLOBAL', 'SESSION',
          'TEMPORARY', 'TEMP', 'UNLOGGED', 'PARTITION', 'BY', 'RANGE', 'LIST', 'HASH',
          'CONSTRAINT', 'PRIMARY', 'KEY', 'UNIQUE', 'REFERENCES', 'FOREIGN', 'KEY',
          'CHECK', 'EXCLUDE', 'COLLATE', 'NULLS', 'FIRST', 'LAST', 'WITHIN', 'GROUP',
          'FILTER', 'OVER', 'PARTITION', 'WINDOW', 'CURRENT', 'ROW', 'SAMPLE', 'TABLESAMPLE',
          'MATERIALIZED', 'ONLY', 'OF', 'CAST', 'USING', 'DEFAULT', 'ON', 'CONFLICT',
          'DO', 'NOTHING', 'UPDATE', 'EXCLUDED', 'DELETED', 'INSERTED'
        ];
        
        // PostgreSQL特有函数
        const functions = [
          'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'CONCAT', 'SUBSTRING', 'UPPER',
          'LOWER', 'LENGTH', 'TRIM', 'COALESCE', 'IFNULL', 'CASE', 'WHEN', 'THEN',
          'ELSE', 'END', 'CURRENT_DATE', 'CURRENT_TIME', 'NOW', 'DATE', 'TIME',
          'DATEDIFF', 'TIMESTAMPDIFF', 'DATE_ADD', 'DATE_SUB', 'DATE_FORMAT',
          'STR_TO_DATE', 'TIMESTAMP', 'YEAR', 'MONTH', 'DAY', 'HOUR', 'MINUTE',
          'SECOND', 'QUARTER', 'WEEK', 'DAYOFWEEK', 'DAYOFMONTH', 'DAYOFYEAR',
          'FROM_UNIXTIME', 'UNIX_TIMESTAMP', 'MD5', 'SHA1', 'SHA2', 'AES_ENCRYPT',
          'AES_DECRYPT', 'RAND', 'ROUND', 'CEIL', 'FLOOR', 'ABS', 'SIGN', 'POW',
          'SQRT', 'LOG', 'LOG10', 'EXP', 'SIN', 'COS', 'TAN', 'ASIN', 'ACOS',
          'ATAN', 'ATAN2', 'DEGREES', 'RADIANS', 'IF', 'NULLIF', 'CAST', 'CONVERT',
          'JSON_OBJECT', 'JSON_ARRAY', 'JSON_EXTRACT', 'JSON_SET', 'JSON_REPLACE',
          'STRING_AGG', 'ARRAY_AGG', 'XMLAGG', 'RANK', 'DENSE_RANK', 'ROW_NUMBER',
          'NTILE', 'LEAD', 'LAG', 'FIRST_VALUE', 'LAST_VALUE', 'NTH_VALUE', 'PERCENT_RANK',
          'CUME_DIST', 'ANY_VALUE', 'BIT_AND', 'BIT_OR', 'BOOL_AND', 'BOOL_OR',
          'CORR', 'COVAR_POP', 'COVAR_SAMP', 'REGR_AVGX', 'REGR_AVGY', 'REGR_COUNT',
          'REGR_INTERCEPT', 'REGR_R2', 'REGR_SLOPE', 'REGR_SXX', 'REGR_SXY', 'REGR_SYY',
          'STDDEV', 'STDDEV_POP', 'STDDEV_SAMP', 'VARIANCE', 'VAR_POP', 'VAR_SAMP',
          'array_append', 'array_cat', 'array_contains', 'array_dims', 'array_fill',
          'array_length', 'array_lower', 'array_positions', 'array_prepend', 'array_remove',
          'array_replace', 'array_to_json', 'array_to_string', 'array_upper', 'cardinality',
          'string_to_array', 'unnest', 'json_agg', 'json_array_elements', 'json_array_elements_text',
          'json_build_array', 'json_build_object', 'json_each', 'json_each_text', 'json_extract_path',
          'json_extract_path_text', 'json_object', 'json_object_agg', 'json_populate_record',
          'json_populate_recordset', 'json_to_record', 'json_to_recordset', 'jsonb_agg',
          'jsonb_array_elements', 'jsonb_array_elements_text', 'jsonb_build_array',
          'jsonb_build_object', 'jsonb_each', 'jsonb_each_text', 'jsonb_extract_path',
          'jsonb_extract_path_text', 'jsonb_object', 'jsonb_object_agg', 'jsonb_populate_record',
          'jsonb_populate_recordset', 'jsonb_to_record', 'jsonb_to_recordset', 'to_json',
          'to_jsonb', 'xmlparse', 'xmlelement', 'xmlattributes', 'xmlforest', 'xmlconcat',
          'xmlcomment', 'xmlpi', 'xpath', 'xpath_exists', 'position', 'overlay', 'translate',
          'convert', 'convert_from', 'convert_to', 'decode', 'encode', 'format', 'initcap',
          'left', 'lpad', 'repeat', 'replace', 'reverse', 'right', 'rpad', 'split_part',
          'strpos', 'substr', 'to_ascii', 'to_hex', 'to_timestamp', 'trim', 'upper',
          'lower', 'bit_length', 'char_length', 'length', 'octet_length', 'setseed',
          'pg_catalog.set_config', 'pg_catalog.current_setting', 'pg_catalog.version',
          'pg_catalog.format', 'pg_catalog.pg_typeof', 'pg_catalog.obj_description',
          'pg_catalog.col_description'
        ];
        
        // 获取光标前的文本以分析上下文
        const lineContent = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        });
        
        const trimmedContent = lineContent.trim();
        const words = trimmedContent.split(/\s+/);
        const lastWord = words.length > 0 ? words[words.length - 1].toUpperCase() : '';
        
        // 根据上下文提供不同的补全
        if (trimmedContent.includes('FROM') && !trimmedContent.includes('WHERE')) {
          // 在FROM后面提供表名补全
          tableList.forEach(table => {
            suggestions.push({
              label: table,
              kind: monaco.languages.CompletionItemKind.Struct,
              insertText: table,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              range: range,
              detail: '表'
            });
          });
        } else if ((trimmedContent.includes('SELECT') || trimmedContent.includes('WHERE')) && 
                  (lastWord === '.' || (words.length > 1 && words[words.length - 2] === 'FROM'))) {
          // 查找可能的表名
          let potentialTable = '';
          if (lastWord === '.') {
            potentialTable = words.length > 2 ? words[words.length - 2] : '';
          } else if (words.length > 1 && words[words.length - 2].toUpperCase() === 'FROM') {
            potentialTable = words[words.length - 1];
          }
          
          if (potentialTable) {
            // 加载表结构（如果尚未加载）
            loadTableSchema(potentialTable);
            
            if (schemaCache[potentialTable]) {
              // 提供字段补全
              schemaCache[potentialTable].forEach(column => {
                suggestions.push({
                  label: column,
                  kind: monaco.languages.CompletionItemKind.Field,
                  insertText: column,
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range: lastWord === '.' ? {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: position.column,
                    endColumn: position.column
                  } : range,
                  detail: '字段'
                });
              });
            }
          }
        } else {
          // 提供关键字补全
          keywords.forEach(keyword => {
            if (keyword.toUpperCase().startsWith(word.word.toUpperCase())) {
              suggestions.push({
                label: keyword,
                kind: monaco.languages.CompletionItemKind.Keyword,
                insertText: keyword,
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range: range,
                detail: '关键字'
              });
            }
          });
          
          // 提供函数补全
          functions.forEach(func => {
            if (func.toUpperCase().startsWith(word.word.toUpperCase())) {
              suggestions.push({
                label: func,
                kind: monaco.languages.CompletionItemKind.Function,
                insertText: func + '($0)',
                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range: range,
                detail: '函数'
              });
            }
          });
          
          // 如果在SELECT后面，也提供表名补全
          if (trimmedContent.includes('SELECT') && !trimmedContent.includes('FROM')) {
            tableList.forEach(table => {
              if (table.toUpperCase().startsWith(word.word.toUpperCase())) {
                suggestions.push({
                  label: table,
                  kind: monaco.languages.CompletionItemKind.Struct,
                  insertText: table,
                  insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                  range: range,
                  detail: '表'
                });
              }
            });
          }
        }
        
        return {
          suggestions: suggestions
        };
      },
      triggerCharacters: ['.', ' ', '\n']
    });
  };
  
  // 当编辑器内容改变时更新状态
  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined) {
      setQuery(value);
    }
  };

  const handleSaveQuery = () => {
    if (!query.trim()) {
      message.warning('没有可保存的查询');
      return;
    }
    // 这里可以实现保存查询到本地文件的功能
    message.info('保存查询功能待实现');
  };

  const commonQueries = [
    { value: 'SELECT * FROM users LIMIT 10;', label: '查询前10条数据' },
    { value: 'SELECT table_name FROM information_schema.tables WHERE table_schema = \'public\';', label: '显示所有表' },
    { value: 'SELECT column_name FROM information_schema.columns WHERE table_name = \'table_name\';', label: '查看表结构' },
    { value: 'SELECT COUNT(*) FROM users;', label: '统计行数' },
    { value: 'SELECT current_database();', label: '当前数据库' },
    { value: 'SELECT datname FROM pg_database;', label: '所有数据库' }
  ];

  const handleFormatSQL = () => {
    // 简单的SQL格式化实现
    let formattedQuery = query
      .replace(/\s*SELECT\s*/gi, '\nSELECT ')    
      .replace(/\s*FROM\s*/gi, '\nFROM ')        
      .replace(/\s*WHERE\s*/gi, '\nWHERE ')      
      .replace(/\s*JOIN\s*/gi, '\nJOIN ')        
      .replace(/\s*ON\s*/gi, ' ON ')              
      .replace(/\s*AND\s*/gi, '\n  AND ')        
      .replace(/\s*OR\s*/gi, '\n  OR ');         
    setQuery(formattedQuery);
  };

  const handleExportResults = () => {
    if (!results || !results.success || results.results.length === 0 || !results.results[0].data) {
      message.warning('没有可导出的结果');
      return;
    }
    
    // 简单的CSV导出实现（只导出第一个结果集）
    const firstResult = results.results[0];
    const headers = (firstResult.columns || []).join(',');
    const data = firstResult.data || [];
    const rows = data.map((row: Record<string, any>) => 
      Object.values(row).map(val => `"${val}"`).join(',')
    ).join('\n');
    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `query_result_${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    message.success('结果已导出为CSV文件');
  };

  const handleImportQuery = () => {
    // 这里可以实现从文件导入SQL查询的功能
    message.info('从文件导入查询功能待实现');
  };

  const handleCopyResult = () => {
    if (!results || !results.success || results.results.length === 0 || !results.results[0].data) {
      message.warning('没有可复制的结果');
      return;
    }
    
    // 将结果复制到剪贴板（只复制第一个结果集）
    const firstResult = results.results[0];
    const data = firstResult.data || [];
    const text = data.map((row: Record<string, any>) => 
      Object.values(row).join('\t')
    ).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      message.success('结果已复制到剪贴板');
    });
  };

  const handleExecuteExplain = async () => {
    const selectedSql = getSelectedSql();
    const sqlToExplain = selectedSql || query;
    
    if (!sqlToExplain.trim()) {
      message.warning('请先输入SQL查询语句');
      return;
    }
    
    // 分割SQL语句，对每条语句都添加EXPLAIN ANALYZE前缀
    const statements = splitSqlStatements(sqlToExplain);
    const explainQueries = statements.map(stmt => `EXPLAIN ANALYZE ${stmt}`).join('\n');
    
    await executeQueryInternal(explainQueries);
  };

  const handleCancelExplain = () => {
    if (query.startsWith('EXPLAIN ANALYZE ')) {
      setQuery(query.substring(15));
    } else if (query.startsWith('EXPLAIN ')) {
      setQuery(query.substring(8));
    }
  };

  const handleCommonQuerySelect = (value: string) => {
    setQuery(value);
  };

  const renderResults = () => {
    if (!results) return null;

    if (!results.success) {
      return (
        <Card 
          title="执行结果" 
          size="small" 
          style={{ marginTop: 16 }}
          className={`query-results ${darkMode ? 'dark-card' : ''}`}
        >
          <div style={{ color: darkMode ? '#ff8080' : '#ff4d4f', padding: '8px 0' }}>
            <strong>错误:</strong> {results.results[0]?.error || '未知错误'}
          </div>
        </Card>
      );
    }

    return (
      <Tabs 
        style={{ marginTop: 16 }}
        className={`query-results-tabs ${darkMode ? 'dark-tabs' : ''}`}
        defaultActiveKey="0"
        tabBarExtraContent={
          <span style={{ fontSize: '12px', color: darkMode ? '#999' : '#666' }}>
            总耗时: {executionTime}ms | 语句数: {results.results.length}
          </span>
        }
      >
        {results.results.map((result, index) => (
          <TabPane 
            tab={
              <Space>
                <span>结果 {index + 1}</span>
                <span style={{ fontSize: '12px', color: darkMode ? '#999' : '#666' }}>
                  {result.success 
                    ? `(${result.rowCount || 0} 行)` 
                    : '(失败)'}
                </span>
              </Space>
            } 
            key={index.toString()}
          >
            {result.success && result.columns ? (
              <Table
                dataSource={result.data || []}
                columns={result.columns.map((col: string) => ({
                  title: col,
                  dataIndex: col,
                  key: col,
                  ellipsis: true
                }))}
                size="small"
                pagination={{
                  pageSize: 10,
                  showSizeChanger: true,
                  showQuickJumper: true,
                  showTotal: (total, range) => 
                    `第 ${range[0]}-${range[1]} 条，共 ${total} 条`
                }}
                scroll={{ x: true }}
                className={darkMode ? 'dark-table' : ''}
                locale={{
                  emptyText: '暂无数据'
                }}
              />
            ) : result.success ? (
              <div style={{ padding: '16px 0', color: darkMode ? '#69d183' : '#52c41a' }}>
                命令执行成功
              </div>
            ) : (
              <div style={{ color: darkMode ? '#ff8080' : '#ff4d4f', padding: '16px 0' }}>
                <strong>错误:</strong> {result.error}
              </div>
            )}
          </TabPane>
        ))}
      </Tabs>
    );
  };

  return (
    <div className={`query-panel ${darkMode ? 'dark' : ''}`}>
      <div className="query-toolbar">
        {/* 连接信息显示 */}
        <div className="connection-info">
          {connection ? (
            <div>
              <span style={{ fontSize: '12px', color: darkMode ? '#999' : '#666', marginRight: '8px' }}>
                {connection.name} (PostgreSQL)
              </span>
              <span style={{ fontSize: '12px', color: darkMode ? '#69d183' : '#52c41a', marginRight: '8px' }}>
                数据库: {database || '未选择数据库'}
              </span>
              <span style={{ fontSize: '12px', color: darkMode ? '#6495ed' : '#1890ff' }}>
                模式: {connection.schema || 'public'}
              </span>
            </div>
          ) : (
            <span style={{ fontSize: '12px', color: '#999' }}>未连接数据库</span>
          )}
        </div>
        <Space>
          <Button 
            type="primary" 
            icon={<PlayCircleOutlined />} 
            onClick={handleExecuteQuery}
            loading={loading}
          >
            执行
          </Button>
          <Button 
            icon={<FileSearchOutlined />} 
            onClick={handleExecuteExplain}
            className={darkMode ? 'dark-btn' : ''}
          >
            解释
          </Button>
          <Button 
            icon={<SaveOutlined />} 
            onClick={handleSaveQuery}
          >
            保存
          </Button>
          <Button 
            icon={<ClearOutlined />} 
            onClick={handleClearQuery}
          >
            清空
          </Button>
          <Select
            placeholder="常用查询"
            style={{ width: 200 }}
            onSelect={handleCommonQuerySelect}
            allowClear
            className={darkMode ? 'dark-select' : ''}
          >
            {commonQueries.map((query, index) => (
              <Option key={index} value={query.value}>
                {query.label}
              </Option>
            ))}
          </Select>
          <Space>
            <Tooltip title="格式化SQL (Ctrl+Shift+F)">
              <Button 
                icon={<FormOutlined />} 
                onClick={handleFormatSQL}
                className={darkMode ? 'dark-btn' : ''}
              />
            </Tooltip>
            <Tooltip title="导入SQL文件">
              <Button 
                icon={<UploadOutlined />} 
                onClick={handleImportQuery}
                className={darkMode ? 'dark-btn' : ''}
              />
            </Tooltip>
            <Tooltip title="导出结果">
              <Button 
                icon={<DownloadOutlined />} 
                onClick={handleExportResults}
                disabled={!results || !results.success || results.results.length === 0 || !results.results[0].data}
                className={darkMode ? 'dark-btn' : ''}
              />
            </Tooltip>
            
            <Tooltip title="复制结果">
              <Button 
                icon={<CopyOutlined />} 
                onClick={handleCopyResult}
                disabled={!results || !results.success || results.results.length === 0 || !results.results[0].data}
                className={darkMode ? 'dark-btn' : ''}
              />
            </Tooltip>
          </Space>
        </Space>
      </div>

      {/* SQL编辑器工具栏 */}
      <div className="sql-editor-toolbar">
        <div className="editor-info">
          <span className="file-name">query_{tabKey}.sql</span>
          <span className="line-stats">
            {query.split('\n').length} 行, {query.length} 字符
          </span>
        </div>
      </div>

      {/* SQL编辑器 */}
      <div className="query-editor-container">
        <Editor
          height="200px"
          language="sql"
          theme={darkMode ? "vs-dark" : "vs"}
          value={query}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: true },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineHeight: 1.6,
            wordWrap: "on",
            automaticLayout: true,
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8
            },
            quickSuggestions: true,
            parameterHints: { enabled: true },
            suggestOnTriggerCharacters: true,
            tabSize: 2,
            insertSpaces: true,
            formatOnPaste: true,
            formatOnType: false
          }}
          className={darkMode ? 'dark-editor' : ''}
        />
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <Spin tip="执行中..." />
        </div>
      )}

      {/* 执行状态 */}
      {loading && (
        <div className="execution-status">
          <Spin size="small" tip="查询执行中..." />
          <span className="execution-time">准备执行...</span>
        </div>
      )}

      {results && !loading && (
        <div className="execution-status">
          <span className={`execution-time ${results.success ? 'success' : 'error'}`}>
            {results.success 
              ? `执行成功，耗时: ${executionTime}ms | 语句数: ${results.results.length}` 
              : `执行失败: ${results.results[0]?.error}`}
          </span>
        </div>
      )}

      {/* 查询结果 */}
      {renderResults()}
    </div>
  );
};

export default PostgreSqlQueryPanel;