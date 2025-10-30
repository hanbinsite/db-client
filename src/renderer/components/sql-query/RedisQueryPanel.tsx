import React, { useState, useRef, useEffect } from 'react';
import { Button, Space, Table, message, Card, Spin } from 'antd';
import { PlayCircleOutlined, ClearOutlined, DatabaseOutlined } from '@ant-design/icons';
import { BaseQueryPanelProps } from './types';
import Editor from '@monaco-editor/react';
import { execRedisQueuedWithTimeout } from '../../utils/redis-exec-queue';
import './QueryPanel.css';

interface RenderedResult {
  success: boolean;
  type?: string;
  data?: any;
  error?: string;
  elapsed?: number;
  op?: string;
}

const RedisQueryPanel: React.FC<BaseQueryPanelProps> = ({ connection, database, darkMode }) => {
  const poolId = connection?.connectionId;
  const [loading, setLoading] = useState(false);
  const [executionTime, setExecutionTime] = useState<number>(0);
  const [results, setResults] = useState<RenderedResult | null>(null);
  const [commandText, setCommandText] = useState<string>('');
  // 允许编辑器高度拖拽调整
  const [editorHeight, setEditorHeight] = useState<number>(220);
  const startYRef = useRef<number | null>(null);
  const startHeightRef = useRef<number>(editorHeight);

  useEffect(() => {
    startHeightRef.current = editorHeight;
  }, [editorHeight]);

  const handleResizeMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    startYRef.current = e.clientY;
    const onMouseMove = (ev: MouseEvent) => {
      if (startYRef.current === null) return;
      const delta = ev.clientY - startYRef.current;
      const next = startHeightRef.current + delta;
      const MIN = 120;
      const MAX = 600;
      setEditorHeight(Math.max(MIN, Math.min(MAX, next)));
    };
    const onMouseUp = () => {
      startYRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  const ensureDb = async () => {
    if (!poolId) return;
    const m = String(database).match(/db(\d+)/i);
    const dbIndex = m ? parseInt(m[1], 10) : (Number(database) || 0);
    await execRedisQueuedWithTimeout(poolId, 'select', [String(dbIndex)], 5000);
  };

  const execWithReconnect = async (query: string, params: any[] = [], timeoutMs = 8000) => {
    if (!poolId) throw new Error('连接未准备好');
    const runOnce = async (pid: string) => execRedisQueuedWithTimeout(pid, query, params, timeoutMs);
    let currentPid = poolId!;
    let res: any = await runOnce(currentPid);
    const msg = String(((res as any)?.message || (res as any)?.error || ''));
    if (res && res.success === false && (msg.includes('连接池不存在') || msg.includes('Redis client not connected') || msg.includes('获取连接超时'))) {
      try {
        const reconnect = await (window as any).electronAPI?.connectDatabase?.(connection);
        if (reconnect && reconnect.success && reconnect.connectionId) {
          currentPid = reconnect.connectionId;
          if (connection) {
            (connection as any).connectionId = currentPid;
            (connection as any).isConnected = true;
          }
          res = await runOnce(currentPid);
        }
      } catch {}
    }
    return res;
  };

  const renderRowsFromResult = (type: string, data: any): Array<any> => {
    switch (type) {
      case 'string':
        return [{ key: 'value', value: typeof data === 'string' ? data : String(data) }];
      case 'hash':
        if (Array.isArray(data)) {
          const rows: any[] = [];
          for (let i = 0; i < data.length; i += 2) {
            rows.push({ field: String(data[i]), value: String(data[i + 1]) });
          }
          return rows.map((r, idx) => ({ key: idx, ...r }));
        }
        if (data && typeof data === 'object') {
          return Object.keys(data).map((k, idx) => ({ key: idx, field: k, value: String((data as any)[k]) }));
        }
        return [];
      case 'list':
        if (Array.isArray(data)) {
          return data.map((v, idx) => ({ key: idx, index: idx, value: String(v) }));
        }
        return [];
      case 'set':
        if (Array.isArray(data)) {
          return data.map((v, idx) => ({ key: idx, member: String(v) }));
        }
        return [];
      case 'zset':
        if (Array.isArray(data)) {
          const rows: any[] = [];
          if (data.length && typeof data[0] === 'string') {
            for (let i = 0; i < data.length; i += 2) {
              rows.push({ member: String(data[i]), score: Number(data[i + 1]) });
            }
          } else {
            return data.map((item: any, idx) => ({ key: idx, member: String(item.member), score: Number(item.score) }));
          }
          return rows.map((r, idx) => ({ key: idx, ...r }));
        }
        return [];
      default:
        return Array.isArray(data) ? data.map((v, idx) => ({ key: idx, value: typeof v === 'string' ? v : JSON.stringify(v) })) : [];
    }
  };

  const getColumnsForType = (type?: string) => {
    switch (type) {
      case 'string':
        return [
          { title: '键', dataIndex: 'key', key: 'key', width: 120 },
          { title: '值', dataIndex: 'value', key: 'value' }
        ];
      case 'hash':
        return [
          { title: '字段', dataIndex: 'field', key: 'field', width: 200 },
          { title: '值', dataIndex: 'value', key: 'value' }
        ];
      case 'list':
        return [
          { title: '索引', dataIndex: 'index', key: 'index', width: 100 },
          { title: '元素', dataIndex: 'value', key: 'value' }
        ];
      case 'set':
        return [
          { title: '成员', dataIndex: 'member', key: 'member' }
        ];
      case 'zset':
        return [
          { title: '成员', dataIndex: 'member', key: 'member' },
          { title: '分数', dataIndex: 'score', key: 'score', width: 120 }
        ];
      default:
        return [
          { title: '值', dataIndex: 'value', key: 'value' }
        ];
    }
  };

  const handleExecuteCommand = async () => {
    const text = commandText.trim();
    if (!text) { message.warning('请输入命令'); return; }
    const parts = text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    try {
      setLoading(true);
      setResults(null);
      await ensureDb();
      const start = performance.now();
      const res = await execWithReconnect(cmd, args, 15000);
      const end = performance.now();
      setExecutionTime(Math.round(end - start));
      if (res && res.success) {
        const opTypeMap: Record<string, string> = {
          get: 'string',
          hgetall: 'hash',
          lrange: 'list',
          smembers: 'set',
          zrange: 'zset'
        };
        const inferredType = opTypeMap[cmd] || undefined;
        setResults({ success: true, data: res.data, elapsed: Math.round(end - start), op: cmd, type: inferredType });
      } else {
        setResults({ success: false, error: String((res && res.error) || '执行失败'), op: cmd });
      }
    } catch (e: any) {
      setResults({ success: false, error: e?.message || '执行异常' });
    } finally {
      setLoading(false);
    }
  };

  const renderResults = () => {
    if (!results) return null;
    if (!results.success) {
      return (
        <Card size="small" style={{ margin: 16 }}>
          <div style={{ color: '#f5222d' }}>{results.error || '执行失败'}</div>
        </Card>
      );
    }
    const type = results.type || 'generic';
    const rows = renderRowsFromResult(type, results.data);
    const columns = getColumnsForType(type);

    if (type === 'string') {
      const val = (rows[0]?.value ?? (typeof results.data === 'string' ? results.data : JSON.stringify(results.data)));
      return (
        <Card size="small" style={{ margin: 16 }} title="字符串值">
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace' }}>{String(val)}</pre>
        </Card>
      );
    }

    return (
      <div style={{ padding: '0 16px 16px' }}>
        <Table
          dataSource={rows}
          columns={columns}
          size="small"
          pagination={false}
          scroll={{ x: true, y: 'calc(100vh - 430px)' }}
          bordered
          rowKey="key"
          className={darkMode ? 'dark-table' : ''}
        />
      </div>
    );
  };

  return (
    <div className={`query-panel ${darkMode ? 'dark' : ''}`}>
      <div className="query-toolbar">
        <div className="connection-info" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <DatabaseOutlined />
          {connection ? (
            <div>
              <span style={{ fontSize: '12px', color: darkMode ? '#999' : '#666', marginRight: '8px' }}>
                {connection.name} (Redis)
              </span>
              <span style={{ fontSize: '12px', color: darkMode ? '#69d183' : '#52c41a' }}>
                数据库: {database || '未选择数据库'}
              </span>
            </div>
          ) : (
            <span style={{ fontSize: '12px', color: '#999' }}>未连接数据库</span>
          )}
        </div>
      </div>

      <div className="query-editor-container">
        <div className="sql-editor-toolbar">
          <div className="editor-info">
            <span className="file-name">Redis 命令</span>
            <span>单行命令，空格分隔参数</span>
          </div>
          <div className="editor-stats">
            <span>耗时: {executionTime}ms</span>
          </div>
        </div>
        <Editor
          height={`${editorHeight}px`}
          language="plaintext"
          theme={darkMode ? 'vs-dark' : 'light'}
          value={commandText}
          onChange={(v) => setCommandText(v || '')}
          options={{ minimap: { enabled: false }, fontSize: 13 }}
        />
        <div className={`resize-handle ${darkMode ? 'dark' : ''}`} onMouseDown={handleResizeMouseDown} />
        <div style={{ padding: '8px 16px' }}>
          <Space>
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleExecuteCommand} loading={loading}>执行</Button>
            <Button icon={<ClearOutlined />} onClick={() => setCommandText('')} className={darkMode ? 'dark-btn' : ''}>清空</Button>
          </Space>
        </div>
      </div>

      {loading && (
        <div className="execution-status" style={{ padding: '8px 16px' }}>
          <Spin size="small" tip="执行中..." />
          <span className="execution-time">准备执行...</span>
        </div>
      )}

      {results && !loading && (
        <div className="execution-status" style={{ padding: '8px 16px' }}>
          <span className={`execution-time ${results.success ? 'success' : 'error'}`}>
            {results.success 
              ? `执行成功，耗时: ${executionTime}ms | 操作: ${results.op || ''}` 
              : `执行失败: ${results.error}`}
          </span>
        </div>
      )}

      {renderResults()}
    </div>
  );
};

export default RedisQueryPanel;