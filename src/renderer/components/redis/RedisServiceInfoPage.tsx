import React, { useEffect, useMemo, useState } from 'react';
import { Card, Descriptions, Statistic, Row, Col, Tag, Space, Alert, Spin, Divider, Tabs, Progress, InputNumber, Select, Switch, Button, Typography, Table, Input, Dropdown, Menu } from 'antd';
import { Line, Pie, Column, Area, DualAxes } from '@ant-design/plots';
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
const fmtTime = (t: number) => {
  const d = new Date(Number(t || 0));
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const HH = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
};
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
  const [infoSamples, setInfoSamples] = useState<Array<{ ts: number; ops: number; mem: number; memRss?: number; memPeak?: number; memDataset?: number; memLua?: number; clients: number; newConnsRate?: number; blocked?: number; netInKBps?: number; netOutKBps?: number }>>([]);
  const [cmdSamples, setCmdSamples] = useState<Record<string, Array<{ ts: number; calls: number; usec?: number; upc?: number }>>>({});
  const MAX_HISTORY_MS = 24 * 60 * 60 * 1000;
  const [enableSampling, setEnableSampling] = useState<boolean>(true);
  // 键类型分布采样
  const [typeDist, setTypeDist] = useState<Record<string, number>>({});
  const [typeSampling, setTypeSampling] = useState<boolean>(false);
  const [typeSampleCount, setTypeSampleCount] = useState<number>(200);
  // 采样并发节流标志，避免上一次采样未完成时再次触发
  const [samplingBusy, setSamplingBusy] = useState<boolean>(false);
  // 新增：派生OPS计算的最近值
  const [lastTotalCmds, setLastTotalCmds] = useState<number | null>(null);
  const [lastOpsTs, setLastOpsTs] = useState<number | null>(null);
  // 新增：派生新建连接速率计算的最近值
  const [lastTotalConns, setLastTotalConns] = useState<number | null>(null);
  const [lastConnTs, setLastConnTs] = useState<number | null>(null);
  // 新增：网络IO派生速率最近值
  const [lastTotalNetInBytes, setLastTotalNetInBytes] = useState<number | null>(null);
  const [lastNetInTs, setLastNetInTs] = useState<number | null>(null);
  const [lastTotalNetOutBytes, setLastTotalNetOutBytes] = useState<number | null>(null);
  const [lastNetOutTs, setLastNetOutTs] = useState<number | null>(null);
  // 新增：网络单位切换（KB/s ↔ MB/s）
  const [netUnit, setNetUnit] = useState<'KBps'|'MBps'>('KBps');
  // 新增：内存趋势多序列选择
  const [enabledMemSeries, setEnabledMemSeries] = useState<Array<'used'|'rss'|'peak'|'dataset'|'lua'>>(['used','rss','peak']);
  // 新增：最近N分钟窗口选择
  const [windowMinutes, setWindowMinutes] = useState<number>(2);
  // 根据分钟与采样间隔，派生样本窗口
  useEffect(() => {
    const count = Math.max(5, Math.round((windowMinutes * 60000) / sampleIntervalMs));
    setSampleWindow(count);
  }, [windowMinutes, sampleIntervalMs]);
  
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
        const parsedCmds: Array<{cmd: string; calls: number; usec: number; usecPerCall: number}> = cmdLines
          .map(l => l.match(/^cmdstat_(\w+):calls=(\d+),usec=(\d+),usec_per_call=([\d\.]+)/))
          .filter((m): m is RegExpMatchArray => !!m)
          .map(m => ({
            cmd: m[1],
            calls: Number(m[2]),
            usec: Number(m[3]),
            usecPerCall: Number(m[4])
          }))
          .sort((a,b) => b.calls - a.calls);
        
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
          const totalCmds = toNum(stats.total_commands_processed);
          const derivedOps = (lastTotalCmds != null && lastOpsTs != null && ts > lastOpsTs) ? Number(((totalCmds - lastTotalCmds) / ((ts - lastOpsTs) / 1000)).toFixed(2)) : 0;
          const opsFinal = ops > 0 ? ops : derivedOps;
          const totalConns = toNum(stats.total_connections_received);
          const derivedNewConns = (lastTotalConns != null && lastConnTs != null && ts > lastConnTs) ? Number(((totalConns - lastTotalConns) / ((ts - lastConnTs) / 1000)).toFixed(2)) : 0;
          const blocked = toNum(secs.clients?.blocked_clients);
          // 网络IO速率：instantaneous_* 优先，否则 total_* 差分
          const instInKBps = toNum(stats.instantaneous_input_kbps);
          const instOutKBps = toNum(stats.instantaneous_output_kbps);
          const totalNetInBytes = toNum(stats.total_net_input_bytes);
          const totalNetOutBytes = toNum(stats.total_net_output_bytes);
          const derivedInKBps = (lastTotalNetInBytes != null && lastNetInTs != null && ts > lastNetInTs) ? Number((((totalNetInBytes - lastTotalNetInBytes) / ((ts - lastNetInTs) / 1000)) / 1024).toFixed(2)) : 0;
          const derivedOutKBps = (lastTotalNetOutBytes != null && lastNetOutTs != null && ts > lastNetOutTs) ? Number((((totalNetOutBytes - lastTotalNetOutBytes) / ((ts - lastNetOutTs) / 1000)) / 1024).toFixed(2)) : 0;
          const inKBpsFinal = instInKBps > 0 ? instInKBps : derivedInKBps;
          const outKBpsFinal = instOutKBps > 0 ? instOutKBps : derivedOutKBps;
          setInfoSamples(prev => {
            const memRss = toNum(secs.memory?.used_memory_rss);
            const memPeak = toNum(secs.memory?.used_memory_peak);
            const memDataset = toNum(secs.memory?.used_memory_dataset);
            const memLua = toNum(secs.memory?.used_memory_lua);
            const next = [...prev, { ts, ops: opsFinal, mem, memRss, memPeak, memDataset, memLua, clients, newConnsRate: derivedNewConns, blocked, netInKBps: inKBpsFinal, netOutKBps: outKBpsFinal }];
            const cutoff = ts - MAX_HISTORY_MS;
            const byTime = next.filter(item => Number(item.ts) >= cutoff);
            const maxSamples = Math.max(5, Math.ceil(MAX_HISTORY_MS / Math.max(1, sampleIntervalMs)));
            return byTime.length > maxSamples ? byTime.slice(byTime.length - maxSamples) : byTime;
          });
          setLastTotalCmds(totalCmds);
          setLastOpsTs(ts);
          setLastTotalConns(totalConns);
          setLastConnTs(ts);
          // 新增：记录最近网络IO累计与时间戳
          setLastTotalNetInBytes(totalNetInBytes);
          setLastNetInTs(ts);
          setLastTotalNetOutBytes(totalNetOutBytes);
          setLastNetOutTs(ts);
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
          const totalCmds = toNum(stats.total_commands_processed);
          const derivedOps = (lastTotalCmds != null && lastOpsTs != null && ts > lastOpsTs) ? Number(((totalCmds - lastTotalCmds) / ((ts - lastOpsTs) / 1000)).toFixed(2)) : 0;
          const opsFinal = ops > 0 ? ops : derivedOps;
          const totalConns = toNum(stats.total_connections_received);
          const derivedNewConns = (lastTotalConns != null && lastConnTs != null && ts > lastConnTs) ? Number(((totalConns - lastTotalConns) / ((ts - lastConnTs) / 1000)).toFixed(2)) : 0;
          const blocked = toNum(secs.clients?.blocked_clients);
          // 网络IO速率：instantaneous_* 优先，否则 total_* 差分
          const instInKBps2 = toNum(stats.instantaneous_input_kbps);
          const instOutKBps2 = toNum(stats.instantaneous_output_kbps);
          const totalNetInBytes2 = toNum(stats.total_net_input_bytes);
          const totalNetOutBytes2 = toNum(stats.total_net_output_bytes);
          const derivedInKBps2 = (lastTotalNetInBytes != null && lastNetInTs != null && ts > lastNetInTs) ? Number((((totalNetInBytes2 - lastTotalNetInBytes) / ((ts - lastNetInTs) / 1000)) / 1024).toFixed(2)) : 0;
          const derivedOutKBps2 = (lastTotalNetOutBytes != null && lastNetOutTs != null && ts > lastNetOutTs) ? Number((((totalNetOutBytes2 - lastTotalNetOutBytes) / ((ts - lastNetOutTs) / 1000)) / 1024).toFixed(2)) : 0;
          const inKBpsFinal2 = instInKBps2 > 0 ? instInKBps2 : derivedInKBps2;
          const outKBpsFinal2 = instOutKBps2 > 0 ? instOutKBps2 : derivedOutKBps2;
          setInfoSamples(prev => {
            const memRss2 = toNum(secs.memory?.used_memory_rss);
            const memPeak2 = toNum(secs.memory?.used_memory_peak);
            const memDataset2 = toNum(secs.memory?.used_memory_dataset);
            const memLua2 = toNum(secs.memory?.used_memory_lua);
            const next = [...prev, { ts, ops: opsFinal, mem, memRss: memRss2, memPeak: memPeak2, memDataset: memDataset2, memLua: memLua2, clients, newConnsRate: derivedNewConns, blocked, netInKBps: inKBpsFinal2, netOutKBps: outKBpsFinal2 }];
            const cutoff = ts - MAX_HISTORY_MS;
            const byTime = next.filter(item => Number(item.ts) >= cutoff);
            const maxSamples = Math.max(5, Math.ceil(MAX_HISTORY_MS / Math.max(1, sampleIntervalMs)));
            return byTime.length > maxSamples ? byTime.slice(byTime.length - maxSamples) : byTime;
          });
          setLastTotalCmds(totalCmds);
          setLastOpsTs(ts);
          // 记录最近网络IO累计与时间戳
          setLastTotalNetInBytes(totalNetInBytes2);
          setLastNetInTs(ts);
          setLastTotalNetOutBytes(totalNetOutBytes2);
          setLastNetOutTs(ts);
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
          const parsedCmds: Array<{cmd: string; calls: number; usec: number; upc: number}> = cmdLines.map(l => {
            const m = l.match(/^cmdstat_(\w+):calls=(\d+),usec=(\d+),usec_per_call=([\d\.]+)/);
            return { cmd: m?.[1] || '-', calls: Number(m?.[2] || 0), usec: Number(m?.[3] || 0), upc: Number(m?.[4] || 0) };
          }).slice(0, 50);
          const ts = Date.now();
          setCmdSamples(prev => {
            const next = { ...prev };
            for (const c of parsedCmds) {
              const arr = next[c.cmd] || [];
              const appended = [...arr, { ts, calls: c.calls, usec: c.usec, upc: c.upc }];
              const cutoff = ts - MAX_HISTORY_MS;
              const byTime = appended.filter(it => Number(it.ts) >= cutoff);
              const maxSamples = Math.max(5, Math.ceil(MAX_HISTORY_MS / Math.max(1, sampleIntervalMs)));
              next[c.cmd] = byTime.length > maxSamples ? byTime.slice(byTime.length - maxSamples) : byTime;
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

// 新增：系统与内存概览
  const systemInfo = useMemo(() => {
    const server = sections.server || {};
    return {
      os: server.os || '-',
      arch: (server.arch_bits ? `${server.arch_bits}bit` : '-') ,
      hz: Number(server.hz || 0),
      processId: server.process_id || '-',
      tcpPort: server.tcp_port || '-',
      configFile: server.config_file || '-',
      runId: server.run_id || '-',
      executable: server.executable || '-',
    };
  }, [sections]);

  const memoryInfo = useMemo(() => {
    const memory = sections.memory || {};
    const used = Number(memory.used_memory || 0);
    const rss = Number(memory.used_memory_rss || 0);
    const peak = Number(memory.used_memory_peak || 0);
    const total = Number(memory.total_system_memory || 0);
    const max = Number(memory.maxmemory || 0);
    const frag = Number(memory.mem_fragmentation_ratio || 0);
    return {
      usedMB: bytesToMB(used),
      rssMB: bytesToMB(rss),
      peakMB: bytesToMB(peak),
      totalGB: bytesTo(total, 'GB'),
      maxMB: bytesTo(max, 'MB'),
      fragRatio: frag,
      allocator: memory.allocator || '-',
      datasetMB: bytesToMB(Number(memory.used_memory_dataset || 0)),
      luaMB: bytesToMB(Number(memory.used_memory_lua || 0)),
    };
  }, [sections]);


// 键类型分布饼图
  const typePieConfig: any = {
    data: Object.entries(typeDist).map(([type, count]) => ({ type, count })),
    angleField: 'count',
    colorField: 'type',
    radius: 0.9,
    label: { type: 'outer', content: '{name} {percentage}' },
    legend: { position: 'right' },
  };

// 新增：键类型分布采样逻辑
  useEffect(() => {
    if (!typeSampling || !poolId) return;
    let cancelled = false;
    (async () => {
      try {
        setTypeDist({});
        let cursor = '0';
        let remaining = Math.max(10, Math.min(2000, typeSampleCount));
        const batchCount = 100;
        while (!cancelled && remaining > 0) {
          const params = [cursor, 'MATCH', '*', 'COUNT', String(Math.min(batchCount, remaining * 2))];
          const res: any = await execRedisQueuedWithTimeout(poolId, 'scan', params, 8000);
          if (!res || !res.success) break;
          const data = res.data;
          let nextCursor: string = '0';
          let keys: any[] = [];
          if (Array.isArray(data) && data.length >= 2) {
            nextCursor = String(data[0]);
            keys = Array.isArray(data[1]) ? data[1] : [];
          } else if (data && typeof data === 'object' && 'cursor' in data && 'keys' in data) {
            nextCursor = String((data as any).cursor);
            keys = Array.isArray((data as any).keys) ? (data as any).keys : [];
          }
          cursor = nextCursor;
          const keysNorm: string[] = (keys || []).map(k => String(k));
          const sampleKeys = keysNorm.slice(0, Math.min(keysNorm.length, remaining));
          if (sampleKeys.length === 0 && cursor === '0') break;
          // 并发限制到10
          const CONC = 10;
          for (let i = 0; i < sampleKeys.length; i += CONC) {
            const slice = sampleKeys.slice(i, i + CONC);
            const updates: Record<string, number> = {};
            await Promise.all(slice.map(async (key) => {
              try {
                const tRes: any = await execRedisQueuedWithTimeout(poolId, 'type', [key], 8000);
                const t = (tRes && tRes.success) ? String(tRes.data || 'unknown') : 'unknown';
                const type = t.toUpperCase();
                updates[type] = (updates[type] || 0) + 1;
              } catch {
                updates['UNK'] = (updates['UNK'] || 0) + 1;
              }
            }));
            setTypeDist(prev => {
              const next = { ...prev };
              for (const k of Object.keys(updates)) {
                next[k] = (next[k] || 0) + updates[k];
              }
              return next;
            });
          }
          remaining -= sampleKeys.length;
          if (cursor === '0') break;
          // 轻微节流，避免阻塞UI
          await new Promise(r => setTimeout(r, 50));
        }
      } finally {
        if (!cancelled) setTypeSampling(false);
      }
    })();
    return () => { cancelled = true; };
  }, [typeSampling, typeSampleCount, poolId]);

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

  const columnsCommandStats = [
    { title: '命令', dataIndex: 'cmd', key: 'cmd', width: 140 },
    { title: '调用次数', dataIndex: 'calls', key: 'calls', width: 120 },
    { title: '总耗时(μs)', dataIndex: 'usec', key: 'usec', width: 140 },
    { title: '单次耗时(μs)', dataIndex: 'usecPerCall', key: 'usecPerCall', width: 140 },
    { title: '窗口调用数', dataIndex: 'windowCalls', key: 'windowCalls', width: 120 },
    { title: '窗口平均耗时(μs/次)', dataIndex: 'windowUsecPerCall', key: 'windowUsecPerCall', width: 160 },
    { title: '窗口调用速率(次/s)', dataIndex: 'windowRate', key: 'windowRate', width: 160 }
  ];

  // 命令统计排序与视图模式
  const [commandSortKey, setCommandSortKey] = useState<'calls'|'usec'|'usecPerCall'|'windowCalls'|'windowUsecPerCall'|'windowRate'>('usecPerCall');
  const [commandSortOrder, setCommandSortOrder] = useState<'desc'|'asc'>('desc');
  const [cmdViewMode, setCmdViewMode] = useState<'current'|'window'>('current');
  const [topN, setTopN] = useState<number>(10);

  // 趋势图数据（ops/memMB/clients）
  const [showAvg, setShowAvg] = useState<boolean>(true);
  // 固定展示窗口与下采样配置：30秒间隔，最多1小时
  const DISPLAY_INTERVAL_MS = 30 * 1000;
  const DISPLAY_WINDOW_MS = 60 * 60 * 1000;
  const displaySamples = useMemo(() => {
    const nowTs = infoSamples.length ? Number(infoSamples[infoSamples.length - 1].ts) : Date.now();
    const cutoff = nowTs - DISPLAY_WINDOW_MS;
    const filtered = infoSamples.filter(s => Number(s.ts) >= cutoff);
    const seen = new Set<number>();
    const out: typeof filtered = [];
    for (const s of filtered) {
      const bucket = Math.floor(Number(s.ts) / DISPLAY_INTERVAL_MS);
      if (!seen.has(bucket)) { seen.add(bucket); out.push(s); }
    }
    return out;
  }, [infoSamples]);
  // DualAxes 数据：左轴(ops/clients/clients_avg/conn_rate/blocked)，右轴(memMB)
  const leftSeries = useMemo(() => {
    const out: Array<{ ts: number; tsFmt: string; name: string; value: number }> = [];
    const window = Math.min(5, Math.max(1, Math.floor(sampleWindow / 6))); // 简短移动平均窗口
    for (let i = 0; i < displaySamples.length; i++) {
      const s = displaySamples[i];
      const tsFmt = fmtTime(Number(s.ts));
      out.push({ ts: s.ts, tsFmt, name: 'ops', value: s.ops });
      out.push({ ts: s.ts, tsFmt, name: 'clients', value: s.clients });
      if (typeof s.newConnsRate === 'number') {
        out.push({ ts: s.ts, tsFmt, name: 'conn_rate', value: s.newConnsRate });
      }
      if (typeof s.blocked === 'number') {
        out.push({ ts: s.ts, tsFmt, name: 'blocked_clients', value: s.blocked });
      }
      // 移动平均线（可选）
      const start = Math.max(0, i - window + 1);
      const slice = displaySamples.slice(start, i + 1);
      const avgClients = slice.reduce((a, b) => a + b.clients, 0) / slice.length;
      if (showAvg) {
        out.push({ ts: s.ts, tsFmt, name: 'clients_avg', value: Number(avgClients.toFixed(2)) });
        const avgOps = slice.reduce((a, b) => a + b.ops, 0) / slice.length;
        out.push({ ts: s.ts, tsFmt, name: 'ops_avg', value: Number(avgOps.toFixed(2)) });
        const avgRate = slice.reduce((a, b) => a + (Number(b.newConnsRate || 0)), 0) / slice.length;
        out.push({ ts: s.ts, tsFmt, name: 'conn_rate_avg', value: Number(avgRate.toFixed(2)) });
      }
    }
    return out;
  }, [displaySamples, sampleWindow, showAvg]);
  const rightSeries = useMemo(() => displaySamples.map(s => ({ ts: s.ts, tsFmt: fmtTime(Number(s.ts)), name: 'memMB', value: bytesToMB(s.mem) })), [displaySamples]);

  const dualAxesConfig: any = {
    data: [leftSeries, rightSeries],
    xField: 'tsFmt',
    yField: ['value', 'value'],
    geometryOptions: [
      { geometry: 'line', smooth: true, seriesField: 'name', point: { size: 2, shape: 'circle', style: { opacity: 0.8 } } },
      { geometry: 'line', smooth: true, seriesField: 'name', point: { size: 2, shape: 'circle', style: { opacity: 0.8 } } }
    ],
    height: 240,
    xAxis: { type: 'timeCat', tickCount: 6, label: { autoRotate: false, autoHide: false, autoEllipsis: false } },
    legend: { position: 'top', itemName: { formatter: (text: string) => toZh(text) } },
    tooltip: { shared: true, showMarkers: true, formatter: (datum: any) => ({ name: toZh(datum.name), value: Number(datum.value).toFixed(2) }) },
    slider: { start: 0, end: 1 },
  };

  // 指标中文映射
  const zhNameMap: Record<string, string> = {
    ops: '每秒操作数',
    clients: '客户端连接数',
    conn_rate: '新连接速率(次/秒)',
    blocked_clients: '阻塞客户端',
    clients_avg: '客户端连接平均',
    ops_avg: 'OPS平均',
    conn_rate_avg: '新连接速率平均',
    memMB: '内存(MB)',
    usedMB: '内存使用(MB)',
    rssMB: 'RSS内存(MB)',
    peakMB: '内存峰值(MB)',
    datasetMB: '数据集内存(MB)',
    luaMB: 'Lua内存(MB)',
    net_in_kbps: '网络入流(KB/s)',
    net_out_kbps: '网络出流(KB/s)',
    net_in_mbps: '网络入流(MB/s)',
    net_out_mbps: '网络出流(MB/s)',
  };
  const toZh = (name: string) => zhNameMap[name] || name;

  // 新增：客户端与OPS单独趋势图配置
  const clientsLineConfig: any = {
    data: displaySamples.map(s => ({ ts: s.ts, tsFmt: fmtTime(Number(s.ts)), value: s.clients })),
    xField: 'tsFmt',
    yField: 'value',
    height: 200,
    smooth: true,
    xAxis: { type: 'timeCat', tickCount: 6, label: { autoRotate: false, autoHide: false, autoEllipsis: false } },
    point: { size: 2 },
    tooltip: { showMarkers: true, formatter: (datum: any) => ({ name: toZh('clients'), value: Number(datum.value).toFixed(2) }) },
    slider: { start: 0, end: 1 },
  };

  const opsLineConfig: any = {
    data: displaySamples.map(s => ({ ts: s.ts, tsFmt: fmtTime(Number(s.ts)), value: s.ops })),
    xField: 'tsFmt',
    yField: 'value',
    height: 200,
    smooth: true,
    xAxis: { type: 'timeCat', tickCount: 6, label: { autoRotate: false, autoHide: false, autoEllipsis: false } },
    point: { size: 2 },
    tooltip: { showMarkers: true, formatter: (datum: any) => ({ name: toZh('ops'), value: Number(datum.value).toFixed(2) }) },
    slider: { start: 0, end: 1 },
  };

  const newConnsLineConfig: any = {
    data: displaySamples.map(s => ({ ts: s.ts, tsFmt: fmtTime(Number(s.ts)), value: s.newConnsRate || 0 })),
    xField: 'tsFmt',
    yField: 'value',
    height: 200,
    smooth: true,
    xAxis: { type: 'timeCat', tickCount: 6, label: { autoRotate: false, autoHide: false, autoEllipsis: false } },
    point: { size: 2 },
    tooltip: { showMarkers: true, formatter: (datum: any) => ({ name: toZh('conn_rate'), value: Number(datum.value).toFixed(2) }) },
    slider: { start: 0, end: 1 },
  };

  const blockedLineConfig: any = {
    data: displaySamples.map(s => ({ ts: s.ts, tsFmt: fmtTime(Number(s.ts)), value: s.blocked || 0 })),
    xField: 'tsFmt',
    yField: 'value',
    height: 200,
    smooth: true,
    xAxis: { type: 'timeCat', tickCount: 6, label: { autoRotate: false, autoHide: false, autoEllipsis: false } },
    point: { size: 2 },
    tooltip: { showMarkers: true, formatter: (datum: any) => ({ name: toZh('blocked_clients'), value: Number(datum.value).toFixed(2) }) },
    slider: { start: 0, end: 1 },
  };

  // 内存与网络IO趋势配置

  const memColorMap: Record<string, string> = {
    usedMB: '#1890ff',
    rssMB: '#52c41a',
    peakMB: '#fa8c16',
    datasetMB: '#722ed1',
    luaMB: '#f5222d',
  };

  const memLineConfig: any = {
    data: displaySamples.flatMap(s => {
      const all: Array<{ ts: number; tsFmt: string; name: string; value: number }> = [];
      const tsFmt = fmtTime(Number(s.ts));
      const pushIf = (key: 'used'|'rss'|'peak'|'dataset'|'lua', name: string, v?: number) => {
        if (!enabledMemSeries.includes(key)) return;
        const val = Number(v || 0);
        all.push({ ts: s.ts, tsFmt, name, value: bytesToMB(val) });
      };
      pushIf('used', 'usedMB', s.mem);
      pushIf('rss', 'rssMB', s.memRss);
      pushIf('peak', 'peakMB', s.memPeak);
      pushIf('dataset', 'datasetMB', s.memDataset);
      pushIf('lua', 'luaMB', s.memLua);
      return all;
    }),
    xField: 'tsFmt',
    yField: 'value',
    seriesField: 'name',
    color: (datum: any) => memColorMap[datum.name] || '#888',
    height: 200,
    smooth: true,
    xAxis: { type: 'timeCat', tickCount: 6, label: { autoRotate: false, autoHide: false, autoEllipsis: false } },
    point: { size: 2 },
    legend: { position: 'top', itemName: { formatter: (text: string) => toZh(text) } },
    tooltip: { shared: true, showMarkers: true, formatter: (datum: any) => ({ name: `${toZh(datum.name)} @ ${fmtTime(Number(datum.ts))}` , value: Number(datum.value).toFixed(2) }) },
    slider: { start: 0, end: 1 },
  };
  const netLineConfig: any = {
    data: displaySamples.flatMap(s => {
      const arr: Array<{ ts: number; tsFmt: string; name: string; value: number }> = [];
      const tsFmt = fmtTime(Number(s.ts));
      const inValKB = Number(s.netInKBps || 0);
      const outValKB = Number(s.netOutKBps || 0);
      const toVal = (kb: number) => netUnit === 'KBps' ? kb : Number((kb / 1024).toFixed(2));
      const nameIn = netUnit === 'KBps' ? 'net_in_kbps' : 'net_in_mbps';
      const nameOut = netUnit === 'KBps' ? 'net_out_kbps' : 'net_out_mbps';
      if (!isNaN(inValKB)) arr.push({ ts: s.ts, tsFmt, name: nameIn, value: toVal(inValKB) });
      if (!isNaN(outValKB)) arr.push({ ts: s.ts, tsFmt, name: nameOut, value: toVal(outValKB) });
      return arr;
    }),
    xField: 'tsFmt',
    yField: 'value',
    seriesField: 'name',
    height: 200,
    smooth: true,
    xAxis: { type: 'timeCat', tickCount: 6, label: { autoRotate: false, autoHide: false, autoEllipsis: false } },
    point: { size: 2 },
    legend: { position: 'top', itemName: { formatter: (text: string) => toZh(text) } },
    tooltip: { shared: true, showMarkers: true, formatter: (datum: any) => ({ name: `${toZh(datum.name)} @ ${fmtTime(Number(datum.ts))}` , value: Number(datum.value).toFixed(2) }) },
    slider: { start: 0, end: 1 },
  };

  // 选择时间窗口数据源：当前INFO或采样窗口
  const displayCommandStats = useMemo(() => {
    if (cmdViewMode === 'current') {
      const arr = commandStats.map(c => ({ ...c, windowCalls: undefined as any }));
      const sortKey = commandSortKey === 'windowCalls' ? 'usecPerCall' : commandSortKey;
      arr.sort((a:any,b:any) => {
        const av = Number(a[sortKey] || 0);
        const bv = Number(b[sortKey] || 0);
        return commandSortOrder === 'desc' ? (bv - av) : (av - bv);
      });
      return arr.slice(0, Math.max(1, topN || 10));
    }
    // 采样窗口：用最后一次与第一次的calls差值作为窗口调用数
    const firstLast: Record<string, { first?: number; last?: number }> = {};
    Object.keys(cmdSamples).forEach(cmd => {
      const arr = cmdSamples[cmd] || [];
      if (arr.length > 0) {
        firstLast[cmd] = { first: arr[0].calls, last: arr[arr.length - 1].calls };
      }
    });
    const merged = commandStats.map(c => {
      const arr = cmdSamples[c.cmd] || [];
      const first = arr[0];
      const last = arr[arr.length - 1];
      const windowCalls = Math.max(0, Number((last?.calls ?? 0) - (first?.calls ?? 0)));
      const windowUsec = Math.max(0, Number((last?.usec ?? 0) - (first?.usec ?? 0)));
      const windowUsecPerCall = windowCalls > 0 ? Number((windowUsec / windowCalls).toFixed(2)) : Number((last?.upc ?? 0));
      const elapsedSec = Math.max(1, ((last?.ts ?? 0) - (first?.ts ?? 0)) / 1000);
      const windowRate = Number((windowCalls / elapsedSec).toFixed(2));
      return { ...c, windowCalls, windowUsecPerCall, windowRate };
    });
    merged.sort((a:any,b:any) => {
      const key = ['windowCalls','windowUsecPerCall','windowRate'].includes(commandSortKey) ? commandSortKey : commandSortKey;
      const av = Number(a[key] || 0);
      const bv = Number(b[key] || 0);
      return commandSortOrder === 'desc' ? (bv - av) : (av - bv);
    });
    return merged.slice(0, Math.max(1, topN || 10));
  }, [commandStats, cmdSamples, cmdViewMode, commandSortKey, commandSortOrder, topN]);

  return (
    <div style={{ padding: 12, height: 'calc(100vh - 180px)', overflow: 'auto' }}>
      {loading && (<Spin tip="加载服务信息..." />)}
      {!loading && error && (<Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />)}
      {!loading && !error && (
        <>
          <Card title="概览" style={{ marginBottom: 12 }}>
            <Row gutter={16}>
              <Col span={6}><Statistic title="角色" value={overview.role} /></Col>
              <Col span={6}><Statistic title="版本" value={overview.version} /></Col>
              <Col span={6}><Statistic title="运行天数" value={overview.uptimeDays} /></Col>
              <Col span={6}><Statistic title="连接客户端" value={overview.connectedClients} /></Col>
            </Row>
            <Divider style={{ margin: '12px 0' }} />
            <Row gutter={16}>
              <Col span={6}><Statistic title="每秒操作数" value={overview.opsPerSec} /></Col>
              <Col span={6}><Statistic title="总连接次数" value={overview.totalConnectionsReceived} /></Col>
              <Col span={6}><Statistic title="总命令数" value={overview.totalCommandsProcessed} /></Col>
              <Col span={6}><Statistic title="拒绝连接" value={overview.rejectedConnections} /></Col>
            </Row>
          </Card>

          {/* 新增：系统信息 */}
          <Card title="系统信息" style={{ marginBottom: 12 }}>
            <Descriptions column={3} size="small">
              <Descriptions.Item label="OS">{systemInfo.os}</Descriptions.Item>
              <Descriptions.Item label="Arch">{systemInfo.arch}</Descriptions.Item>
              <Descriptions.Item label="Hz">{systemInfo.hz}</Descriptions.Item>
              <Descriptions.Item label="PID">{systemInfo.processId}</Descriptions.Item>
              <Descriptions.Item label="端口">{systemInfo.tcpPort}</Descriptions.Item>
              <Descriptions.Item label="配置文件">{systemInfo.configFile}</Descriptions.Item>
              <Descriptions.Item label="RunID">{systemInfo.runId}</Descriptions.Item>
              <Descriptions.Item label="可执行文件">{systemInfo.executable}</Descriptions.Item>
            </Descriptions>
          </Card>

          {/* 新增：内存占用 */}
          <Card title="内存占用" style={{ marginBottom: 12 }}>
            <Row gutter={16}>
              <Col span={6}><Statistic title="Used(MB)" value={memoryInfo.usedMB} /></Col>
              <Col span={6}><Statistic title="RSS(MB)" value={memoryInfo.rssMB} /></Col>
              <Col span={6}><Statistic title="Peak(MB)" value={memoryInfo.peakMB} /></Col>
              <Col span={6}><Statistic title="Dataset(MB)" value={memoryInfo.datasetMB} /></Col>
            </Row>
            <Divider style={{ margin: '12px 0' }} />
            <Row gutter={16}>
              <Col span={12}>
                <Typography.Text type="secondary">maxmemory 使用率</Typography.Text>
                <Progress percent={Number((((memoryInfo.maxMB > 0 ? (memoryInfo.usedMB / memoryInfo.maxMB) : (memoryInfo.totalGB > 0 ? (memoryInfo.usedMB / (memoryInfo.totalGB * 1024)) : 0)) * 100).toFixed(1)))} status={memoryInfo.maxMB > 0 ? 'active' : 'normal'} />
                <Space>
                  <Tag color="blue">max={memoryInfo.maxMB > 0 ? `${memoryInfo.maxMB}MB` : '未设置'}</Tag>
                  <Tag color="geekblue">total={memoryInfo.totalGB}GB</Tag>
                  <Tag color="purple">allocator={memoryInfo.allocator}</Tag>
                </Space>
              </Col>
              <Col span={12}>
                <Typography.Text type="secondary">碎片率</Typography.Text>
                <Progress percent={Number((memoryInfo.fragRatio * 100).toFixed(1))} status="active" />
              </Col>
            </Row>
          </Card>


          {/* 新增：客户端连接趋势 */}
          <Card title="客户端连接趋势" style={{ marginBottom: 12 }}>
            {infoSamples.length === 0 ? (
              <Typography.Text type="secondary">暂无采样数据，已启用采样或等待首次加载</Typography.Text>
            ) : (
              <Line {...clientsLineConfig} />
            )}
          </Card>

          {/* 新增：OPS趋势 */}
          <Card title="OPS 趋势 (instantaneous_ops_per_sec)" style={{ marginBottom: 12 }}>
            {infoSamples.length === 0 ? (
              <Typography.Text type="secondary">暂无采样数据</Typography.Text>
            ) : (
              <Line {...opsLineConfig} />
            )}
          </Card>

          {/* 新增：新建连接速率趋势（估算，每秒） */}
          <Card title="新建连接速率趋势（估算，每秒）" style={{ marginBottom: 12 }}>
            {infoSamples.length === 0 ? (
              <Typography.Text type="secondary">暂无采样数据</Typography.Text>
            ) : (
              <Line {...newConnsLineConfig} />
            )}
          </Card>

          {/* 新增：阻塞客户端数趋势 */}
          <Card title="阻塞客户端数趋势" style={{ marginBottom: 12 }}>
            {infoSamples.length === 0 ? (
              <Typography.Text type="secondary">暂无采样数据</Typography.Text>
            ) : (
              <Line {...blockedLineConfig} />
            )}
          </Card>

          {/* 新增：内存使用趋势（MB，多序列可选） */}
          <Card title="内存使用趋势（MB，多序列可选）" style={{ marginBottom: 12 }} extra={(
            <Space>
              <span>序列</span>
              <Select
                size="small"
                mode="multiple"
                value={enabledMemSeries}
                onChange={(vals) => setEnabledMemSeries(vals as any)}
                style={{ minWidth: 180 }}
                options={[
                  { value: 'used', label: 'usedMB' },
                  { value: 'rss', label: 'rssMB' },
                  { value: 'peak', label: 'peakMB' },
                  { value: 'dataset', label: 'datasetMB' },
                  { value: 'lua', label: 'luaMB' },
                ]}
              />
            </Space>
          )}>
            {infoSamples.length === 0 ? (
              <Typography.Text type="secondary">暂无采样数据</Typography.Text>
            ) : (
              <Line {...memLineConfig} />
            )}
          </Card>

          {/* 新增：网络输入输出趋势 */}
          <Card title={`网络输入输出趋势（${netUnit === 'KBps' ? 'KB/s' : 'MB/s'}）`} style={{ marginBottom: 12 }} extra={(
            <Space>
              <span>单位</span>
              <Select
                size="small"
                value={netUnit}
                onChange={(v) => setNetUnit(v as any)}
                options={[{ value: 'KBps', label: 'KB/s' }, { value: 'MBps', label: 'MB/s' }]}
                style={{ width: 100 }}
              />
            </Space>
          )}>
            {infoSamples.length === 0 ? (
              <Typography.Text type="secondary">暂无采样数据</Typography.Text>
            ) : (
              <Line {...netLineConfig} />
            )}
          </Card>

          <Card title="键空间" style={{ marginBottom: 12 }}>
            <Space wrap>
              {Object.entries(keyspace).length === 0 && (<Typography.Text type="secondary">暂无键空间信息</Typography.Text>)}
              {Object.entries(keyspace).map(([db, ks]) => {
                const getColor = (n: number) => n >= 5000 ? 'red' : n >= 1000 ? 'orange' : 'green';
                const menu = (
                  <Menu>
                    <Menu.Item key="open" onClick={() => (window as any).__openRedisDbTab?.(db)}>在新标签打开</Menu.Item>
                    <Menu.Item key="locate" onClick={() => (window as any).__locateRedisDbInSidebar?.(db)}>在侧边栏定位</Menu.Item>
                  </Menu>
                );
                return (
                  <Dropdown overlay={menu} trigger={["contextMenu"]} key={db}>
                    <Tag color={getColor(ks.keys)} style={{ cursor: 'pointer' }} onClick={() => (window as any).__openRedisDbTab?.(db)}>
                      {db}: keys={ks.keys}, expires={ks.expires}, avg_ttl={ks.avg_ttl}
                    </Tag>
                  </Dropdown>
                );
              })}
            </Space>
          </Card>

          <Card title="命令统计" extra={
            <Space>
              <Select size="small" value={cmdViewMode} onChange={(v) => setCmdViewMode(v)} style={{ width: 120 }}>
                <Select.Option value="current">当前INFO</Select.Option>
                <Select.Option value="window">采样窗口</Select.Option>
              </Select>
              <Select size="small" value={commandSortKey} onChange={(v) => setCommandSortKey(v)} style={{ width: 160 }}>
                <Select.Option value="usecPerCall">latency(μs/次)</Select.Option>
                <Select.Option value="calls">调用次数</Select.Option>
                <Select.Option value="usec">总耗时</Select.Option>
                <Select.Option value="windowCalls">窗口调用数</Select.Option>
                <Select.Option value="windowUsecPerCall">窗口平均耗时</Select.Option>
                <Select.Option value="windowRate">窗口调用速率</Select.Option>
              </Select>
              <Select size="small" value={commandSortOrder} onChange={(v) => setCommandSortOrder(v)} style={{ width: 120 }}>
                <Select.Option value="desc">降序</Select.Option>
                <Select.Option value="asc">升序</Select.Option>
              </Select>
              <span>Top-N</span>
              <InputNumber min={1} max={100} value={topN} onChange={(v) => setTopN(Number(v || 10))} />
              <Button size="small" onClick={() => (window as any).__exportCmdStatsCsv?.(displayCommandStats)}>导出CSV</Button>
            </Space>
          }>
            <Table
              size="small"
              rowKey={(r) => r.cmd}
              dataSource={displayCommandStats as any}
              columns={columnsCommandStats as any}
              pagination={false}
            />
          </Card>
        </>
      )}
    </div>
  );
};

export default RedisServiceInfoPage;
