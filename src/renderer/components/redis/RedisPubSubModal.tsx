import React, { useEffect, useState } from 'react';
import { Modal, Input, Button, Space, List, Alert, Typography, message } from 'antd';
import type { DatabaseConnection } from '../../types';
import { execRedisQueuedWithTimeout } from '../../utils/redis-exec-queue';

interface RedisPubSubModalProps {
  visible: boolean;
  onClose: () => void;
  connection?: DatabaseConnection;
  activeDatabase?: string;
  darkMode?: boolean;
}

const RedisPubSubModal: React.FC<RedisPubSubModalProps> = ({ visible, onClose, connection, activeDatabase, darkMode }) => {
  const [channel, setChannel] = useState<string>('');
  const [messageText, setMessageText] = useState<string>('');
  const [channels, setChannels] = useState<string[]>([]);
  const [subsInfo, setSubsInfo] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const poolId = connection?.connectionId;

  const refreshChannels = async () => {
    try {
      setLoading(true);
      setError('');
      if (!poolId) { setError('连接未准备好'); return; }
      try {
        const dbName = activeDatabase || connection?.database || '0';
        await execRedisQueuedWithTimeout(poolId, 'select', [dbName], 3000);
      } catch {}
      const res = await execRedisQueuedWithTimeout(poolId, 'pubsub', ['channels'], 8000);
      if (res && res.success) {
        const list = Array.isArray(res.data) ? res.data.map((c: any) => String(c)) : [];
        setChannels(list);
        // 查询订阅数
        const info: Record<string, number> = {};
        for (const ch of list.slice(0, 50)) {
          const numRes = await execRedisQueuedWithTimeout(poolId, 'pubsub', ['numsub', ch], 5000);
          if (numRes && numRes.success) {
            const data = Array.isArray(numRes.data) ? numRes.data : [];
            if (Array.isArray(data) && data.length >= 2) {
              const count = Number(data[1] ?? 0);
              info[ch] = isNaN(count) ? 0 : count;
            }
          }
        }
        setSubsInfo(info);
      } else {
        setError(String(res?.error || '获取频道列表失败'));
      }
    } catch (e: any) {
      setError(e?.message || '获取频道列表异常');
    } finally {
      setLoading(false);
    }
  };

  const publishMessage = async () => {
    try {
      if (!poolId) return;
      const ch = channel.trim();
      if (!ch) { message.warning('请输入频道'); return; }
      const msg = messageText ?? '';
      const res = await execRedisQueuedWithTimeout(poolId, 'publish', [ch, msg], 5000);
      if (res && res.success) {
        message.success('消息已发布');
        setMessageText('');
        await refreshChannels();
      } else {
        message.error('发布失败');
      }
    } catch (e: any) {
      message.error(e?.message || '发布异常');
    }
  };

  useEffect(() => { if (visible) refreshChannels(); }, [visible]);

  return (
    <Modal
      title="Redis 发布/订阅"
      open={visible}
      onCancel={onClose}
      footer={null}
      width={780}
      className={darkMode ? 'dark-modal' : ''}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {error && <Alert type="error" showIcon message={error} />}
        <Space>
          <Input placeholder="频道" value={channel} onChange={e => setChannel(e.target.value)} style={{ width: 220 }} />
          <Input placeholder="消息" value={messageText} onChange={e => setMessageText(e.target.value)} style={{ width: 360 }} />
          <Button type="primary" onClick={publishMessage}>发布</Button>
        </Space>
        <Space>
          <Button onClick={refreshChannels} loading={loading}>刷新频道</Button>
        </Space>
        <Typography.Text type="secondary">活跃频道（最多显示50个订阅数）：</Typography.Text>
        <List
          bordered
          size="small"
          dataSource={channels}
          renderItem={(ch) => (
            <List.Item>
              <Space>
                <Typography.Text>{ch}</Typography.Text>
                <Typography.Text type="secondary">订阅者: {subsInfo[ch] ?? '-'}</Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      </Space>
    </Modal>
  );
};

export default RedisPubSubModal;