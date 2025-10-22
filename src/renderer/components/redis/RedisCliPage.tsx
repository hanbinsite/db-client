import React, { useEffect, useState } from 'react';
import { Card, Input, Button, Space, Alert, Typography, message } from 'antd';
import type { DatabaseConnection } from '../../types';
import { execRedisQueuedWithTimeout } from '../../utils/redis-exec-queue';

interface Props {
  connection: DatabaseConnection;
  database: string; // e.g. 'db0'
  darkMode?: boolean;
}

const RedisCliPage: React.FC<Props> = ({ connection, database, darkMode }) => {
  const [command, setCommand] = useState<string>('');
  const [paramsText, setParamsText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [output, setOutput] = useState<string>('');
  const poolId = connection?.connectionId;

  useEffect(() => {
    setError('');
  }, [database]);

  const parseParams = (text: string): any[] => {
    const trimmed = (text || '').trim();
    if (!trimmed) return [];
    try {
      if (trimmed.startsWith('[')) {
        const arr = JSON.parse(trimmed);
        return Array.isArray(arr) ? arr.map(v => String(v)) : [];
      }
    } catch {}
    return trimmed.split(/[\s,]+/).filter(Boolean).map(s => s.trim());
  };

  const ensureDb = async () => {
    try {
      const m = String(database).match(/db(\d+)/i);
      const dbIndex = m ? parseInt(m[1], 10) : (Number(database) || 0);
      await execRedisQueuedWithTimeout(poolId!, 'select', [String(dbIndex)], 3000);
    } catch {}
  };

  const runCommand = async () => {
    try {
      setLoading(true);
      setError('');
      setOutput('');
      if (!poolId) { setError('连接未准备好'); return; }
      await ensureDb();
      const params = parseParams(paramsText);
      const res = await execRedisQueuedWithTimeout(poolId, command, params, 8000);
      if (res && res.success) {
        const data = Array.isArray(res.data) ? res.data : [res.data];
        const text = data.map((d: any) => {
          const v = (typeof d === 'object') ? JSON.stringify(d) : String(d);
          return v;
        }).join('\n');
        setOutput(text);
        message.success('命令执行成功');
      } else {
        setError(String(res?.error || '执行失败'));
      }
    } catch (e: any) {
      setError(e?.message || '执行异常');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column' }} className={darkMode ? 'dark-theme' : ''}>
      <Card title="Redis 命令行" size="small" style={{ marginBottom: 12 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {error && <Alert type="error" showIcon message={error} />}
          <Input placeholder="命令 (例如: get/set/hgetall)" value={command} onChange={e => setCommand(e.target.value)} />
          <Input placeholder="参数 (JSON数组或用空格/逗号分隔)" value={paramsText} onChange={e => setParamsText(e.target.value)} />
          <Space>
            <Button type="primary" loading={loading} onClick={runCommand} disabled={!command.trim()}>执行</Button>
            <Button onClick={() => { setCommand(''); setParamsText(''); setOutput(''); setError(''); }}>清空</Button>
          </Space>
        </Space>
      </Card>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Typography.Text type="secondary">输出：</Typography.Text>
        <pre style={{ height: '100%', overflow: 'auto', padding: 12, background: 'var(--code-bg, #fafafa)' }}>{output}</pre>
      </div>
    </div>
  );
};

export default RedisCliPage;