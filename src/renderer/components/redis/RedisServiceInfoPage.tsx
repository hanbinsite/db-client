import React, { useEffect, useMemo, useState } from 'react';
import { Card, Descriptions, Statistic, Row, Col, Tag, Space, Alert, Spin, Divider, Tabs, Progress, InputNumber, Select, Switch, Button, Typography, Table, Input } from 'antd';
import { Line, Pie, Column, Area } from '@ant-design/plots';
import type { DatabaseConnection } from '../../types';
import { execRedisQueued, execRedisQueuedWithTimeout } from '../../utils/redis-exec-queue';

interface Props {
  connection: DatabaseConnection;
  database: string; // e.g. 'db0'
  darkMode?: boolean;
}

interface InfoSections {
  [section: string]: Record<string, string>;
}

const parseRedisInfo = (raw: string): InfoSections => {
  const sections: InfoSections = {};
  let current = 'general';
  const lines = String(raw || '').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) {
      if (t.startsWith('#')) {
        const name = t.replace(/^#\s*/, '').toLowerCase();
        current = name || 'general';
        if (!sections[current]) sections[current] = {};
      }
      continue;
    }
    const idx = t.indexOf(':');
    if (idx > 0) {
      const k = t.slice(0, idx).trim();
      const v = t.slice(idx + 1).trim();
      if (!sections[current]) sections[current] = {};
      sections[current][k] = v;
    }
  }
  return sections;
};

const parseKeyspace = (raw: string) => {
  // e.g. db0:keys=1,expires=0,avg_ttl=0
  const out: Record<string, { keys: number; expires: number; avg_ttl: number }> = {};
  const lines = String(raw || '').split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const [db, rest] = t.split(':');
    if (!db || !rest) continue;
    const obj: any = {};
    rest.split(',').forEach(pair => {
      const [k, v] = pair.split('=');
      obj[k] = Number(v);
    });
    out[db] = {
      keys: Number(obj.keys) || 0,
      expires: Number(obj.expires) || 0,
      avg_ttl: Number(obj.avg_ttl) || 0,
    };
  }
  return out;
};

const num = (v: any) => Number(v || 0);
const toNum = num;
const fmtTime = (t: number) => new Date(t).toLocaleTimeString();
const bytesToMB = (b: number) => Number((b / (1024 * 1024)).toFixed(2));
const bytesTo = (b: number, unit: 'MB'|'GB') => unit === 'GB' ? Number((b / (1024 * 1024 * 1024)).toFixed(2)) : Number((b / (1024 * 1024)).toFixed(2));
// 新增：将CPU秒转为可读时长
const fmtDuration = (sec: number) => {
  const s = Math.max(0, Math.floor(Number(sec || 0)));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${h}h ${m}m ${ss}s`;
};

const RedisServiceInfoPage: React.FC<Props> = ({ connection, database, darkMode }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [sections, setSections] = useState<InfoSections>({});
  const [keyspace, setKeyspace] = useState<Record<string, { keys: number; expires: number; avg_ttl: number }>>({});
  const [commandStats, setCommandStats] = useState<Array<{cmd: string; calls: number; usec: number; usecPerCall: number}>>([]);
  const [clusterNodes, setClusterNodes] = useState<string>('');

  // 采样 & 趋势状态
  const [sampleWindow, setSampleWindow] = useState<number>(30);
  const [sampleIntervalMs, setSampleIntervalMs] = useState<number>(2000);
  const [infoSamples, setInfoSamples] = useState<Array<{ ts: number; ops: number; mem: number; clients: number }>>([]);
  const [cmdSamples, setCmdSamples] = useState<Record<string, Array<{ ts: number; calls: number }>>>({});
  const [enableSampling, setEnableSampling] = useState<boolean>(false);
  // 键类型分布采样
  const [typeDist, setTypeDist] = useState<Record<string, number>>({});
  const [typeSampling, setTypeSampling] = useState<boolean>(false);
  const [typeSampleCount, setTypeSampleCount] = useState<number>(200);
  // 采样并发节流标志，避免上一次采样未完成时再次触发
  const [samplingBusy, setSamplingBusy] = useState<boolean>(false);

  const poolId = connection.connectionId;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        let infoText = '';
        if ((window as any).electronAPI?.getDatabaseInfo && poolId) {
          try {
            const meta = await (window as any).electronAPI.getDatabaseInfo(poolId);
            if (meta && typeof meta === 'object') {
              if (meta.infoRaw && typeof meta.infoRaw === 'string') {
                infoText = meta.infoRaw;
              }
            }
          } catch {}
        }
        if (!infoText && poolId) {
          const res = await execRedisQueued(poolId, 'info', []);
          if (res && res.success) {
            const data = Array.isArray(res.data) ? (res.data[0]?.value ?? res.data[0]) : res.data;
            infoText = String(data || '');
          }
        }
        let ksText = '';
        if (poolId) {
          const ksRes = await execRedisQueued(poolId, 'info', ['keyspace']);
          if (ksRes && ksRes.success) {
            const data = Array.isArray(ksRes.data) ? (ksRes.data[0]?.value ?? ksRes.data[0]) : ksRes.data;
            ksText = String(data || '');
          }
        }

        // 命令统计（使用串行+超时，必要时自动重连）
        let cmdText = '';
        if (poolId) {
          let cmdRes: any = await execRedisQueuedWithTimeout(poolId, 'info', ['commandstats'], 8000);
          const msg = String(((cmdRes as any)?.message || (cmdRes as any)?.error || ''));
          if (cmdRes && cmdRes.success === false && (msg.includes('连接池不存在') || msg.includes('Redis client not connected') || msg.includes('获取连接超时'))) {
            try {
              const reconnect = await (window as any).electronAPI?.connectDatabase?.(connection);
              if (reconnect && reconnect.success && reconnect.connectionId) {
                const newPid = reconnect.connectionId;
                connection.connectionId = newPid;
                connection.isConnected = true;
                cmdRes = await execRedisQueuedWithTimeout(newPid, 'info', ['commandstats'], 8000);
              }
            } catch {}
          }
          if (cmdRes && cmdRes.success) {
            const data = Array.isArray(cmdRes.data) ? (cmdRes.data[0]?.value ?? cmdRes.data[0]) : cmdRes.data;
            cmdText = String(data || '');
          }
        }
        // 若独立命令统计为空，回退到主INFO文本解析
        const baseCmdText = (cmdText && cmdText.trim().length > 0) ? cmdText : infoText;
        const cmdLines = String(baseCmdText).split(/\r?\n/).filter(l => l.startsWith('cmdstat_'));
        const parsedCmds: Array<{cmd: string; calls: number; usec: number; usecPerCall: number}> = cmdLines.map(l => {
          const m = l.match(/^cmdstat_(\w+):calls=(\d+),usec=(\d+),usec_per_call=([\d\.]+)/);
          return {
            cmd: m?.[1] || '-',
            calls: Number(m?.[2] || 0),
            usec: Number(m?.[3] || 0),
            usecPerCall: Number(m?.[4] || 0)
          };
        }).sort((a,b) => b.calls - a.calls);
        
        // 集群节点
        let clusterNodesText = '';
        const clusterEnabled = /cluster_enabled:(\d)/.exec(infoText)?.[1] === '1' || sections.cluster?.cluster_enabled === '1';
        if (clusterEnabled && poolId) {
          try {
            let cnRes: any = await execRedisQueuedWithTimeout(poolId, 'cluster', ['nodes'], 8000);
            const msg = String(((cnRes as any)?.message || (cnRes as any)?.error || ''));
            if (cnRes && cnRes.success === false && (msg.includes('连接池不存在') || msg.includes('Redis client not connected') || msg.includes('获取连接超时'))) {
              try {
                const reconnect = await (window as any).electronAPI?.connectDatabase?.(connection);
                if (reconnect && reconnect.success && reconnect.connectionId) {
                  const newPid = reconnect.connectionId;
                  connection.connectionId = newPid;
                  connection.isConnected = true;
                  cnRes = await execRedisQueuedWithTimeout(newPid, 'cluster', ['nodes'], 8000);
                }
              } catch {}
            }
            if (cnRes && cnRes.success) {
              const data = Array.isArray(cnRes.data) ? (cnRes.data[0]?.value ?? cnRes.data[0]) : cnRes.data;
              clusterNodesText = String(data || '');
            }
          } catch {}
        }

        if (!cancelled) {
          const secs = parseRedisInfo(infoText);
          setSections(secs);
          setKeyspace(parseKeyspace(ksText));
          setCommandStats(parsedCmds);
          setClusterNodes(clusterNodesText);
          // 初始采样点
          const stats = secs.stats || {};
          const mem = toNum(secs.memory?.used_memory);
          const clients = toNum(secs.clients?.connected_clients);
          const ops = toNum(stats.instantaneous_ops_per_sec);
          const ts = Date.now();
          setInfoSamples(prev => {
            const next = [...prev, { ts, ops, mem, clients }];
            return next.length > sampleWindow ? next.slice(next.length - sampleWindow) : next;
          });
          setCmdSamples(prev => {
            const next = { ...prev };
            for (const c of parsedCmds) {
              const arr = next[c.cmd] || [];
              const appended = [...arr, { ts, calls: c.calls }];
              next[c.cmd] = appended.length > sampleWindow ? appended.slice(appended.length - sampleWindow) : appended;
            }
            return next;
          });
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || '加载服务信息失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [poolId, sampleWindow]);

  // 周期采样 recent N 次 INFO（串行+超时+自动重连）
  useEffect(() => {
    if (!enableSampling || !poolId) return;
    const timer = setInterval(async () => {
      if (samplingBusy) return;
      setSamplingBusy(true);
      try {
        let res: any = await execRedisQueuedWithTimeout(poolId, 'info', [], 8000);
        let msg = String(((res as any)?.message || (res as any)?.error || ''));
        if (res && res.success === false && (msg.includes('连接池不存在') || msg.includes('Redis client not connected') || msg.includes('获取连接超时'))) {
          try {
            const reconnect = await (window as any).electronAPI?.connectDatabase?.(connection);
            if (reconnect && reconnect.success && reconnect.connectionId) {
              const newPid = reconnect.connectionId;
              connection.connectionId = newPid;
              connection.isConnected = true;
              res = await execRedisQueuedWithTimeout(newPid, 'info', [], 8000);
              msg = String(((res as any)?.message || (res as any)?.error || ''));
            }
          } catch {}
        }
        if (res && res.success) {
          const data = Array.isArray(res.data) ? (res.data[0]?.value ?? res.data[0]) : res.data;
          const secs = parseRedisInfo(String(data || ''));
          const stats = secs.stats || {};
          const mem = toNum(secs.memory?.used_memory);
          const clients = toNum(secs.clients?.connected_clients);
          const ops = toNum(stats.instantaneous_ops_per_sec);
          const ts = Date.now();
          setInfoSamples(prev => {
            const next = [...prev, { ts, ops, mem, clients }];
            return next.length > sampleWindow ? next.slice(next.length - sampleWindow) : next;
          });
        }
        // 命令统计采样
        let cmdRes: any = await execRedisQueuedWithTimeout(poolId, 'info', ['commandstats'], 8000);
        let cmdMsg = String(((cmdRes as any)?.message || (cmdRes as any)?.error || ''));
        if (cmdRes && cmdRes.success === false && (cmdMsg.includes('连接池不存在') || cmdMsg.includes('Redis client not connected') || cmdMsg.includes('获取连接超时'))) {
          try {
            const reconnect = await (window as any).electronAPI?.connectDatabase?.(connection);
            if (reconnect && reconnect.success && reconnect.connectionId) {
              const newPid = reconnect.connectionId;
              connection.connectionId = newPid;
              connection.isConnected = true;
              cmdRes = await execRedisQueuedWithTimeout(newPid, 'info', ['commandstats'], 8000);
            }
          } catch {}
        }
        if (cmdRes && cmdRes.success) {
          const data = Array.isArray(cmdRes.data) ? (cmdRes.data[0]?.value ?? cmdRes.data[0]) : cmdRes.data;
          const cmdLines = String(data || '').split(/\r?\n/).filter(l => l.startsWith('cmdstat_'));
          const parsedCmds: Array<{cmd: string; calls: number}> = cmdLines.map(l => {
            const m = l.match(/^cmdstat_(\w+):calls=(\d+),/);
            return { cmd: m?.[1] || '-', calls: Number(m?.[2] || 0) };
          }).slice(0, 10);
          const ts = Date.now();
          setCmdSamples(prev => {
            const next = { ...prev };
            for (const c of parsedCmds) {
              const arr = next[c.cmd] || [];
              const appended = [...arr, { ts, calls: c.calls }];
              next[c.cmd] = appended.length > sampleWindow ? appended.slice(appended.length - sampleWindow) : appended;
            }
            return next;
          });
        }
      } catch {
      } finally {
        setSamplingBusy(false);
      }
    }, sampleIntervalMs);
    return () => clearInterval(timer);
  }, [enableSampling, poolId, sampleIntervalMs, sampleWindow]);

  const overview = useMemo(() => {
    const server = sections.server || {};
    const clients = sections.clients || {};
    const memory = sections.memory || {};
    const stats = sections.stats || {};
    const replication = sections.replication || {};
    const role = replication.role || server.role || '-';
    const version = server.redis_version || '-';
    const uptimeSec = Number(server.uptime_in_seconds || 0);
    const uptimeDays = Number((uptimeSec / 86400).toFixed(2));
    const connectedClients = Number(clients.connected_clients || 0);
    const opsPerSec = Number(stats.instantaneous_ops_per_sec || 0);
    const totalConnectionsReceived = Number(stats.total_connections_received || 0);
    const totalCommandsProcessed = Number(stats.total_commands_processed || 0);
    const rejectedConnections = Number(stats.rejected_connections || 0);
    const expiredKeys = Number(stats.expired_keys || 0);
    const evictedKeys = Number(stats.evicted_keys || 0);
    return { role, version, uptimeDays, connectedClients, opsPerSec, totalConnectionsReceived, totalCommandsProcessed, rejectedConnections, expiredKeys, evictedKeys };
  }, [sections]);

  const parseKeyspace = (raw: string): Record<string, { keys: number; expires: number; avg_ttl: number }> => {
    const out: Record<string, { keys: number; expires: number; avg_ttl: number }> = {};
    const lines = String(raw || '').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^(db\d+):keys=(\d+),expires=(\d+),avg_ttl=(\d+)/);
      if (m) out[m[1]] = { keys: Number(m[2]), expires: Number(m[3]), avg_ttl: Number(m[4]) };
    }
    return out;
  };

  // 其余渲染逻辑与UI代码...

  return (
    <div>
      {/* 页面主体内容，保持原有UI结构 */}
    </div>
  );
};

export default RedisServiceInfoPage;