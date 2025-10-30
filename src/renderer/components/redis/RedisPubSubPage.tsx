import React, { useEffect, useRef, useState } from 'react';
import { Card, Input, Button, Space, List, Alert, Typography, message, Switch } from 'antd';
import type { DatabaseConnection } from '../../types';
import { execRedisQueuedWithTimeout } from '../../utils/redis-exec-queue';

interface Props {
  connection: DatabaseConnection;
  database: string; // e.g. 'db0'
  darkMode?: boolean;
}

const RedisPubSubPage: React.FC<Props> = ({ connection, database, darkMode }) => {
  const [channel, setChannel] = useState<string>('');
  const [messageText, setMessageText] = useState<string>('');
  const [channels, setChannels] = useState<string[]>([]);
  const [subsInfo, setSubsInfo] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [subscribeInput, setSubscribeInput] = useState<string>('');
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [isPattern, setIsPattern] = useState<boolean>(false);
  const [stream, setStream] = useState<Array<{ ts: number; channel: string; message: string }>>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const poolId = connection?.connectionId;

  const ensureDb = async () => {
    try {
      const m = String(database).match(/db(\d+)/i);
      const dbIndex = m ? parseInt(m[1], 10) : (Number(database) || 0);
      await execRedisQueuedWithTimeout(poolId!, 'select', [String(dbIndex)], 3000);
    } catch {}
  };

  const refreshChannels = async () => {
    try {
      setLoading(true);
      setError('');
      if (!poolId) { setError('连接未准备好'); return; }
      await ensureDb();
      const res = await execRedisQueuedWithTimeout(poolId, 'pubsub', ['channels'], 8000);
      if (res && res.success) {
        const list = Array.isArray(res.data) ? res.data.map((c: any) => String(c)) : [];
        setChannels(list);
        const info: Record<string, number> = {};
        for (const ch of list.slice(0, 50)) {
          const numRes = await execRedisQueuedWithTimeout(poolId, 'pubsub', ['numsub', ch], 5000);
          if (numRes && numRes.success) {
            // 兼容 node-redis v4 返回对象 {channel: count} 与原生数组 [channel, count]
            const raw = (numRes as any).data;
            let count = 0;
            if (Array.isArray(raw)) {
              // 情况1：直接是数组 [channel, count]
              if (raw.length >= 2 && String(raw[0]).toLowerCase() === ch.toLowerCase()) {
                count = Number(raw[1] ?? 0);
              } else if (raw.length === 1 && typeof raw[0] === 'object' && raw[0] !== null) {
                // 情况2：formatResult 包装为 [object]
                const obj = raw[0] as Record<string, any>;
                count = Number(obj[ch] ?? Object.values(obj)[0] ?? 0);
              }
            } else if (typeof raw === 'object' && raw !== null) {
              // 情况3：直接是对象 {channel: count}
              count = Number((raw as any)[ch] ?? Object.values(raw)[0] ?? 0);
            }
            info[ch] = Number.isFinite(count) ? count : 0;
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

  const subscribeChannels = async () => {
    const raw = subscribeInput.trim();
    if (!raw) { message.warning('请输入要订阅的频道或模式，多个以逗号分隔'); return; }
    const list = raw.split(',').map(s => s.trim()).filter(Boolean);
    try {
      await ensureDb();
      const res: any = await (window as any).electronAPI.redisSubscribe(poolId!, list, isPattern);
      if (res && res.success) {
        setSubscribed(true);
        message.success(isPattern ? '模式订阅成功' : '订阅成功');
      } else {
        message.error(String(res?.error || '订阅失败'));
      }
    } catch (e: any) {
      message.error(e?.message || '订阅异常');
    }
  };

  const unsubscribeChannels = async () => {
    const raw = subscribeInput.trim();
    const list = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
    try {
      const res: any = await (window as any).electronAPI.redisUnsubscribe(poolId!, list, isPattern);
      if (res && res.success) {
        setSubscribed(false);
        message.success('已取消订阅');
      } else {
        message.error(String(res?.error || '取消订阅失败'));
      }
    } catch (e: any) {
      message.error(e?.message || '取消订阅异常');
    }
  };

  useEffect(() => { refreshChannels(); }, [database]);

  useEffect(() => {
    const handler = (payload: { connectionId: string; channel: string; message: string; ts: number }) => {
      if (payload.connectionId !== poolId) return;
      setStream(prev => {
        const next = [...prev, { ts: payload.ts, channel: payload.channel, message: payload.message }];
        if (next.length > 500) next.shift();
        return next;
      });
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight;
      }
    };
    (window as any).electronAPI.onRedisPubSubMessage(handler);
    return () => {
      (window as any).electronAPI.removeAllListeners('redis-pubsub-message');
      // 组件卸载时尝试取消订阅当前输入的频道或模式
      if (subscribed && subscribeInput.trim()) {
        const list = subscribeInput.split(',').map(s => s.trim()).filter(Boolean);
        (window as any).electronAPI.redisUnsubscribe(poolId!, list, isPattern).catch(() => {});
      }
    };
  }, [poolId, subscribed, subscribeInput, isPattern]);

  return (
    <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column' }} className={darkMode ? 'dark-theme' : ''}>
      <Card title="Redis 发布/订阅" size="small" style={{ marginBottom: 12 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {error && <Alert type="error" showIcon message={error} />}
          <Space>
            <Input placeholder="频道" value={channel} onChange={e => setChannel(e.target.value)} style={{ width: 220 }} />
            <Input placeholder="消息" value={messageText} onChange={e => setMessageText(e.target.value)} style={{ width: 360 }} />
            <Button type="primary" onClick={publishMessage}>发布</Button>
          </Space>
          <Space>
            <Input placeholder={isPattern ? '订阅模式（支持*?等），多个以逗号分隔' : '订阅频道，多个以逗号分隔'} value={subscribeInput} onChange={e => setSubscribeInput(e.target.value)} style={{ width: 360 }} />
            <span>模式订阅</span>
            <Switch checked={isPattern} onChange={setIsPattern} />
            <Button type="primary" onClick={subscribeChannels} disabled={!poolId || subscribed}>开始订阅</Button>
            <Button onClick={unsubscribeChannels} disabled={!poolId || !subscribed}>取消订阅</Button>
          </Space>
        </Space>
      </Card>
      <div ref={listRef} style={{ flex: 1, minHeight: 0, maxHeight: '100%', overflow: 'auto' }}>
        <List
          bordered
          size="small"
          dataSource={stream}
          renderItem={(item) => (
            <List.Item>
              <Space direction="vertical">
                <Typography.Text>{new Date(item.ts).toLocaleString()} 频道: {item.channel}</Typography.Text>
                <Typography.Text code>{item.message}</Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      </div>
    </div>
  );
};

export default RedisPubSubPage;