import React, { useState, useRef, useEffect } from 'react';
import { Button, Input, Select, Space, Table, message, Card, Spin, Tooltip, Tabs, Collapse } from 'antd';
import ChartView from './ChartView';
import DataImportModal from './DataImportModal';
import {
  PlayCircleOutlined,
  SaveOutlined,
  ClearOutlined,
  DownloadOutlined,
  UploadOutlined,
  CopyOutlined,
  FormOutlined,
  FileSearchOutlined,
  HistoryOutlined
} from '@ant-design/icons';
import { DatabaseConnection, QueryResult } from '../../types';
import { BaseQueryPanelProps, BatchQueryResult } from './types';
import Editor from '@monaco-editor/react';
import { SqlFormatterService } from '../../utils/sql-formatter';
import QueryHistory from './QueryHistory';
import { queryHistoryService } from '../../utils/query-history';
import './QueryPanel.css';

const { TextArea } = Input;
const { Option } = Select;
const { TabPane } = Tabs;

const MySqlQueryPanel: React.FC<BaseQueryPanelProps> = ({ connection, database, tabKey, onTabClose, darkMode, onDatabaseChange }) => {
  const [query, setQuery] = useState<string>('SELECT * FROM users LIMIT 10;');
  const [results, setResults] = useState<BatchQueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [executionTime, setExecutionTime] = useState<number>(0);
  const editorRef = useRef<any>(null);
  const [tableList, setTableList] = useState<string[]>([]);
  const [databaseList, setDatabaseList] = useState<string[]>([]);
  const [schemaCache, setSchemaCache] = useState<Record<string, string[]>>({});
  const [showImportModal, setShowImportModal] = useState(false);
  const { Panel } = Collapse;

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
  
  // 加载MySQL数据库列表
  const loadDatabases = async () => {
    if (!connection || !connection.isConnected) return;
    
    try {
      const poolId = connection.connectionId || connection.id;
      const query = 'SHOW DATABASES;';
      
      const result = await window.electronAPI.executeQuery(poolId, query);
      if (result && result.success && result.data && result.data.length > 0) {
        const databases: string[] = [];
        result.data.forEach((row: any) => {
          const dbName = Object.values(row)[0];
          if (typeof dbName === 'string') {
            databases.push(dbName);
          }
        });
        setDatabaseList(databases);
      }
    } catch (error) {
      console.error('加载数据库列表失败:', error);
    }
  };
  
  // 加载MySQL数据库表列表
  const loadDatabaseTables = async () => {
    if (!connection || !connection.isConnected || !database) return;
    
    try {
      const poolId = connection.connectionId || connection.id;
      const query = 'SHOW TABLES FROM ' + database + ';';
      
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
  
  // 加载MySQL表结构
  const loadTableSchema = async (tableName: string) => {
    if (!connection || !connection.isConnected || !database || schemaCache[tableName]) return;
    
    try {
      const poolId = connection.connectionId || connection.id;
      const query = 'DESCRIBE ' + database + '.' + tableName + ';';
      
      const result = await window.electronAPI.executeQuery(poolId, query);
      if (result && result.success && result.data && result.data.length > 0) {
        const columns: string[] = [];
        result.data.forEach((row: any) => {
          const columnName = row.Field;
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
  
  // 当连接改变时加载数据库列表
  useEffect(() => {
    loadDatabases();
  }, [connection]);
  
  // 处理数据库选择变化
  const handleDatabaseChange = (value: string) => {
    // 通知父组件数据库已改变
    if (onDatabaseChange) {
      onDatabaseChange(value);
    }
  };
  
  // 配置MySQL特有的SQL补全
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
        
        // MySQL关键字
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
          'START', 'STOP', 'RESET', 'CHANGE', 'PURGE', 'KILL', 'SHUTDOWN', 'FLUSH'
        ];
        
        // MySQL特有函数
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
          'JSON_OBJECT', 'JSON_ARRAY', 'JSON_EXTRACT', 'JSON_SET', 'JSON_REPLACE'
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
    { value: 'SELECT * FROM table_name LIMIT 10;', label: '查询前10条数据' },
    { value: 'SHOW TABLES;', label: '显示所有表' },
    { value: 'DESCRIBE table_name;', label: '查看表结构' },
    { value: 'SELECT COUNT(*) FROM table_name;', label: '统计行数' },
    { value: 'SELECT DATABASE();', label: '当前数据库' },
    { value: 'SHOW DATABASES;', label: '所有数据库' }
  ];

  const handleFormatSQL = () => {
    if (!query.trim()) {
      message.warning('没有可格式化的SQL语句');
      return;
    }
    
    try {
      // 使用SqlFormatterService格式化SQL
      const formattedQuery = SqlFormatterService.formatSql(query, {
        language: SqlFormatterService.getLanguageByDbType(connection?.type || 'mysql'),
        keywordCase: 'upper'
      });
      setQuery(formattedQuery);
      message.success('SQL格式化成功');
    } catch (error) {
      console.error('SQL格式化失败:', error);
      message.error('SQL格式化失败: ' + (error as Error).message);
    }
  };

  const handleExportResults = async () => {
    if (!results || !results.success || results.results.length === 0 || !results.results[0].data) {
      message.warning('没有可导出的结果');
      return;
    }
    
    // 选择要导出的结果集（目前只支持第一个结果集）
    const firstResult = results.results[0];
    const data = firstResult.data || [];
    
    try {
      // 显示格式选择对话框
      const { Modal, Select } = await import('antd');
      const { Option } = Select;
      
      // 定义支持的导出格式
      const exportFormats = [
        { value: 'csv', label: 'CSV文件 (.csv)' },
        { value: 'json', label: 'JSON文件 (.json)' },
        { value: 'xlsx', label: 'Excel文件 (.xlsx)' }
      ];
      
      // 使用Promise包装Modal，实现异步等待用户选择
      const selectedFormat = await new Promise<string | null>((resolve) => {
        let tempFormat = 'csv';
        
        const modal = Modal.confirm({
          title: '选择导出格式',
          content: (
            <div style={{ padding: '16px 0' }}>
              <Select
                defaultValue={tempFormat}
                style={{ width: '100%' }}
                onChange={(value) => {
                  tempFormat = value;
                }}
              >
                {exportFormats.map(format => (
                  <Option key={format.value} value={format.value}>
                    {format.label}
                  </Option>
                ))}
              </Select>
            </div>
          ),
          onOk: () => {
            resolve(tempFormat);
            modal.destroy();
          },
          onCancel: () => {
            resolve(null);
            modal.destroy();
          },
          okText: '确定',
          cancelText: '取消'
        });
      });
      
      if (!selectedFormat) {
        return; // 用户取消了导出
      }
      
      // 显示保存对话框
      const format = selectedFormat;
      const defaultFileName = `query_result_${Date.now()}.${format}`;
      
      // 调用主进程的导出功能
      const saveResult = await window.electronAPI.showSaveDialog(defaultFileName, format);
      
      if (!saveResult.canceled && saveResult.filePath) {
        // 写入文件
        const writeResult = await window.electronAPI.writeExportFile(saveResult.filePath, data, format, connection?.type);
        
        if (writeResult.success) {
          message.success(`结果已成功导出为${format.toUpperCase()}文件`);
        } else {
          message.error(`导出失败: ${writeResult.error || '未知错误'}`);
        }
      }
    } catch (error) {
      console.error('导出结果失败:', error);
      message.error('导出结果失败: ' + (error as Error).message);
    }
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
    
    // 分割SQL语句，对每条语句都添加EXPLAIN前缀
    const statements = splitSqlStatements(sqlToExplain);
    const explainQueries = statements.map(stmt => `EXPLAIN ${stmt}`).join('\n');
    
    await executeQueryInternal(explainQueries);
  };
  
  // 内部执行查询的函数，供handleExecuteQuery和handleExecuteExplain使用
  const executeQueryInternal = async (sql: string) => {
    if (!connection || !connection.isConnected) {
      message.warning('请先建立数据库连接');
      return;
    }

    setLoading(true);
    const startTime = Date.now();
    let allSuccess = false;
    let resultCount = 0;

    try {
      // 使用真实的数据库连接执行查询
      const poolId = connection.connectionId || connection.id;
      if (!poolId) {
        throw new Error('连接池ID不存在');
      }

      // 分割多条SQL语句
      const queries = splitSqlStatements(sql);
      const queryResults: QueryResult[] = [];
      allSuccess = true;

      // 如果指定了数据库，先执行USE语句切换数据库
      if (database) {
        const useDbResult = await window.electronAPI.executeQuery(poolId, `USE \`${database}\``);
        if (!useDbResult || !useDbResult.success) {
          // 如果切换数据库失败，继续执行查询，让MySQL返回具体错误
          console.warn('切换数据库失败:', useDbResult?.error);
        }
      }

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
            resultCount += data.length;
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
      
      // 保存查询历史记录
      if (sql.trim() && connection) {
        try {
          await queryHistoryService.addHistoryItem({
            query: sql,
            connectionId: connection.id,
            connectionName: connection.name,
            databaseType: connection.type,
            databaseName: database,
            executedAt: new Date(),
            resultCount,
            executionTime: Date.now() - startTime,
            isFavorite: false,
            success: allSuccess
          });
        } catch (error) {
          console.error('保存查询历史失败:', error);
          // 保存失败不影响主流程
        }
      }
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
          <React.Fragment key={index}>
            <TabPane 
              tab={
                <Space>
                  <span>结果 {index + 1} (表格)</span>
                  <span style={{ fontSize: '12px', color: darkMode ? '#999' : '#666' }}>
                    {result.success 
                      ? `(${result.rowCount || 0} 行)` 
                      : '(失败)'}
                  </span>
                </Space>
              } 
              key={`${index}-table`}
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
            
            {/* 添加可视化图表选项卡 */}
            {result.success && result.columns && result.data && result.data.length > 0 && (
              <TabPane 
                tab={
                  <Space>
                    <span>结果 {index + 1} (可视化)</span>
                    <span style={{ fontSize: '12px', color: darkMode ? '#999' : '#666' }}>
                      {result.success 
                        ? `(${result.rowCount || 0} 行)` 
                        : '(失败)'}
                    </span>
                  </Space>
                } 
                key={`${index}-chart`}
              >
                <ChartView result={result} darkMode={darkMode} />
              </TabPane>
            )}
          </React.Fragment>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '12px', color: darkMode ? '#999' : '#666' }}>
                {connection.name} (MySQL)
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '12px', color: darkMode ? '#999' : '#666' }}>数据库:</span>
                <Select
                  value={database}
                  onChange={handleDatabaseChange}
                  style={{ width: 150 }}
                  placeholder="选择数据库"
                  className={darkMode ? 'dark-select' : ''}
                >
                  {databaseList.map(db => (
                    <Option key={db} value={db}>{db}</Option>
                  ))}
                </Select>
              </div>
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
            <Tooltip title="查询历史">
              <Button 
                icon={<HistoryOutlined />} 
                onClick={() => {
                  // 触发查询历史页面打开
                  message.info('正在打开查询历史页面...');
                  // 由于MySqlQueryPanel组件没有直接访问App.tsx方法的权限，我们需要通过其他方式
                  // 这里可以使用一个简单的方案：通过window对象暴露的全局方法
                  // 或者可以考虑使用事件总线或状态管理库
                  // 暂时使用message.info提示，后续可以优化
                }}
                className={darkMode ? 'dark-btn' : ''}
              >
                历史
              </Button>
            </Tooltip>
            <Tooltip title="导入SQL文件">
              <Button 
                icon={<UploadOutlined />} 
                onClick={handleImportQuery}
                className={darkMode ? 'dark-btn' : ''}
              />
            </Tooltip>
            <Tooltip title="数据导入">
              <Button 
                icon={<UploadOutlined />} 
                onClick={() => setShowImportModal(true)}
                className={darkMode ? 'dark-btn' : ''}
              >
                数据导入
              </Button>
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
      
      {/* 数据导入模态框 */}
      <DataImportModal
        visible={showImportModal}
        onCancel={() => setShowImportModal(false)}
        connection={connection || null}
        database={database}
        tables={tableList}
        darkMode={darkMode}
      />
    </div>
  );
};

export default MySqlQueryPanel;