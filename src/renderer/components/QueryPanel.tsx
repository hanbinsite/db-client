import React, { useState, useRef, useContext } from 'react';
import { Button, Input, Select, Space, Table, message, Card, Spin, Tooltip } from 'antd';
import {
  PlayCircleOutlined,
  SaveOutlined,
  ClearOutlined,
  DownloadOutlined,
  UploadOutlined,
  CopyOutlined,
  PlayCircleOutlined as RunOutlined,
  FormOutlined,
  CodeOutlined,
  FileSearchOutlined
} from '@ant-design/icons';
import { DatabaseConnection, QueryResult } from '../types';
import { useTheme } from './ThemeContext';
import './QueryPanel.css';

const { TextArea } = Input;
const { Option } = Select;

interface QueryPanelProps {
  connection: DatabaseConnection | null;
  database: string;
  tabKey?: string;
  onTabClose?: (key: string) => void;
  darkMode: boolean;
}

const QueryPanel: React.FC<QueryPanelProps> = ({ connection, database, tabKey, onTabClose, darkMode }) => {
  const [query, setQuery] = useState<string>('SELECT * FROM users LIMIT 10;');
  const [results, setResults] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [executionTime, setExecutionTime] = useState<number>(0);
  const textAreaRef = useRef<any>(null);

  const handleExecuteQuery = async () => {
    if (!connection || !connection.isConnected) {
      message.warning('请先建立数据库连接');
      return;
    }

    if (!query.trim()) {
      message.warning('请输入SQL查询语句');
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
      
      // 执行真实的SQL查询
      const result = await window.electronAPI.executeQuery(poolId, query);
      console.log('查询执行结果:', result);
      
      if (result && result.success && Array.isArray(result.data)) {
        // 提取列名
        const columns = result.data.length > 0 ? Object.keys(result.data[0]) : [];
        
        // 处理真实查询结果
        const queryResult: QueryResult = {
          success: true,
          data: result.data,
          columns: columns,
          rowCount: result.data.length,
          executionTime: Date.now() - startTime
        };

        setResults(queryResult);
        setExecutionTime(Date.now() - startTime);
        message.success('查询执行成功');
      } else if (result && result.success) {
        // 处理没有返回数据的成功查询
        const queryResult: QueryResult = {
          success: true,
          data: [],
          columns: [],
          rowCount: 0,
          executionTime: Date.now() - startTime
        };

        setResults(queryResult);
        setExecutionTime(Date.now() - startTime);
        message.success('命令执行成功');
      } else {
        throw new Error(result?.error || '查询执行失败');
      }
    } catch (error) {
      const errorResult: QueryResult = {
        success: false,
        error: (error as Error)?.message || '查询执行失败'
      };
      setResults(errorResult);
      message.error('查询执行失败');
    } finally {
      setLoading(false);
    }
  };

  const handleClearQuery = () => {
    setQuery('');
    setResults(null);
    setExecutionTime(0);
    if (textAreaRef.current) {
      textAreaRef.current.focus();
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
    if (!results || !results.success || !results.data) {
      message.warning('没有可导出的结果');
      return;
    }
    // 简单的CSV导出实现
    const headers = (results.columns || []).join(',');
    const rows = results.data.map(row => 
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
    if (!results || !results.success || !results.data) {
      message.warning('没有可复制的结果');
      return;
    }
    // 将结果复制到剪贴板
    const text = results.data.map(row => 
      Object.values(row).join('\t')
    ).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      message.success('结果已复制到剪贴板');
    });
  };

  const handleExecuteExplain = () => {
    if (!query.trim()) {
      message.warning('请先输入SQL查询语句');
      return;
    }
    setQuery(`EXPLAIN ${query}`);
  };

  const handleCancelExplain = () => {
    if (query.startsWith('EXPLAIN ')) {
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
            <strong>错误:</strong> {results.error}
          </div>
        </Card>
      );
    }

    if (results.data && results.columns) {
      const columns = results.columns.map(col => ({
        title: col,
        dataIndex: col,
        key: col,
        ellipsis: true
      }));

      return (
        <Card 
          title={
            <Space>
              <span>执行结果</span>
              <span style={{ fontSize: '12px', color: darkMode ? '#999' : '#666' }}>
                行数: {results.rowCount} | 耗时: {executionTime}ms
              </span>
            </Space>
          }
          size="small" 
          style={{ marginTop: 16 }}
          className={`query-results ${darkMode ? 'dark-card' : ''}`}
        >
          <Table
            dataSource={results.data}
            columns={columns}
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
          />
        </Card>
      );
    }

    return (
      <Card 
        title="执行结果" 
        size="small" 
        style={{ marginTop: 16 }}
        className={`query-results ${darkMode ? 'dark-card' : ''}`}
      >
        <div style={{ padding: '8px 0', color: darkMode ? '#69d183' : '#52c41a' }}>
          命令执行成功
        </div>
      </Card>
    );
  };

  return (
    <div className={`query-panel ${darkMode ? 'dark' : ''}`}>
      <div className="query-toolbar">
        {/* 连接信息显示 */}
        <div className="connection-info">
          {connection ? (
            <Tooltip title={`数据库: ${database || '未选择数据库'}`}>
              <span style={{ fontSize: '12px', color: darkMode ? '#999' : '#666' }}>
                {connection.name} ({connection.type})
              </span>
            </Tooltip>
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
                disabled={!results || !results.success || !results.data}
                className={darkMode ? 'dark-btn' : ''}
              />
            </Tooltip>
            <Tooltip title="执行计划">
              <Button 
                icon={<FileSearchOutlined />} 
                onClick={handleExecuteExplain}
                className={darkMode ? 'dark-btn' : ''}
              />
            </Tooltip>
            <Tooltip title="复制结果">
              <Button 
                icon={<CopyOutlined />} 
                onClick={handleCopyResult}
                disabled={!results || !results.success || !results.data}
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
          {query.startsWith('EXPLAIN ') && (
            <Tooltip title="点击取消执行计划模式">
              <span className="explain-mode" onClick={handleCancelExplain}>
                [执行计划模式]
              </span>
            </Tooltip>
          )}
        </div>
        <div className="editor-stats">
          <span>{query.split('\n').length} 行</span>
          <span>{query.length} 字符</span>
        </div>
      </div>

      {/* SQL编辑器 */}
      <div className="query-editor-container">
        <TextArea
          ref={textAreaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="请输入SQL查询语句，多条语句用分号分隔\n\n快捷键: Ctrl+Enter 执行查询, Ctrl+Shift+F 格式化"
          className={darkMode ? 'dark-textarea' : ''}
          style={{ 
            height: 200, 
            resize: 'vertical',
            minHeight: 120,
            maxHeight: 400,
            fontFamily: '"Monaco", "Menlo", "Ubuntu Mono", monospace',
            fontSize: '13px',
            lineHeight: 1.6,
            padding: '10px 12px',
            borderRadius: '2px',
            border: `1px solid ${darkMode ? '#333' : '#d9d9d9'}`
          }}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'Enter') {
              handleExecuteQuery();
            } else if (e.ctrlKey && e.shiftKey && e.key === 'F') {
              e.preventDefault();
              handleFormatSQL();
            }
          }}
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
              ? `执行成功，耗时: ${executionTime}ms` 
              : `执行失败: ${results.error}`}
          </span>
        </div>
      )}

      {/* 查询结果 */}
      {renderResults()}
    </div>
  );
};

export default QueryPanel;