import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Space, Button, Alert, Table, InputNumber, Input, Typography, message, Switch, DatePicker } from 'antd';
import type { DatabaseConnection } from '../../types';
import { execRedisQueuedWithTimeout } from '../../utils/redis-exec-queue';
import type { Dayjs } from 'dayjs';

interface Props {
  connection: DatabaseConnection;
  database: string; // e.g. 'db0'
  darkMode?: boolean;
}

interface SlowlogRow {
  id: number;
  time: number; // unix seconds
  durationMicro: number;
  cmd: string;
  client?: string;
  clientName?: string;
}

const { RangePicker } = DatePicker;

const RedisSlowlogPage: React.FC<Props> = ({ connection, database, darkMode }) => {
  const poolId = connection?.connectionId;
  const [count, setCount] = useState<number>(30);
  const [search, setSearch] = useState<string>('');
  const [rows, setRows] = useState<SlowlogRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [timeRange, setTimeRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [durationThresholdMs, setDurationThresholdMs] = useState<number>(0);
  const [autoRefresh, setAutoRefresh] = useState<boolean>(false);
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(10);
  const refreshTimerRef = useRef<number | undefined>(undefined);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    const start = timeRange?.[0]?.valueOf();
    const end = timeRange?.[1]?.valueOf();
    const thresholdMicro = durationThresholdMs > 0 ? durationThresholdMs * 1000 : 0;
    return rows.filter(r => {
      if (s && !r.cmd.toLowerCase().includes(s)) return false;
      const tsMs = r.time * 1000;
      if (start && tsMs < start) return false;
      if (end && tsMs > end) return false;
      if (thresholdMicro > 0 && r.durationMicro < thresholdMicro) return false;
      return true;
    });
  }, [rows, search, timeRange, durationThresholdMs]);

  const ensureSelectDb = async () => {
    if (!poolId) return;
    try {
      const m = String(database).match(/db(\d+)/i);
      const dbIndex = m ? parseInt(m[1], 10) : (Number(database) || 0);
      await execRedisQueuedWithTimeout(poolId, 'select', [String(dbIndex)], 3000);
    } catch {}
  };

  const loadSlowlog = async () => {
    try {
      setLoading(true);
      setError('');
      if (!poolId) { setError('连接未准备好'); return; }
      await ensureSelectDb();
      const res = await execRedisQueuedWithTimeout(poolId, 'slowlog', ['get', String(count)], 8000);
      if (res && res.success) {
        const data: any = res.data;
        const arr: any[] = Array.isArray(data) ? data : [];
        const mapped: SlowlogRow[] = arr.map((e: any[]) => {
          const id = Number(e?.[0] ?? 0);
          const time = Number(e?.[1] ?? 0);
          const dur = Number(e?.[2] ?? 0);
          const cmdList = e?.[3];
          const cmdText = Array.isArray(cmdList) ? cmdList.map(x => String(x)).join(' ') : String(cmdList ?? '');
          const client = String(e?.[4] ?? '');
          const clientName = String(e?.[5] ?? '');
          return { id, time, durationMicro: dur, cmd: cmdText, client, clientName };
        });
        setRows(mapped);
      } else {
        setError(String(res?.error || '获取慢日志失败'));
      }
    } catch (e: any) {
      setError(e?.message || '获取慢日志异常');
    } finally {
      setLoading(false);
    }
  };

  const resetSlowlog = async () => {
    try {
      if (!poolId) return;
      const res = await execRedisQueuedWithTimeout(poolId, 'slowlog', ['reset'], 5000);
      if (res && res.success) {
        message.success('慢日志已清空');
        await loadSlowlog();
      } else {
        message.error('清空慢日志失败');
      }
    } catch (e: any) {
      message.error(e?.message || '清空慢日志异常');
    }
  };

  const exportCsv = async () => {
    try {
      const save = await (window as any).electronAPI.showSaveDialog('redis-slowlog.csv', 'csv');
      const filePath: string | undefined = save?.filePath;
      if (!filePath) return;
      const rowsToExport = filtered.map(r => ({
        id: r.id,
        time_iso: new Date(r.time * 1000).toISOString(),
        duration_us: r.durationMicro,
        command: r.cmd,
        client: r.client || '',
        client_name: r.clientName || ''
      }));
      const res = await (window as any).electronAPI.writeExportFile(filePath, rowsToExport, 'csv', 'redis');
      if (res && res.success) {
        message.success('CSV 导出成功');
      } else {
        message.error(String(res?.message || 'CSV 导出失败'));
      }
    } catch (e: any) {
      message.error(e?.message || 'CSV 导出异常');
    }
  };

  useEffect(() => { loadSlowlog(); }, [database]);

  useEffect(() => {
    if (!autoRefresh) {
      if (refreshTimerRef.current) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = undefined;
      }
      return;
    }
    refreshTimerRef.current = window.setInterval(() => {
      loadSlowlog();
    }, Math.max(1, refreshIntervalSec) * 1000);
    return () => {
      if (refreshTimerRef.current) {
        window.clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = undefined;
      }
    };
  }, [autoRefresh, refreshIntervalSec, database]);

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column' }} className={darkMode ? 'dark-theme' : ''}>
      <Card title="Redis 慢日志" size="small" style={{ marginBottom: 12 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {/* 第一行：查看数量、加载、清空、导出、自动刷新、间隔 */}
          <Space align="center" wrap>
            <span>查看前</span>
            <InputNumber min={1} max={1000} value={count} onChange={(v) => setCount(Number(v || 30))} />
            <span>条</span>
            <Button type="primary" onClick={loadSlowlog} loading={loading}>加载</Button>
            <Button danger onClick={resetSlowlog}>清空慢日志</Button>
            <Button onClick={exportCsv}>导出 CSV</Button>
            <span style={{ marginLeft: 8 }}>自动刷新</span>
            <Switch checked={autoRefresh} onChange={setAutoRefresh} />
            <span>间隔(s)</span>
            <InputNumber min={1} max={3600} value={refreshIntervalSec} onChange={(v) => setRefreshIntervalSec(Number(v || 10))} />
          </Space>
          {/* 第二行：过滤条件换行展示 */}
          <Space align="center" wrap>
            <span>命令过滤</span>
            <Input allowClear placeholder="输入命令子串，例如: zrange" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
            <span style={{ marginLeft: 16 }}>时间范围</span>
            <RangePicker
              showTime
              value={timeRange as any}
              onChange={(v) => setTimeRange(v as any)}
              style={{ width: 360 }}
            />
            <span>耗时阈值(ms)</span>
            <InputNumber min={0} max={1000000} value={durationThresholdMs} onChange={(v) => setDurationThresholdMs(Number(v || 0))} />
          </Space>
        </Space>
        {error && <Alert style={{ marginTop: 12 }} type="error" showIcon message={error} />}
      </Card>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Table
          size="small"
          rowKey={r => String(r.id)}
          loading={loading}
          dataSource={filtered}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 120 },
            { title: '时间', dataIndex: 'time', width: 180, render: (t: number) => new Date(t * 1000).toLocaleString() },
            { title: '耗时(μs)', dataIndex: 'durationMicro', width: 140 },
            { title: '命令', dataIndex: 'cmd' },
            { title: '客户端', dataIndex: 'client', width: 160 },
            { title: '客户端名', dataIndex: 'clientName', width: 160 }
          ]}
        />
      </div>
    </div>
  );
};

export default RedisSlowlogPage;