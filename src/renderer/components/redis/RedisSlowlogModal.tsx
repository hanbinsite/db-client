import React, { useEffect, useState } from 'react';
import { Modal, Table, Space, Button, Alert, Typography, message } from 'antd';
import type { DatabaseConnection } from '../../types';
import { execRedisQueuedWithTimeout } from '../../utils/redis-exec-queue';

interface RedisSlowlogModalProps {
  visible: boolean;
  onClose: () => void;
  connection?: DatabaseConnection;
  activeDatabase?: string;
  darkMode?: boolean;
}

interface SlowlogRow {
  id: number;
  time: number; // unix seconds
  durationMicro: number;
  cmd: string;
}

const RedisSlowlogModal: React.FC<RedisSlowlogModalProps> = ({ visible, onClose, connection, activeDatabase, darkMode }) => {
  const [rows, setRows] = useState<SlowlogRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const poolId = connection?.connectionId;

  const loadSlowlog = async () => {
    try {
      setLoading(true);
      setError('');
      if (!poolId) { setError('连接未准备好'); return; }
      try {
        const dbName = activeDatabase || connection?.database || '0';
        await execRedisQueuedWithTimeout(poolId, 'select', [dbName], 3000);
      } catch {}
      const res = await execRedisQueuedWithTimeout(poolId, 'slowlog', ['get', '30'], 8000);
      if (res && res.success) {
        const data: any = res.data;
        const arr: any[] = Array.isArray(data) ? data : [];
        // 典型返回: [[id,time,duration,[cmd and args]],[...]]
        const mapped: SlowlogRow[] = arr.map((e: any[]) => {
          const id = Number(e?.[0] ?? 0);
          const time = Number(e?.[1] ?? 0);
          const dur = Number(e?.[2] ?? 0);
          const cmdList = e?.[3];
          const cmdText = Array.isArray(cmdList) ? cmdList.map(x => String(x)).join(' ') : String(cmdList ?? '');
          return { id, time, durationMicro: dur, cmd: cmdText };
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

  useEffect(() => { if (visible) loadSlowlog(); }, [visible]);

  return (
    <Modal
      title="Redis 慢日志"
      open={visible}
      onCancel={onClose}
      footer={null}
      width={800}
      className={darkMode ? 'dark-modal' : ''}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {error && <Alert type="error" showIcon message={error} />}
        <Space>
          <Button type="primary" onClick={loadSlowlog} loading={loading}>刷新</Button>
          <Button danger onClick={resetSlowlog}>清空慢日志</Button>
        </Space>
        <Table
          size="small"
          rowKey={r => String(r.id)}
          loading={loading}
          dataSource={rows}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: 'ID', dataIndex: 'id', width: 120 },
            { title: '时间', dataIndex: 'time', width: 180, render: (t: number) => new Date(t * 1000).toLocaleString() },
            { title: '耗时(μs)', dataIndex: 'durationMicro', width: 140 },
            { title: '命令', dataIndex: 'cmd' }
          ]}
        />
      </Space>
    </Modal>
  );
};

export default RedisSlowlogModal;