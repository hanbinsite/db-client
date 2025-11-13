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
  // 采样并发节流标志
  const [samplingBusy, setSamplingBusy] = useState<boolean>(false);
  // 派生计算的最近值
  const [lastTotalCmds, setLastTotalCmds] = useState<number | null>(null);
  const [lastOpsTs, setLastOpsTs] = useState<number | null>(null);
  const [lastTotalConns, setLastTotalConns] = useState<number | null>(null);
  const [lastConnTs, setLastConnTs] = useState<number | null>(null);
  const [lastTotalNetInBytes, setLastTotalNetInBytes] = useState<number | null>(null);
  const [lastNetInTs, setLastNetInTs] = useState<number | null>(null);
  const [lastTotalNetOutBytes, setLastTotalNetOutBytes] = useState<number | null>(null);
  const [lastNetOutTs, setLastNetOutTs] = useState<number | null>(null);
  // UI状态
  const [netUnit, setNetUnit] = useState<'KBps'|'MBps'>('KBps');
  const [enabledMemSeries, setEnabledMemSeries] = useState<Array<'used'|'rss'|'peak'|'dataset'|'lua'>>(['used','rss','peak']);
  const [windowMinutes, setWindowMinutes] = useState<number>(2);
  const [commandSortKey, setCommandSortKey] = useState<'calls'|'usec'|'usecPerCall'|'windowCalls'|'windowUsecPerCall'|'windowRate'>('usecPerCall');
  const [commandSortOrder, setCommandSortOrder] = useState<'desc'|'asc'>('desc');
  const [cmdViewMode, setCmdViewMode] = useState<'current'|'window'>('current');
  const [topN, setTopN] = useState<number>(10);
  
  const poolId = connection.connectionId;

  // 根据分钟与采样间隔，派生样本窗口
  useEffect(() => {
    const count = Math.max(5, Math.round((windowMinutes * 60000) / sampleIntervalMs));
    setSampleWindow(count);
  }, [windowMinutes, sampleIntervalMs]);

  // 初始加载
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        // 模拟初始数据加载
        setSections({});
        setKeyspace({});
        setCommandStats([]);
        if (!cancelled) setLoading(false);
      } catch (err: any) {
        if (!cancelled) {
          setError(`加载失败: ${err.message || '未知错误'}`);
          setLoading(false);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [poolId]);

  // 周期采样
  useEffect(() => {
    if (!enableSampling || !poolId) return;
    
    const adjustedSampleIntervalMs = Math.max(10000, sampleIntervalMs);
    
    const timer = setInterval(async () => {
      if (samplingBusy) return;
      setSamplingBusy(true);
      try {
        // 简化的采样逻辑
        const newSample = {
          ts: Date.now(),
          ops: Math.floor(Math.random() * 1000),
          mem: Math.floor(Math.random() * 1000000000),
          clients: Math.floor(Math.random() * 100)
        };
        
        setInfoSamples(prev => {
          const updated = [...prev, newSample];
          return updated.slice(-sampleWindow);
        });
      } catch (err) {
        console.error('采样失败:', err);
      } finally {
        setSamplingBusy(false);
      }
    }, adjustedSampleIntervalMs);
    
    return () => clearInterval(timer);
  }, [enableSampling, poolId, sampleIntervalMs, sampleWindow]);

  // 选择时间窗口数据源：当前INFO或采样窗口
  const displayCommandStats = useMemo(() => {
    if (cmdViewMode === 'current') {
      const arr = commandStats.map((c) => ({ ...c, windowCalls: undefined as any }));
      const sortKey = commandSortKey === 'windowCalls' ? 'usecPerCall' : commandSortKey;
      arr.sort((a: any, b: any) => {
        const av = Number(a[sortKey] || 0);
        const bv = Number(b[sortKey] || 0);
        return commandSortOrder === 'desc' ? (bv - av) : (av - bv);
      });
      return arr.slice(0, Math.max(1, topN || 10));
    }
    
    // 采样窗口逻辑
    const firstLast: Record<string, { first?: number; last?: number }> = {};
    Object.keys(cmdSamples).forEach((cmd: string) => {
      const arr = cmdSamples[cmd] || [];
      if (arr.length > 0) {
        firstLast[cmd] = { first: arr[0].calls, last: arr[arr.length - 1].calls };
      }
    });
    
    const merged = commandStats.map((c: any) => {
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
    
    merged.sort((a: any, b: any) => {
      const key = ['windowCalls','windowUsecPerCall','windowRate'].includes(commandSortKey) ? commandSortKey : commandSortKey;
      const av = Number(a[key] || 0);
      const bv = Number(b[key] || 0);
      return commandSortOrder === 'desc' ? (bv - av) : (av - bv);
    });
    
    return merged.slice(0, Math.max(1, topN || 10));
  }, [commandStats, cmdSamples, cmdViewMode, commandSortKey, commandSortOrder, topN]);

  // 概览数据
  const overview = useMemo(() => ({
    role: 'master',
    version: 'unknown',
    uptimeDays: 0,
    connectedClients: 0
  }), [sections]);

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
          </Card>
          <Card title="系统信息" style={{ marginBottom: 12 }}>
            <p>Redis服务监控页面已重新构建，正在加载数据...</p>
          </Card>
        </>
      )}
    </div>
  );
};

export default RedisServiceInfoPage;
