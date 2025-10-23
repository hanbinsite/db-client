import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input, List, Spin, Empty, Typography, Tag, Space, Divider, Alert, Button, Switch, Select, message, InputNumber, Tooltip, Progress } from 'antd';
import type { DatabaseConnection } from '../../types';
import { execRedisQueuedWithTimeout } from '../../utils/redis-exec-queue';
import RedisAddKeyModal from '../redis/RedisAddKeyModal';

interface RedisDataBrowserProps {
  connection: DatabaseConnection;
  database: string; // e.g. 'db0'
  darkMode?: boolean;
}

interface ScanState {
  cursor: string; // Redis scan cursor as string
  keys: string[];
  loading: boolean;
  reachedEnd: boolean;
  pattern: string; // MATCH pattern
}

const PAGE_COUNT = 100;

const containerStyle: React.CSSProperties = {
  display: 'flex',
  width: '100%',
  height: '100%',
  overflow: 'hidden'
};

const leftPaneStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  borderRight: '1px solid var(--split-border, #f0f0f0)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
};

const rightPaneStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
};

const scrollAreaStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  padding: 8
};

const headerStyle: React.CSSProperties = {
  padding: 8,
  borderBottom: '1px solid var(--split-border, #f0f0f0)'
};

const JsonPreview: React.FC<{ value: any }> = ({ value }) => {
  const [text, setText] = useState('');
  useEffect(() => {
    try {
      setText(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
    } catch {
      setText(String(value));
    }
  }, [value]);
  return (
    <pre style={{ margin: 0, padding: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</pre>
  );
};

// 新增：纯文本预览组件
const TextPreview: React.FC<{ value: any }> = ({ value }) => {
  let text = '';
  try {
    if (typeof value === 'string') text = value;
    else if (value === null || value === undefined) text = '';
    else if (typeof value === 'object') text = String(value);
    else text = String(value);
  } catch {
    text = String(value);
  }
  return (
    <pre style={{ margin: 0, padding: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{text}</pre>
  );
};

const RedisDataBrowser: React.FC<RedisDataBrowserProps> = ({ connection, database, darkMode }) => {
  const [poolId, setPoolId] = useState<string | undefined>(connection.connectionId);
  const [selectingDb, setSelectingDb] = useState<boolean>(false);
  const [scan, setScan] = useState<ScanState>({ cursor: '0', keys: [], loading: false, reachedEnd: false, pattern: '*' });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [keyType, setKeyType] = useState<string>('');
  const [keyLoading, setKeyLoading] = useState<boolean>(false);
  const [keyError, setKeyError] = useState<string>('');
  const [keyData, setKeyData] = useState<any>(null);
  const [keyMeta, setKeyMeta] = useState<{ ttl?: number; exists?: boolean }>({});
const [keyTypes, setKeyTypes] = useState<Record<string, string>>({});
// 新增：键名编辑模式与内容
const [editKeyMode, setEditKeyMode] = useState<boolean>(true);
const [editedKey, setEditedKey] = useState<string>('');
const [valueDisplayMode, setValueDisplayMode] = useState<'json' | 'text'>('json');
// 新增：字符串键值的可编辑文本与展示配置
const [stringValueText, setStringValueText] = useState<string>('');
const [stringEditing, setStringEditing] = useState<boolean>(false);
const [stringWrap, setStringWrap] = useState<boolean>(true);
// 新增：非字符串类型编辑状态
const [hashEntries, setHashEntries] = useState<Array<{field: string; value: string}>>([]);
const [hashSelected, setHashSelected] = useState<number>(-1);
const [listElements, setListElements] = useState<string[]>([]);
const [listSelected, setListSelected] = useState<number>(-1);
const [setMembers, setSetMembers] = useState<string[]>([]);
const [setSelected, setSetSelected] = useState<number>(-1);
const [zsetEntries, setZsetEntries] = useState<Array<{member: string; score: number}>>([]);
const [zsetSelected, setZsetSelected] = useState<number>(-1);
// 扫描与多模式/本地过滤相关状态
const [scanCount, setScanCount] = useState<number>(PAGE_COUNT);
const [multiEnabled, setMultiEnabled] = useState<boolean>(false);
const [multiPatterns, setMultiPatterns] = useState<string[]>(['*']);
const [multiState, setMultiState] = useState<{ cursors: Record<string, string>; reached: Record<string, boolean>; index: number }>({ cursors: {}, reached: {}, index: 0 });
const [multiCounts, setMultiCounts] = useState<Record<string, number>>({});
const [multiInFlight, setMultiInFlight] = useState<Record<string, boolean>>({});
const [multiBatches, setMultiBatches] = useState<Record<string, number>>({});
const [scanConcurrency, setScanConcurrency] = useState<number>(2);
const [scanThrottleMs, setScanThrottleMs] = useState<number>(80);
const lastBatchAtRef = useRef<number>(0);
const [localFilterEnabled, setLocalFilterEnabled] = useState<boolean>(false);
const [filterPatterns, setFilterPatterns] = useState<string[]>([]);
const [localFilterThreshold, setLocalFilterThreshold] = useState<number>(5000);
const [maxBatchHint, setMaxBatchHint] = useState<number>(20);
const [addVisible, setAddVisible] = useState<boolean>(false);
// 新增：数据库大小与加载控制
const [dbSize, setDbSize] = useState<number>(0);
const [autoLoad, setAutoLoad] = useState<boolean>(true);
const [hardCap, setHardCap] = useState<number>(50000);
const scanAbortRef = useRef<boolean>(false);
const [paused, setPaused] = useState<boolean>(false);
const SAFE_KEYS_FALLBACK_LIMIT = 5000;
// 新增：扫描错误提示
const [scanError, setScanError] = useState<string>('');
// 动态并发与命令队列
const [maxConnections, setMaxConnections] = useState<number>(1);
const debugLog = (..._args: any[]) => {};
// 批量渲染缓冲与节流，避免海量键导致频繁重渲染
const pendingKeysRef = useRef<string[]>([]);
const flushTimerRef = useRef<any>(null);
const FLUSH_INTERVAL_MS = 120;
const seenKeysRef = useRef<Set<string>>(new Set());
const queueKeys = (keysToAdd: string[]) => {
  if (!keysToAdd || keysToAdd.length === 0) return;
  // 去重：避免重复键反复渲染
  const fresh: string[] = [];
  for (const k of keysToAdd) {
    if (!seenKeysRef.current.has(k)) {
      seenKeysRef.current.add(k);
      fresh.push(k);
    }
  }
  if (fresh.length === 0) return;
  pendingKeysRef.current.push(...fresh);
  if (!flushTimerRef.current) {
    flushTimerRef.current = setTimeout(() => {
      const toAdd = pendingKeysRef.current.splice(0);
      setScan(prev => ({
        ...prev,
        keys: prev.keys.length === 0 ? toAdd : [...prev.keys, ...toAdd]
      }));
      flushTimerRef.current = null;
    }, FLUSH_INTERVAL_MS);
  }
};
const execQuery = async (query: string, params?: any[]) => {
  if (!poolId) throw new Error('Pool not ready');
  const runOnce = async (pid: string) => execRedisQueuedWithTimeout(pid, query, params, 0);
  let currentPid = poolId!;
  let res = await runOnce(currentPid);
  const msg = String(((res as any)?.message || (res as any)?.error || ''));
  if (res && res.success === false && (msg.includes('连接池不存在') || msg.includes('Redis client not connected') || msg.includes('获取连接超时'))) {
    console.warn('[REDIS BROWSER] execQuery detected pool issue, attempting reconnect. message:', msg);
    try {
      const reconnect = await (window as any).electronAPI?.connectDatabase?.(connection);
      if (reconnect && reconnect.success && reconnect.connectionId) {
        currentPid = reconnect.connectionId;
        setPoolId(currentPid);
        connection.connectionId = currentPid;
        connection.isConnected = true;
        debugLog('reconnect success, new poolId:', currentPid);
        res = await runOnce(currentPid);
      } else {
        console.warn('[REDIS BROWSER] reconnect failed or no connectionId, res:', reconnect);
      }
    } catch (e) {
      console.error('[REDIS BROWSER] reconnect error:', e);
    }
  }
  return res;
};
// 新增：带超时与重试的查询封装，避免 dbsize 偶发超时导致键数量为0
const execQueryWithTimeoutRetry = async (
  query: string,
  params: any[] = [],
  options: { timeoutMs?: number; retries?: number; backoffMs?: number } = {}
) => {
  const timeoutMs = options.timeoutMs ?? 2000;
  const retries = options.retries ?? 3;
  const backoffMs = options.backoffMs ?? 300;
  const runOnceWithTimeout = async () => {
    const t = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs));
    return await Promise.race([execQuery(query, params), t]);
  };
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const res = await runOnceWithTimeout();
      return res;
    } catch (e: any) {
      const isTimeout = String(e?.message || e).includes('TIMEOUT');
      console.warn('[REDIS BROWSER] execQueryWithTimeoutRetry attempt', attempt + 1, 'failed. isTimeout:', isTimeout, 'error:', e);
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, backoffMs * Math.pow(2, attempt)));
      attempt++;
    }
  }
  throw new Error('execQueryWithTimeoutRetry exhausted');
};
useEffect(() => {
  (async () => {
    try {
      if ((window as any).electronAPI?.getConnectionPoolConfig && poolId) {
        const resp = await (window as any).electronAPI.getConnectionPoolConfig(poolId);
        const mc = (resp && resp.success && resp.config && typeof resp.config.maxConnections === 'number') ? resp.config.maxConnections : 1;
        setMaxConnections(mc);
        debugLog('pool maxConnections:', mc);
      } else {
        setMaxConnections(1);
      }
    } catch {
      setMaxConnections(1);
    }
  })();
}, [poolId, connection.type]);
  // 已去重：这些状态在上方已定义
  // 内置：字符串值同步与工具函数（移入组件内部）
  useEffect(() => {
    if (keyType === 'string') {
      const text = typeof keyData === 'string' ? keyData : (keyData == null ? '' : JSON.stringify(keyData));
      setStringValueText(text);
    } else {
      setStringValueText('');
    }
  }, [keyType, keyData, selectedKey]);

  // 新增：同步非字符串类型的编辑状态
  useEffect(() => {
    setHashSelected(-1);
    setListSelected(-1);
    setSetSelected(-1);
    setZsetSelected(-1);

    if (!selectedKey) {
      setHashEntries([]);
      setListElements([]);
      setSetMembers([]);
      setZsetEntries([]);
      return;
    }
    const kd: any = keyData;
    if (keyType === 'hash') {
      let entries: Array<{field: string; value: string}> = [];
      if (Array.isArray(kd)) {
        for (let i = 0; i < kd.length; i += 2) {
          const f = kd[i];
          const v = kd[i + 1];
          entries.push({ field: String(f ?? ''), value: String(v ?? '') });
        }
      } else if (kd && typeof kd === 'object') {
        entries = Object.entries(kd).map(([f, v]) => ({ field: String(f), value: String(v ?? '') }));
      }
      setHashEntries(entries);
    } else if (keyType === 'list') {
      const arr = Array.isArray(kd) ? kd.map(v => String(v ?? '')) : [];
      setListElements(arr);
    } else if (keyType === 'set') {
      const arr = Array.isArray(kd) ? kd.map(v => String(v ?? '')) : [];
      setSetMembers(arr);
    } else if (keyType === 'zset') {
      const rows: Array<{member: string; score: number}> = [];
      if (Array.isArray(kd)) {
        for (let i = 0; i < kd.length; i += 2) {
          const m = kd[i];
          const s = Number(kd[i + 1]);
          rows.push({ member: String(m ?? ''), score: isNaN(s) ? 0 : s });
        }
      }
      setZsetEntries(rows);
    } else {
      setHashEntries([]);
      setListElements([]);
      setSetMembers([]);
      setZsetEntries([]);
    }
  }, [keyType, keyData, selectedKey]);

  const copyString = async () => {
    try {
      await navigator.clipboard?.writeText(String(stringValueText ?? ''));
      message.success('已复制到剪贴板');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = String(stringValueText ?? '');
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        message.success('已复制到剪贴板');
      } catch {
        message.error('复制失败');
      }
    }
  };

  const formatStringIfJson = () => {
    try {
      const obj = JSON.parse(String(stringValueText ?? ''));
      setStringValueText(JSON.stringify(obj, null, 2));
      message.success('已格式化为 JSON');
    } catch {
      message.warning('当前内容不是合法 JSON');
    }
  };

  const typeTo3Chars = (t?: string) => {
    const m = (t || '').toLowerCase();
    const map: Record<string, string> = {
      string: 'STR',
      hash: 'HSH',
      list: 'LST',
      set: 'SET',
      zset: 'ZST',
      stream: 'STM',
      hyperloglog: 'HLL',
      bitmap: 'BIT'
    };
    if (map[m]) return map[m];
    const cleaned = (t || 'UNK').replace(/[^a-z0-9]/gi, '').toUpperCase();
    return cleaned.length >= 3 ? cleaned.slice(0, 3) : (cleaned + '___').slice(0, 3);
  };

  const typeColorForLabel = (label?: string) => {
    const l = (label || 'UNK').toUpperCase();
    const colorMap: Record<string, string> = {
      STR: 'blue',
      HSH: 'purple',
      LST: 'geekblue',
      SET: 'green',
      ZST: 'gold',
      STM: 'orange',
      HLL: 'magenta',
      BIT: 'cyan',
      UNK: 'default'
    };
    return colorMap[l] || 'default';
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const [listScrollTop, setListScrollTop] = useState(0);
  const [listContainerHeight, setListContainerHeight] = useState(400);
  const itemHeight = 28;
  const overscan = 5;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const update = () => setListContainerHeight(el.clientHeight || 400);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleListScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setListScrollTop((e.currentTarget as HTMLDivElement).scrollTop);
  };

  const dbIndex = useMemo(() => {
    const m = String(database).match(/db(\d+)/i);
    return m ? parseInt(m[1], 10) : (Number(database) || 0);
  }, [database]);

  // 基于 ':' 的分层展示状态
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({ '': true });
  type DisplayItem = { kind: 'folder' | 'key'; name: string; fullPath: string; level: number; childrenCount?: number };
  const displayItems = useMemo(() => {
    const root: any = { name: '', fullPath: '', children: new Map(), isLeaf: false };
    for (const k of scan.keys) {
      const parts = String(k).split(':');
      let node = root;
      let accum = '';
      for (let i = 0; i < parts.length; i++) {
        accum = accum ? `${accum}:${parts[i]}` : parts[i];
        if (!node.children.has(parts[i])) {
          node.children.set(parts[i], { name: parts[i], fullPath: accum, children: new Map(), isLeaf: false });
        }
        node = node.children.get(parts[i]);
      }
      node.isLeaf = true;
    }
    const items: DisplayItem[] = [];
    const traverse = (n: any, level: number) => {
      if (n !== root) {
        if (n.isLeaf && n.children.size === 0) {
          items.push({ kind: 'key', name: n.name, fullPath: n.fullPath, level });
          return;
        }
        const childCount = Array.from(n.children.values()).length;
        items.push({ kind: 'folder', name: n.name, fullPath: n.fullPath, level, childrenCount: childCount });
        if (expandedPaths[n.fullPath]) {
          for (const child of Array.from(n.children.values())) {
            traverse(child, level + 1);
          }
        }
        return;
      }
      for (const child of Array.from(n.children.values())) {
        traverse(child, 0);
      }
    };
    traverse(root, 0);
    return items;
  }, [scan.keys, expandedPaths]);

  const virtualWindow = useMemo(() => {
    const total = displayItems.length;
    const totalHeight = total * itemHeight;
    const start = Math.max(0, Math.floor(listScrollTop / itemHeight) - overscan);
    const viewportCount = Math.ceil(listContainerHeight / itemHeight) + overscan * 2;
    const end = Math.min(total, start + viewportCount);
    const slice = displayItems.slice(start, end);
    return { totalHeight, start, slice };
  }, [displayItems, listScrollTop, listContainerHeight]);

  const togglePath = (p: string) => {
    setExpandedPaths(prev => ({ ...prev, [p]: !prev[p] }));
  };

  // ensure connected pool
  useEffect(() => {
    let cancelled = false;
    const ensurePool = async () => {
      try {
        let pid = poolId;
        debugLog('ensurePool start, current poolId:', pid, 'connId:', connection.connectionId);
        if (!pid) {
          const generatedId = `${connection.type}_${connection.host}_${connection.port}_${connection.database || ''}`;
          // 先测试连接并尝试复用/保留测试创建的连接池
          try {
            const testRes = await (window as any).electronAPI?.testConnection?.(connection);
            debugLog('testConnection result:', testRes);
          } catch (e) {
            console.warn('[REDIS BROWSER] testConnection error:', e);
          }
          // 测试后检查是否已有连接池配置
          try {
            const cfgRes = await (window as any).electronAPI?.getConnectionPoolConfig?.(generatedId);
            if (cfgRes) {
              pid = generatedId;
              connection.connectionId = pid;
              connection.isConnected = true;
              debugLog('adopted poolId from test/generator:', pid);
            } else {
              // 回退：创建持久连接
              const res = await (window as any).electronAPI?.connectDatabase?.(connection);
              debugLog('connectDatabase result:', res);
              if (res && res.success && res.connectionId) {
                pid = res.connectionId;
                connection.connectionId = pid;
                connection.isConnected = true;
                debugLog('created poolId via connectDatabase:', pid);
              } else {
                // 最后再检查一次是否已有池
                try {
                  const cfgRes2 = await (window as any).electronAPI?.getConnectionPoolConfig?.(generatedId);
                  if (cfgRes2) {
                    pid = generatedId;
                    console.warn('[REDIS BROWSER] adopting existing poolId via generatedId after fallback:', generatedId);
                  } else {
                    console.warn('[REDIS BROWSER] no existing pool found for generatedId, keep poolId undefined');
                  }
                } catch (e2) {
                  console.warn('[REDIS BROWSER] getConnectionPoolConfig error:', e2);
                }
              }
            }
          } catch (e) {
            console.warn('[REDIS BROWSER] getConnectionPoolConfig check error:', e);
          }
        }
        if (!cancelled && pid) {
          debugLog('ensurePool set poolId:', pid);
          setPoolId(pid);
        }
      } catch (e) {
        console.error('[REDIS BROWSER] ensurePool error:', e);
      }
    };
    ensurePool();
    return () => { cancelled = true; };
  }, [connection, poolId]);

  // utility: safe stringify for logging
  const safeStringify = (obj: any) => {
    try {
      return JSON.stringify(obj);
    } catch {
      return String(obj);
    }
  };

  // 模式匹配与通配符工具
  const escapeRegex = (s: string) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const wildcardToRegExp = (pattern: string) => {
    const p = pattern || '*';
    const re = '^' + escapeRegex(p).replace(/\\\*/g, '.*').replace(/\\\?/g, '.') + '$';
    return new RegExp(re);
  };
  const matchAnyPattern = (key: string, patterns: string[]) => {
    if (!patterns || patterns.length === 0) return true;
    return patterns.some(p => wildcardToRegExp(p).test(key));
  };

  const toStr = (v: any) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'object') {
      if ('value' in v) return String((v as any).value);
      return JSON.stringify(v);
    }
    return String(v);
  };

  // select redis db
  useEffect(() => {
    const selectDb = async () => {
      if (!poolId || connection.type !== 'redis') return;
      setSelectingDb(true);
      debugLog('selecting DB index:', dbIndex, 'poolId:', poolId);
      try {
        const res = await execQuery('select', [String(dbIndex)]);
        debugLog('select result ok');
        if (!(res && res.success)) {
          console.warn('[REDIS BROWSER] select not successful, continue anyway');
        }
      } catch (err) {
        console.error('[REDIS BROWSER] select error:', err);
      } finally {
        // 终止上一次扫描，避免重入
        scanAbortRef.current = true;
        setPaused(true);
        setSelectingDb(false);
        setScan(prev => ({ cursor: '0', keys: [], loading: false, reachedEnd: false, pattern: prev.pattern || '*' }));
        // 重置缓冲与去重集合
        pendingKeysRef.current = [];
        seenKeysRef.current.clear();
        if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
        setSelectedKey(null);
        setKeyType('');
        setKeyData(null);
        setKeyMeta({});
        setKeyError('');
        setScanError('');
        // 查询当前DB键数量，以决定是否允许 KEYS 回退（新增重试与超时）
        try {
          const sizeRes = await execQueryWithTimeoutRetry('dbsize', [], { timeoutMs: 2000, retries: 3, backoffMs: 300 });
          let sizeVal = 0;
          if (sizeRes && sizeRes.success) {
            const d = sizeRes.data;
            if (typeof d === 'number') {
              sizeVal = d;
            } else if (Array.isArray(d)) {
              const v = Number(d[0]?.value ?? d[0]);
              if (Number.isFinite(v)) sizeVal = v;
            } else if (typeof d === 'object' && d !== null) {
              const v = Number((d as any).value ?? d);
              if (Number.isFinite(v)) sizeVal = v;
            }
          } else {
            console.warn('[REDIS BROWSER] dbsize unsuccessful JSON:', safeStringify(sizeRes));
          }
          setDbSize(sizeVal);
          try {
            window.dispatchEvent(new CustomEvent('redis-keycount-update', {
              detail: { connectionId: poolId, database: `db${dbIndex}`, keyCount: sizeVal }
            }));
          } catch (e) {
            console.warn('[REDIS BROWSER] dispatch redis-keycount-update failed:', e);
          }
        } catch (e) {
          console.warn('[REDIS BROWSER] dbsize query failed:', e);
          setDbSize(0);
        }
        // 恢复扫描标记，并触发首次加载
        scanAbortRef.current = false;
        setPaused(false);
        setTimeout(() => { loadNext(); }, 0);
      }
    };
    selectDb();
  }, [poolId, dbIndex, connection.type]);

  const loadNext = async () => {
    if (scan.loading || scan.reachedEnd || !poolId || selectingDb) {
      debugLog('loadNext guard hit', { loading: scan.loading, reachedEnd: scan.reachedEnd, poolId, selectingDb });
      return;
    }
    if (scanAbortRef.current) {
      debugLog('loadNext aborted');
      setScan(prev => ({ ...prev, loading: false }));
      return;
    }
    if (hardCap > 0 && scan.keys.length >= hardCap) {
      debugLog('loadNext reached hard cap', hardCap);
      setScan(prev => ({ ...prev, loading: false, reachedEnd: true }));
      message.warning(`达到浏览上限 ${hardCap} 项，已停止扫描`);
      return;
    }
    // 节流：多模式或本地过滤路径在两次批次之间等待 scanThrottleMs
    if ((multiEnabled || localFilterEnabled) && scanThrottleMs > 0) {
      const now = Date.now();
      if (now - (lastBatchAtRef.current || 0) < scanThrottleMs) {
        debugLog('throttle guard, wait', scanThrottleMs, 'ms');
        return;
      }
    }
    setScan(prev => ({ ...prev, loading: true }));
    try {
      // 多模式并发扫描（后端匹配）并支持限速
      if (multiEnabled && !localFilterEnabled) {
        const patterns = multiPatterns.length > 0 ? multiPatterns : ['*'];
        const candidates = patterns.filter(p => !multiState.reached[p] && !multiInFlight[p]);
        const effectiveConcurrency = (connection.type === 'redis') ? 1 : scanConcurrency;
        const batch = candidates.slice(0, Math.max(1, effectiveConcurrency));
        if (batch.length === 0) {
          const allReached = patterns.every(p => multiState.reached[p]);
          setScan(prev => ({ ...prev, loading: false, reachedEnd: allReached || prev.reachedEnd }));
          return;
        }
        await Promise.all(batch.map(async (pattern) => {
          try {
            setMultiInFlight(prev => ({ ...prev, [pattern]: true }));
            const cursor = multiState.cursors[pattern] || '0';
            const params = [cursor, 'MATCH', pattern || '*', 'COUNT', String(scanCount)];
            debugLog('SCAN(multi-concurrent) params:', params);
        const res = await execQuery('scan', params);
        // debugLog('SCAN(multi-concurrent) raw JSON');
            if (res && res.success) {
              const data = res.data;
              let nextCursor: string = '0';
              let keys: any[] = [];
              if (Array.isArray(data) && data.length >= 2) {
                nextCursor = toStr(data[0]);
                keys = Array.isArray(data[1]) ? data[1] : [];
              } else if (data && typeof data === 'object' && 'cursor' in data && 'keys' in data) {
                nextCursor = toStr((data as any).cursor);
                keys = Array.isArray((data as any).keys) ? (data as any).keys : [];
              } else {
                console.warn('[REDIS BROWSER] Unexpected SCAN data format, data JSON:', safeStringify(data));
              }
              let keysNormalized: string[] = (keys || []).map((k: any) => toStr(k));
              // 安全回退：仅当DB很小才允许 KEYS
              if (keysNormalized.length === 0 && String(nextCursor) === '0' && scan.cursor === '0') {
                if (dbSize > 0 && dbSize <= SAFE_KEYS_FALLBACK_LIMIT) {
                  try {
                    const keysRes = await execQuery('keys', [scan.pattern || '*']);
                    debugLog('SCAN empty, fallback KEYS');
                    if (keysRes && keysRes.success) {
                      const kd = keysRes.data;
                      if (Array.isArray(kd)) {
                        keysNormalized = kd.map((x: any) => toStr(x));
                      }
                    }
                  } catch (e) {
                    console.warn('[REDIS BROWSER] KEYS fallback error:', e);
                  }
                } else {
                  console.warn('[REDIS BROWSER] skip KEYS fallback due to large dbSize:', dbSize);
                  message.info('当前数据库键数量较大，已禁用 KEYS 回退，请使用 SCAN 分批加载');
                }
              }
              debugLog('SCAN parsed -> nextCursor:', nextCursor, 'keys count:', keysNormalized.length);
              setScan(prev => ({
                ...prev,
                cursor: String(nextCursor),
                loading: false,
                reachedEnd: String(nextCursor) === '0',
              }));
              queueKeys(keysNormalized);
              // 自动继续扫描：当前批次为空且未结束时
              if ((keysNormalized.length === 0) && (String(nextCursor) !== '0') && autoLoad && !scanAbortRef.current && !selectingDb) {
                setTimeout(() => {
                  loadNext();
                }, scanThrottleMs > 0 ? scanThrottleMs : 0);
              }
            } else {
              console.warn('[REDIS BROWSER] SCAN unsuccessful JSON:', safeStringify(res));
              setScan(prev => ({ ...prev, loading: false }));
              setScanError(String((((res as any) && (((res as any).message || (res as any).error))) || '扫描失败')));
            }
          } catch (e) {
            console.error('[REDIS BROWSER] SCAN error:', e);
            setScan(prev => ({ ...prev, loading: false }));
            setScanError(String(((e as any)?.message || e || '扫描异常')));
          }
        }));
        // 重置并发标记
        setMultiInFlight(prev => {
          const next = { ...prev } as Record<string, boolean>;
          batch.forEach(p => { next[p] = false; });
          return next;
        });
        // 批次节流：等待一定时间再释放下一次批次
        lastBatchAtRef.current = Date.now();
        if (scanThrottleMs > 0) {
          await new Promise(resolve => setTimeout(resolve, scanThrottleMs));
        }
        const allReachedAfter = (multiPatterns.length > 0 ? multiPatterns : ['*']).every(p => multiState.reached[p]);
        setScan(prev => ({ ...prev, loading: false, reachedEnd: allReachedAfter || prev.reachedEnd }));
        return;
      }

      // 本地过滤：统一使用 '*' 扫描，前端按模式筛选
      if (localFilterEnabled) {
        const params = ['' + scan.cursor, 'MATCH', '*', 'COUNT', String(scanCount)];
        debugLog('SCAN(local-filter) params:', params);
        const res = await execQuery('scan', params);
        // 去除大JSON输出
        // debugLog('SCAN(local-filter) raw JSON');
        if (res && res.success) {
          const data = res.data;
          let nextCursor: string = '0';
          let keys: any[] = [];
          if (Array.isArray(data) && data.length >= 2) {
            nextCursor = toStr(data[0]);
            keys = Array.isArray(data[1]) ? data[1] : [];
          } else if (data && typeof data === 'object' && 'cursor' in data && 'keys' in data) {
            nextCursor = toStr((data as any).cursor);
            keys = Array.isArray((data as any).keys) ? (data as any).keys : [];
          }
          let keysNormalized: string[] = (keys || []).map((k: any) => toStr(k));
          const pats = multiEnabled ? (multiPatterns && multiPatterns.length > 0 ? multiPatterns : ['*']) : (filterPatterns && filterPatterns.length > 0 ? filterPatterns : ['*']);
          const filtered = keysNormalized.filter(k => matchAnyPattern(k, pats));
          setScan(prev => ({
            ...prev,
            cursor: String(nextCursor),
            loading: false,
            reachedEnd: String(nextCursor) === '0',
            pattern: '*'
          }));
          queueKeys(filtered);
          // 自动继续扫描：当前批次为空且未结束时
          if ((filtered.length === 0) && (String(nextCursor) !== '0') && autoLoad && !scanAbortRef.current && !selectingDb) {
            setTimeout(() => {
              loadNext();
            }, scanThrottleMs > 0 ? scanThrottleMs : 0);
          }

          // 批次节流：等待一定时间再释放下一次批次
          lastBatchAtRef.current = Date.now();
          if (scanThrottleMs > 0) {
            await new Promise(resolve => setTimeout(resolve, scanThrottleMs));
          }
          if (multiEnabled) {
            // 统计每个模式匹配数量
            setMultiCounts(prev => {
              const next = { ...prev };
              for (const p of pats) {
                const c = filtered.filter(k => wildcardToRegExp(p).test(k)).length;
                next[p] = (next[p] || 0) + c;
              }
              return next;
            });
          }
        } else {
          console.warn('[REDIS BROWSER] SCAN unsuccessful JSON (local-filter):', safeStringify(res));
          setScan(prev => ({ ...prev, loading: false }));
        }
        return;
      }

      // 单模式（后端匹配）
      const params = ['' + scan.cursor, 'MATCH', scan.pattern || '*', 'COUNT', String(scanCount)];
      debugLog('SCAN params:', params);
        const res = await execQuery('scan', params);
        // debugLog('SCAN raw result JSON');
      if (res && res.success) {
        const data = res.data;
        let nextCursor: string = '0';
        let keys: any[] = [];
        if (Array.isArray(data) && data.length >= 2) {
          nextCursor = toStr(data[0]);
          keys = Array.isArray(data[1]) ? data[1] : [];
        } else if (data && typeof data === 'object' && 'cursor' in data && 'keys' in data) {
          nextCursor = toStr((data as any).cursor);
          keys = Array.isArray((data as any).keys) ? (data as any).keys : [];
        } else {
          console.warn('[REDIS BROWSER] Unexpected SCAN data format, data JSON:', safeStringify(data));
        }
        let keysNormalized: string[] = (keys || []).map((k: any) => toStr(k));
        if (keysNormalized.length === 0 && String(nextCursor) === '0' && scan.cursor === '0') {
          try {
            const keysRes = await execQuery('keys', [scan.pattern || '*']);
            debugLog('SCAN empty, fallback KEYS');
            if (keysRes && keysRes.success) {
              const kd = keysRes.data;
              if (Array.isArray(kd)) {
                keysNormalized = kd.map((x: any) => toStr(x));
              }
            }
          } catch (e) {
            console.warn('[REDIS BROWSER] KEYS fallback error:', e);
          }
        }

       // 使用批量缓冲，降低渲染压力
       queueKeys(keysNormalized);
       setScan(prev => ({
         ...prev,
         cursor: String(nextCursor),
         loading: false,
         reachedEnd: String(nextCursor) === '0',
       }));
       // 自动继续扫描：当前批次为空且未结束时
       if ((keysNormalized.length === 0) && (String(nextCursor) !== '0') && autoLoad && !scanAbortRef.current && !selectingDb) {
         setTimeout(() => {
           loadNext();
         }, scanThrottleMs > 0 ? scanThrottleMs : 0);
       }
      } else {
        console.warn('[REDIS BROWSER] SCAN unsuccessful JSON:', safeStringify(res));
        setScan(prev => ({ ...prev, loading: false }));
      }
    } catch (e) {
      console.error('[REDIS BROWSER] SCAN error:', e);
      setScan(prev => ({ ...prev, loading: false }));
    }
  };

  // immediate search executor to avoid stale state
  const performSearch = async (pattern: string) => {
    if (!poolId || selectingDb) {
      debugLog('performSearch guard hit', { poolId, selectingDb });
      return;
    }

    // 多模式 + 本地过滤：用'*'扫描、前端筛选
    if (multiEnabled && localFilterEnabled) {
      const patterns = (multiPatterns && multiPatterns.length > 0) ? multiPatterns : (pattern ? pattern.split(',').map(s => s.trim()).filter(Boolean) : ['*']);
      setFilterPatterns(patterns);
      setMultiCounts({});
      setScan({ cursor: '0', keys: [], loading: true, reachedEnd: false, pattern: '*' });
      // 重置缓冲与去重集合
      pendingKeysRef.current = [];
      seenKeysRef.current.clear();
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      try {
        const params = ['0', 'MATCH', '*', 'COUNT', String(scanCount)];
        debugLog('SEARCH SCAN(local-filter multi) params:', params);
        const res = await execQuery('scan', params);
        if (res && res.success) {
          const data = res.data;
          let nextCursor: string = '0';
          let keys: any[] = [];
          if (Array.isArray(data) && data.length >= 2) {
            nextCursor = toStr(data[0]);
            keys = Array.isArray(data[1]) ? data[1] : [];
          } else if (data && typeof data === 'object' && 'cursor' in data && 'keys' in data) {
            nextCursor = toStr((data as any).cursor);
            keys = Array.isArray((data as any).keys) ? (data as any).keys : [];
          }
          const keysNormalized: string[] = (keys || []).map((k: any) => toStr(k));
          const filtered = keysNormalized.filter(k => matchAnyPattern(k, patterns));
          setScan(prev => ({
            ...prev,
            cursor: String(nextCursor),
            loading: false,
            reachedEnd: String(nextCursor) === '0',
            pattern: '*'
          }));
          queueKeys(filtered);
          setMultiState({ cursors: { '*': String(nextCursor) }, reached: { '*': String(nextCursor) === '0' }, index: 0 });
          setMultiCounts(patterns.reduce((acc, p) => ({ ...acc, [p]: filtered.filter(k => wildcardToRegExp(p).test(k)).length }), {} as Record<string, number>));
        } else {
          console.warn('[REDIS BROWSER] SEARCH SCAN unsuccessful JSON (local-filter multi):', safeStringify(res));
          setScan(prev => ({ ...prev, loading: false }));
        }
      } catch (e) {
        console.error('[REDIS BROWSER] SEARCH SCAN error (local-filter multi):', e);
        setScan(prev => ({ ...prev, loading: false }));
      }
      return;
    }

    // 多模式并发（后端匹配）：先扫第一个，后续交给 loadNext
    if (multiEnabled) {
      const patterns = (multiPatterns && multiPatterns.length > 0) ? multiPatterns : (pattern ? pattern.split(',').map(s => s.trim()).filter(Boolean) : ['*']);
      setMultiCounts({});
      setMultiInFlight({});
      setMultiState({ cursors: {}, reached: {}, index: 0 });
      setScan({ cursor: '0', keys: [], loading: true, reachedEnd: false, pattern: patterns[0] || '*' });
      // 重置缓冲与去重集合
      pendingKeysRef.current = [];
      seenKeysRef.current.clear();
      if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
      try {
        const p0 = patterns[0] || '*';
        const params = ['0', 'MATCH', p0, 'COUNT', String(scanCount)];
        debugLog('SEARCH SCAN(multi init) params:', params);
        const res = await execQuery('scan', params);
        // debugLog('SEARCH SCAN(multi init) raw JSON');
        if (res && res.success) {
          const data = res.data;
          let nextCursor: string = '0';
          let keys: any[] = [];
          if (Array.isArray(data) && data.length >= 2) {
            nextCursor = toStr(data[0]);
            keys = Array.isArray(data[1]) ? data[1] : [];
          } else if (data && typeof data === 'object' && 'cursor' in data && 'keys' in data) {
            nextCursor = toStr((data as any).cursor);
            keys = Array.isArray((data as any).keys) ? (data as any).keys : [];
          }
          const keysNormalized: string[] = (keys || []).map((k: any) => toStr(k));
          setScan(prev => ({
            ...prev,
            cursor: '0',
            keys: [],
            loading: false,
            reachedEnd: false,
            pattern: p0
          }));
          queueKeys(keysNormalized);
          setMultiState({ cursors: { [p0]: String(nextCursor) }, reached: { [p0]: String(nextCursor) === '0' }, index: patterns.length > 1 ? 1 : 0 });
          setMultiCounts({ [p0]: keysNormalized.length });
        } else {
          console.warn('[REDIS BROWSER] SEARCH SCAN unsuccessful JSON (multi init):', safeStringify(res));
          setScan(prev => ({ ...prev, loading: false }));
        }
      } catch (e) {
        console.error('[REDIS BROWSER] SEARCH SCAN error (multi init):', e);
        setScan(prev => ({ ...prev, loading: false }));
      }
      return;
    }

    // 单模式（后端匹配）
    setScan({ cursor: '0', keys: [], loading: true, reachedEnd: false, pattern });
    // 重置缓冲与去重集合
    pendingKeysRef.current = [];
    seenKeysRef.current.clear();
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    try {
      const params = ['0', 'MATCH', pattern || '*', 'COUNT', String(scanCount)];
      debugLog('SEARCH SCAN params:', params);
        const res = await execQuery('scan', params);
        // debugLog('SEARCH SCAN raw result JSON');
      if (res && res.success) {
        const data = res.data;
        let nextCursor: string = '0';
        let keys: any[] = [];
        if (Array.isArray(data) && data.length >= 2) {
          nextCursor = toStr(data[0]);
          keys = Array.isArray(data[1]) ? data[1] : [];
        } else if (data && typeof data === 'object' && 'cursor' in data && 'keys' in data) {
          nextCursor = toStr((data as any).cursor);
          keys = Array.isArray((data as any).keys) ? (data as any).keys : [];
        } else {
          debugLog('Unexpected SEARCH SCAN data format');
        }
        let keysNormalized: string[] = (keys || []).map((k: any) => toStr(k));
        if (keysNormalized.length === 0 && String(nextCursor) === '0') {
          if (dbSize > 0 && dbSize <= SAFE_KEYS_FALLBACK_LIMIT) {
            try {
              const keysRes = await execQuery('keys', [pattern || '*']);
              debugLog('SEARCH SCAN empty, fallback KEYS');
              if (keysRes && keysRes.success) {
                const kd = keysRes.data;
                if (Array.isArray(kd)) {
                  keysNormalized = kd.map((x: any) => toStr(x));
                }
              }
            } catch (e) {
              console.warn('[REDIS BROWSER] SEARCH KEYS fallback error:', e);
            }
          } else {
            console.warn('[REDIS BROWSER] skip SEARCH KEYS fallback due to large dbSize:', dbSize);
            message.info('当前数据库键数量较大，已禁用 KEYS 回退');
          }
        }
        debugLog('SEARCH parsed -> nextCursor:', nextCursor, 'keys count:', keysNormalized.length);
        setScan(prev => ({
          ...prev,
          cursor: String(nextCursor),
          loading: false,
          reachedEnd: String(nextCursor) === '0',
        }));
        // 自动继续扫描：当前批次为空且未结束时
        if ((keysNormalized.length === 0) && (String(nextCursor) !== '0') && autoLoad && !scanAbortRef.current && !selectingDb) {
          setTimeout(() => {
            loadNext();
          }, scanThrottleMs > 0 ? scanThrottleMs : 0);
        }
        queueKeys(keysNormalized);
      } else {
        console.warn('[REDIS BROWSER] SEARCH SCAN unsuccessful JSON:', safeStringify(res));
        setScan(prev => ({ ...prev, loading: false }));
      }
    } catch (e) {
      console.error('[REDIS BROWSER] SEARCH SCAN error:', e);
      setScan(prev => ({ ...prev, loading: false }));
    }
  };

  // search
  const onSearch = async (value: string) => {
    const raw = value && value.trim() ? value.trim() : '*';
    if (multiEnabled) {
      const patterns = raw.split(',').map(s => s.trim()).filter(Boolean);
      setMultiPatterns(patterns.length > 0 ? patterns : ['*']);
      if (localFilterEnabled) setFilterPatterns(patterns.length > 0 ? patterns : ['*']);
      // 移除冗长日志
      await performSearch(patterns[0] || '*');
    } else {
      if (localFilterEnabled) setFilterPatterns([raw]);
      // 移除冗长日志
      await performSearch(raw);
    }
  };

  // initial load
  useEffect(() => {
    // 移除初始化日志，直接重置状态
    setScan({ cursor: '0', keys: [], loading: false, reachedEnd: false, pattern: '*' });
    // 重置缓冲
    pendingKeysRef.current = [];
    seenKeysRef.current.clear();
    if (flushTimerRef.current) { clearTimeout(flushTimerRef.current); flushTimerRef.current = null; }
    setMultiState({ cursors: {}, reached: {}, index: 0 });
    setMultiCounts({});
    setMultiInFlight({});
    setMultiBatches({});
    lastBatchAtRef.current = 0;
  }, [poolId, dbIndex]);

  useEffect(() => {
    if (poolId && !selectingDb) {
      debugLog('triggering initial loadNext with poolId:', poolId);
      loadNext();
    } else {
      debugLog('skip initial loadNext due to selectingDb:', selectingDb);
    }
  }, [poolId, selectingDb]);

  // scroll handler for infinite load
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const handler = () => {
      if (!autoLoad || scanAbortRef.current) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
        debugLog('list scroll near bottom, loadNext');
        loadNext();
      }
    };
    el.addEventListener('scroll', handler);
    return () => el.removeEventListener('scroll', handler);
  }, [listRef, scan.loading, scan.reachedEnd, poolId, autoLoad]);

  // fetch missing types for displayed keys
  useEffect(() => {
    if (!poolId || scan.keys.length === 0) return;
    const missing = scan.keys.filter(k => !keyTypes[k]);
    if (missing.length === 0) return;
    const batch = missing.slice(0, PAGE_COUNT);
    const updates: Record<string, string> = {};
    let cancelled = false;
    (async () => {
      try {
        await Promise.all(batch.map(async (key) => {
          try {
            const typeRes = await execQuery('type', [key]);
            const type = (typeRes && typeRes.success) ? String(typeRes.data) : 'unknown';
            updates[key] = type.toUpperCase();
          } catch {
            updates[key] = 'UNK';
          }
        }));
      } finally {
        if (!cancelled && Object.keys(updates).length > 0) {
          setKeyTypes(prev => {
            const next = { ...prev };
            for (const k of Object.keys(updates)) {
              if (!next[k]) next[k] = updates[k];
            }
            return next;
          });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [poolId, scan.keys]);

  // search (legacy single-pattern version kept but renamed to avoid duplicate)
  const onSearchLegacy = async (value: string) => {
    const pattern = value && value.trim() ? value.trim() : '*';
    debugLog('onSearch pattern');
    await performSearch(pattern);
  };

  // key select -> load type + value
  const loadKeyDetail = async (key: string) => {
    if (!poolId || !key) return;
    setSelectedKey(key);
    setEditedKey(key);
    setEditKeyMode(true);
    setKeyLoading(true);
    setKeyError('');
    setKeyData(null);
    setKeyMeta({});
    try {
      try {
        if (connection.type === 'redis') {
          await execQuery('select', [String(dbIndex)]);
        }
      } catch {}

      const typeRes = await execQuery('type', [key]);
      const typeStr = typeRes && typeRes.success ? (Array.isArray(typeRes.data) ? (typeRes.data[0]?.value || typeRes.data[0]) : typeRes.data) : '';
      const t = typeof typeStr === 'string' ? typeStr : String(typeStr || 'string');
      setKeyType(t);
      setKeyTypes(prev => ({ ...prev, [key]: typeTo3Chars(t) }));
  
      try {
        const ttlRes = await execQuery('ttl', [key]);
        let ttlVal = undefined;
        if (ttlRes && ttlRes.success) {
          const v = Array.isArray(ttlRes.data) ? ttlRes.data[0]?.value ?? ttlRes.data[0] : ttlRes.data;
          ttlVal = Number(v);
        }
        setKeyMeta(prev => ({ ...prev, ttl: ttlVal }));
      } catch {}
  
      try {
        const exRes = await execQuery('exists', [key]);
        let existsVal = undefined;
        if (exRes && exRes.success) {
          const v = Array.isArray(exRes.data) ? exRes.data[0]?.value ?? exRes.data[0] : exRes.data;
          existsVal = Number(v) === 1;
        }
        setKeyMeta(prev => ({ ...prev, exists: existsVal }));
      } catch {}
  
      let valueRes: any = null;
      if (t === 'string') {
        valueRes = await execQuery('get', [key]);
        const val = valueRes && valueRes.success ? (Array.isArray(valueRes.data) ? (valueRes.data[0]?.value ?? valueRes.data[0]) : valueRes.data) : null;
        setKeyData(val);
      } else if (t === 'hash') {
        valueRes = await execQuery('hgetall', [key]);
        const val = valueRes && valueRes.success ? (Array.isArray(valueRes.data) ? valueRes.data[0] : valueRes.data) : null;
        setKeyData(val);
      } else if (t === 'list') {
        valueRes = await execQuery('lrange', [key, '0', '-1']);
        const val = valueRes && valueRes.success ? (Array.isArray(valueRes.data) ? valueRes.data : [valueRes.data]) : [];
        setKeyData(val);
      } else if (t === 'set') {
        valueRes = await execQuery('smembers', [key]);
        const val = valueRes && valueRes.success ? (Array.isArray(valueRes.data) ? valueRes.data : [valueRes.data]) : [];
        setKeyData(val);
      } else if (t === 'zset') {
        valueRes = await execQuery('zrange', [key, '0', '-1', 'withscores']);
        const val = valueRes && valueRes.success ? (Array.isArray(valueRes.data) ? valueRes.data : [valueRes.data]) : [];
        setKeyData(val);
      } else {
        valueRes = await execQuery('get', [key]);
        const val = valueRes && valueRes.success ? (Array.isArray(valueRes.data) ? (valueRes.data[0]?.value ?? valueRes.data[0]) : valueRes.data) : null;
        setKeyData(val);
      }
    } finally {
      setKeyLoading(false);
    }
  };

  // 保存与删除操作
  const handleSave = async () => {
    try {
      if (!poolId || !selectedKey) return;
      const newKey = editedKey && editedKey.trim();
      let targetKey = selectedKey;
      if (newKey && newKey !== selectedKey) {
        const res = await execQuery('rename', [selectedKey, newKey]);
        if (res && res.success) {
          setScan(prev => ({
            ...prev,
            keys: prev.keys.map(k => (k === selectedKey ? newKey : k))
          }));
          setSelectedKey(newKey);
          targetKey = newKey;
          setEditKeyMode(false);
          await loadKeyDetail(newKey);
        } else {
          setKeyError('重命名失败');
          return;
        }
      } else {
        console.log('[REDIS BROWSER] 保存操作：键名未变化');
      }

      // 保存不同类型的值
      if (keyType === 'string') {
        const resSet = await execQuery('set', [targetKey, String(stringValueText ?? '')]);
        if (resSet && resSet.success) {
          message.success('值已保存');
          await loadKeyDetail(targetKey);
        } else {
          setKeyError('保存值失败');
        }
      } else if (keyType === 'hash') {
        const cleaned = (hashEntries || []).filter(r => String(r.field || '').trim().length > 0);
        // 计算需删除的字段以保留TTL
        let currentFields: string[] = [];
        const kd: any = keyData;
        if (Array.isArray(kd)) {
          for (let i = 0; i < kd.length; i += 2) currentFields.push(String(kd[i] ?? ''));
        } else if (kd && typeof kd === 'object') {
          currentFields = Object.keys(kd);
        }
        const newFields = cleaned.map(r => r.field);
        const toRemove = currentFields.filter(f => !newFields.includes(f));
        if (toRemove.length > 0) await execQuery('hdel', [targetKey, ...toRemove]);
        if (cleaned.length > 0) {
          const flat = cleaned.flatMap(r => [r.field, String(r.value ?? '')]);
          const resHset = await execQuery('hset', [targetKey, ...flat]);
          if (resHset && resHset.success) {
            message.success('哈希已保存');
            await loadKeyDetail(targetKey);
          } else {
            setKeyError('保存哈希失败');
          }
        } else {
          // 无字段则删除键
          const resDel = await execQuery('del', [targetKey]);
          if (resDel && resDel.success) {
            message.success('哈希为空，已删除键');
            setSelectedKey(null);
          } else setKeyError('删除空哈希失败');
        }
      } else if (keyType === 'list') {
        const cleaned = (listElements || []).map(v => String(v ?? ''));
        // 简化处理：重建列表（可能影响TTL）
        const resDel = await execQuery('del', [targetKey]);
        if (!(resDel && resDel.success)) {
          setKeyError('清空列表失败');
          return;
        }
        if (cleaned.length > 0) {
          const resPush = await execQuery('rpush', [targetKey, ...cleaned]);
          if (resPush && resPush.success) {
            message.success('列表已保存');
            await loadKeyDetail(targetKey);
          } else {
            setKeyError('保存列表失败');
          }
        } else {
          message.success('列表为空，已清空');
          await loadKeyDetail(targetKey);
        }
      } else if (keyType === 'set') {
        const cleaned = (setMembers || []).map(v => String(v ?? '')).filter(v => v.trim().length > 0);
        const curr = Array.isArray(keyData) ? (keyData as any[]).map(v => String(v ?? '')) : [];
        const toRemove = curr.filter(m => !cleaned.includes(m));
        if (toRemove.length > 0) await execQuery('srem', [targetKey, ...toRemove]);
        if (cleaned.length > 0) {
          const resAdd = await execQuery('sadd', [targetKey, ...cleaned]);
          if (resAdd && resAdd.success) {
            message.success('集合已保存');
            await loadKeyDetail(targetKey);
          } else {
            setKeyError('保存集合失败');
          }
        } else {
          const resDel = await execQuery('del', [targetKey]);
          if (resDel && resDel.success) {
            message.success('集合为空，已删除键');
            setSelectedKey(null);
          } else setKeyError('删除空集合失败');
        }
      } else if (keyType === 'zset') {
        const cleaned = (zsetEntries || [])
          .filter(r => String(r.member || '').trim().length > 0)
          .map(r => ({ member: String(r.member), score: Number(r.score) }));
        // 计算需移除成员
        const kd: any = keyData;
        let currMembers: string[] = [];
        if (Array.isArray(kd)) {
          for (let i = 0; i < kd.length; i += 2) currMembers.push(String(kd[i] ?? ''));
        }
        const toRemove = currMembers.filter(m => !cleaned.some(r => r.member === m));
        if (toRemove.length > 0) await execQuery('zrem', [targetKey, ...toRemove]);
        if (cleaned.length > 0) {
          const flat = cleaned.flatMap(r => [r.score, r.member]);
          const resZadd = await execQuery('zadd', [targetKey, ...flat]);
          if (resZadd && resZadd.success) {
            message.success('有序集合已保存');
            await loadKeyDetail(targetKey);
          } else {
            setKeyError('保存有序集合失败');
          }
        } else {
          const resDel = await execQuery('del', [targetKey]);
          if (resDel && resDel.success) {
            message.success('有序集合为空，已删除键');
            setSelectedKey(null);
          } else setKeyError('删除空有序集合失败');
        }
      }
    } catch (e: any) {
      setKeyError(e?.message || '保存失败');
    }
  };

  const handleDelete = async () => {
    try {
      if (!poolId || !selectedKey) return;
      const res = await execQuery('del', [selectedKey]);
      if (res && res.success) {
        setScan(prev => ({
          ...prev,
          keys: prev.keys.filter(k => k !== selectedKey)
        }));
        setSelectedKey(null);
        setKeyType('');
        setKeyData(null);
        setKeyMeta({});
      } else {
        setKeyError('删除失败');
      }
    } catch (e: any) {
      setKeyError(e?.message || '删除失败');
    }
  };

  const renderKeyMeta = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
    <Space size={8} wrap>
      {keyType && <Tag color="blue">类型: {keyType}</Tag>}
      {keyMeta.exists !== undefined && <Tag color={keyMeta.exists ? 'green' : 'red'}>{keyMeta.exists ? '存在' : '不存在'}</Tag>}
      {keyMeta.ttl !== undefined && <Tag color={keyMeta.ttl && keyMeta.ttl > 0 ? 'orange' : 'default'}>TTL: {keyMeta.ttl}</Tag>}
    </Space>
    {/* 移除 JSON/Text 下拉框 */}
    {/* <Select size="small" value={valueDisplayMode} onChange={setValueDisplayMode} style={{ minWidth: 120 }}>
      <Select.Option value="json">JSON</Select.Option>
      <Select.Option value="text">Text</Select.Option>
    </Select> */}
  </div>
);

  return (
    <div style={containerStyle}>
      {/* 左侧：键列表 */}
      <div style={leftPaneStyle}>
        <RedisAddKeyModal
          visible={addVisible}
          onClose={() => setAddVisible(false)}
          connection={connection}
          activeDatabase={database}
          darkMode={darkMode}
          onCreated={() => setAddVisible(false)}
        />
        <div style={headerStyle}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Text strong>键列表</Typography.Text>
            <Space>
              <Tooltip title="每次 SCAN 返回的最大条数">
                <Typography.Text type="secondary">COUNT:</Typography.Text>
              </Tooltip>
              <div style={{ width: 160 }}>
                <input type="range" min={10} max={5000} step={10} value={scanCount} onChange={e => setScanCount(Number(e.target.value))} />
              </div>
              <Tag color="blue">{scanCount}</Tag>
              <Tag color="purple">DBSIZE: {dbSize}</Tag>
              <Tag color="cyan">已加载: {scan.keys.length}/{hardCap}</Tag>
            </Space>
          </Space>
          <div style={{ marginTop: 8 }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              {!multiEnabled && (
                <Input.Search placeholder="搜索键 (支持通配符)" allowClear onSearch={onSearch} enterButton />
              )}
              {multiEnabled && (
                <>
                  <Select
                    mode="tags"
                    style={{ width: '100%' }}
                    placeholder="输入多个 MATCH 模式，逗号分隔或敲回车生成标签"
                    value={multiPatterns}
                    onChange={(vals) => setMultiPatterns((vals as string[]).length > 0 ? (vals as string[]) : ['*'])}
                  />
                  <Space wrap>
                    <Button type="primary" onClick={() => onSearch(multiPatterns.join(','))}>搜索</Button>
                    <Space>
                      <Typography.Text type="secondary">并发数:</Typography.Text>
                      <InputNumber min={1} max={8} value={scanConcurrency} onChange={(v) => setScanConcurrency(Math.max(1, Number(v || 1)))} />
                    </Space>
                    <Space>
                      <Typography.Text type="secondary">节流(ms):</Typography.Text>
                      <InputNumber min={0} max={1000} step={10} value={scanThrottleMs} onChange={(v) => setScanThrottleMs(Math.max(0, Number(v || 0)))} />
                    </Space>
                    <Space>
                      <Typography.Text type="secondary">估计上限批次:</Typography.Text>
                      <InputNumber min={1} max={200} step={1} value={maxBatchHint} onChange={(v) => setMaxBatchHint(Math.max(1, Number(v || 1)))} />
                    </Space>
                  </Space>
                </>
              )}
              <Space wrap>
                <Switch checked={multiEnabled} onChange={setMultiEnabled} checkedChildren="多模式" unCheckedChildren="单模式" />
                <Tooltip title="使用 SCAN MATCH * 后在前端进行本次筛选，适合小数据集">
                  <Switch checked={localFilterEnabled} onChange={setLocalFilterEnabled} checkedChildren="仅本次过滤" unCheckedChildren="后端过滤" />
                </Tooltip>
                <Switch checked={autoLoad} onChange={setAutoLoad} checkedChildren="自动加载" unCheckedChildren="手动加载" />
                <Space>
                  <Typography.Text type="secondary">浏览上限:</Typography.Text>
                  <InputNumber min={1000} max={200000} step={1000} value={hardCap} onChange={(v) => setHardCap(Math.max(1000, Number(v || 1000)))} />
                </Space>
                {localFilterEnabled && (
                  <Space>
                    <Typography.Text type="secondary">阈值N:</Typography.Text>
                    <InputNumber min={100} max={50000} step={100} value={localFilterThreshold} onChange={(v) => setLocalFilterThreshold(Math.max(100, Number(v || 100)))} />
                  </Space>
                )}
                {paused ? (
                  <Button onClick={() => { scanAbortRef.current = false; setPaused(false); loadNext(); }}>恢复扫描</Button>
                ) : (
                  <Button danger onClick={() => { scanAbortRef.current = true; setPaused(true); setScan(prev => ({ ...prev, loading: false })); }}>暂停扫描</Button>
                )}
                <Button type="primary" onClick={() => setAddVisible(true)}>新增</Button>
              </Space>
              {localFilterEnabled && scan.keys.length > localFilterThreshold && (
                <Alert type="warning" showIcon message={`当前累计键数(${scan.keys.length})已超过阈值N(${localFilterThreshold})，建议关闭“仅本次过滤”以减少前端压力。`} action={<Button size="small" onClick={() => setLocalFilterEnabled(false)}>关闭本地过滤</Button>} />
              )}
              {multiEnabled && (
                <div style={{ marginTop: 8 }}>
                  <Typography.Text type="secondary">模式进度</Typography.Text>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                    {(multiPatterns.length > 0 ? multiPatterns : ['*']).map(p => {
                      const reached = !!multiState.reached[p];
                      const inFlight = !!multiInFlight[p];
                      const batches = multiBatches[p] || 0;
                      const percent = reached ? 100 : Math.min(99, Math.round((batches / maxBatchHint) * 100));
                      return (
                        <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Tag color={reached ? 'green' : (inFlight ? 'blue' : 'default')}>{p}</Tag>
                          <Typography.Text type="secondary">{inFlight ? '扫描中' : (reached ? '已完成' : '待扫描')}</Typography.Text>
                          <Progress percent={percent} size="small" style={{ flex: 1 }} />
                          <Typography.Text>匹配数: {multiCounts[p] || 0}</Typography.Text>
                          <Typography.Text type="secondary">cursor: {multiState.cursors[p] || '0'} | 批次: {batches}</Typography.Text>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Space>
          </div>
        </div>
        <div ref={scrollRef} style={scrollAreaStyle}>
          {selectingDb && <Spin style={{ marginBottom: 8 }} />}
          {scanError && (<Alert style={{ marginBottom: 8 }} type="error" showIcon message={scanError} />)}
          {displayItems.length === 0 ? (
            <Empty description="暂无键" />
          ) : (
            <div
              ref={listRef}
              style={{ height: 'calc(100vh - 360px)', overflow: 'auto', border: '1px solid var(--split-border, #f0f0f0)', borderRadius: 4 }}
              onScroll={handleListScroll}
            >
              <div style={{ height: virtualWindow.totalHeight, position: 'relative' }}>
                <div style={{ position: 'absolute', top: virtualWindow.start * itemHeight, left: 0, right: 0 }}>
                  {virtualWindow.slice.map((item, idx) => (
                    <div
                      key={item.fullPath + ':' + (virtualWindow.start + idx)}
                      style={{ height: itemHeight, display: 'flex', alignItems: 'center', padding: '0 8px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }}
                      onClick={() => item.kind === 'key' ? loadKeyDetail(item.fullPath) : togglePath(item.fullPath)}
                    >
                      <Typography.Text ellipsis style={{ flex: 1, paddingLeft: item.level * 12 }}>
                        {item.kind === 'folder' ? (expandedPaths[item.fullPath] ? '▼ ' : '▶ ') : ''}
                        {item.name}
                      </Typography.Text>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {scan.loading && (
            <div style={{ padding: 8 }}><Spin /></div>
          )}
          {!scan.loading && !scan.reachedEnd && scan.keys.length > 0 && (
            <div style={{ textAlign: 'center', padding: 8 }}>
              <Space>
                <Button onClick={loadNext}>继续扫描</Button>
                <Typography.Text type="secondary">已加载 {scan.keys.length} 项</Typography.Text>
              </Space>
            </div>
          )}
          {!scan.loading && scan.reachedEnd && scan.keys.length > 0 && (
            <div style={{ textAlign: 'center', color: '#888', padding: 8 }}>已加载全部</div>
          )}
        </div>
      </div>

      {/* 右侧：键详情 */}
      <div style={rightPaneStyle}>
        <div style={headerStyle}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Text strong>键详情</Typography.Text>
            <Typography.Text type="secondary">数据库: {database}</Typography.Text>
          </Space>
        </div>
        {/* 移除旧的中间主体块，使用新的顶部信息+值滚动区域布局 */}
        {/* 顶部信息：键展示与类型/TTL标签，固定在值展示上方 */}
        <div style={{ padding: 12 }}>
          {selectedKey && (
          <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Switch checked={editKeyMode} onChange={setEditKeyMode} checkedChildren="输入框" unCheckedChildren="标签" />
          {editKeyMode ? (
          <Input value={editedKey} onChange={e => setEditedKey(e.target.value)} style={{ maxWidth: 480 }} />
          ) : (
          <Typography.Title level={5} style={{ marginTop: 0 }}>{selectedKey}</Typography.Title>
          )}
          </div>
          {renderKeyMeta()}
          </>
          )}
          {/* 值展示区域：仅该区域滚动 */}
          <div style={{ padding: 12, overflow: 'auto', height: 'calc(100vh - 360px)' }}>
          {!selectedKey && (
          <Empty description="请选择左侧的一个键" />
          )}
          {selectedKey && (
          <>
          <Divider style={{ margin: '12px 0' }} />
          {keyError && <Alert type="error" message={keyError} showIcon style={{ marginBottom: 12 }} />}
          {keyLoading ? (
          <Spin />
          ) : (
          <>
          {keyType === 'string' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <Space size={8} wrap>
                  <Button onClick={() => setStringEditing(v => !v)}>{stringEditing ? '查看' : '编辑'}</Button>
                  <Button onClick={copyString} disabled={!selectedKey}>复制</Button>
                  <Button onClick={formatStringIfJson} disabled={!selectedKey}>格式化 JSON</Button>
                </Space>
                <Space>
                  <Switch checked={stringWrap} onChange={setStringWrap} checkedChildren="换行" unCheckedChildren="单行" />
                </Space>
              </div>
              {stringEditing ? (
                <Input.TextArea value={stringValueText} onChange={e => setStringValueText(e.target.value)} autoSize={{ minRows: 6 }} />
              ) : (
                <pre style={{ margin: 0, padding: 12, whiteSpace: stringWrap ? 'pre-wrap' : 'pre', wordBreak: 'break-word' }}>{stringValueText}</pre>
              )}
            </>
          )}
          {keyType === 'hash' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <Space wrap>
                  <Button onClick={() => setHashEntries(prev => [...prev, { field: '', value: '' }])}>添加行</Button>
                  <Button onClick={() => {
                    if (hashSelected >= 0) setHashEntries(prev => prev.filter((_, i) => i !== hashSelected));
                  }} disabled={hashSelected < 0}>删除选中</Button>
                  <Button onClick={() => {
                    if (hashSelected > 0) {
                      setHashEntries(prev => {
                        const arr = [...prev];
                        const tmp = arr[hashSelected];
                        arr[hashSelected] = arr[hashSelected - 1];
                        arr[hashSelected - 1] = tmp;
                        return arr;
                      });
                      setHashSelected(hashSelected - 1);
                    }
                  }} disabled={hashSelected <= 0}>上移</Button>
                  <Button onClick={() => {
                    if (hashSelected >= 0 && hashSelected < hashEntries.length - 1) {
                      setHashEntries(prev => {
                        const arr = [...prev];
                        const tmp = arr[hashSelected];
                        arr[hashSelected] = arr[hashSelected + 1];
                        arr[hashSelected + 1] = tmp;
                        return arr;
                      });
                      setHashSelected(hashSelected + 1);
                    }
                  }} disabled={hashSelected < 0 || hashSelected >= hashEntries.length - 1}>下移</Button>
                </Space>
              </div>
              <div>
                {hashEntries.map((row, idx) => (
                  <div key={idx} onClick={() => setHashSelected(idx)} style={{ display: 'flex', gap: 8, padding: 6, border: '1px solid #f0f0f0', marginBottom: 4, background: hashSelected === idx ? 'var(--selected-bg, #fafafa)' : undefined }}>
                    <Tag color="purple">{idx}</Tag>
                    <Input placeholder="字段" value={row.field} onChange={e => {
                      const v = e.target.value;
                      setHashEntries(prev => { const arr = [...prev]; arr[idx] = { ...arr[idx], field: v }; return arr; });
                    }} style={{ width: 200 }} />
                    <Input placeholder="值" value={row.value} onChange={e => {
                      const v = e.target.value;
                      setHashEntries(prev => { const arr = [...prev]; arr[idx] = { ...arr[idx], value: v }; return arr; });
                    }} />
                  </div>
                ))}
              </div>
            </>
          )}
          {keyType === 'list' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <Space wrap>
                  <Button onClick={() => setListElements(prev => [...prev, ''])}>添加元素</Button>
                  <Button onClick={() => {
                    if (listSelected >= 0) setListElements(prev => prev.filter((_, i) => i !== listSelected));
                  }} disabled={listSelected < 0}>删除选中</Button>
                  <Button onClick={() => {
                    if (listSelected > 0) {
                      setListElements(prev => {
                        const arr = [...prev];
                        const tmp = arr[listSelected];
                        arr[listSelected] = arr[listSelected - 1];
                        arr[listSelected - 1] = tmp;
                        return arr;
                      });
                      setListSelected(listSelected - 1);
                    }
                  }} disabled={listSelected <= 0}>上移</Button>
                  <Button onClick={() => {
                    if (listSelected >= 0 && listSelected < listElements.length - 1) {
                      setListElements(prev => {
                        const arr = [...prev];
                        const tmp = arr[listSelected];
                        arr[listSelected] = arr[listSelected + 1];
                        arr[listSelected + 1] = tmp;
                        return arr;
                      });
                      setListSelected(listSelected + 1);
                    }
                  }} disabled={listSelected < 0 || listSelected >= listElements.length - 1}>下移</Button>
                </Space>
              </div>
              <div>
                {listElements.map((item, idx) => (
                  <div key={idx} onClick={() => setListSelected(idx)} style={{ display: 'flex', gap: 8, padding: 6, border: '1px solid #f0f0f0', marginBottom: 4, background: listSelected === idx ? 'var(--selected-bg, #fafafa)' : undefined }}>
                    <Tag color="blue">{idx}</Tag>
                    <Input placeholder="元素" value={item} onChange={e => {
                      const v = e.target.value;
                      setListElements(prev => { const arr = [...prev]; arr[idx] = v; return arr; });
                    }} />
                  </div>
                ))}
              </div>
            </>
          )}
          {keyType === 'set' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <Space wrap>
                  <Button onClick={() => setSetMembers(prev => [...prev, ''])}>添加成员</Button>
                  <Button onClick={() => {
                    if (setSelected >= 0) setSetMembers(prev => prev.filter((_, i) => i !== setSelected));
                  }} disabled={setSelected < 0}>删除选中</Button>
                </Space>
              </div>
              <div>
                {setMembers.map((item, idx) => (
                  <div key={idx} onClick={() => setSetSelected(idx)} style={{ display: 'flex', gap: 8, padding: 6, border: '1px solid #f0f0f0', marginBottom: 4, background: setSelected === idx ? 'var(--selected-bg, #fafafa)' : undefined }}>
                    <Tag color="green">{idx}</Tag>
                    <Input placeholder="成员" value={item} onChange={e => {
                      const v = e.target.value;
                      setSetMembers(prev => { const arr = [...prev]; arr[idx] = v; return arr; });
                    }} />
                  </div>
                ))}
              </div>
            </>
          )}
          {keyType === 'zset' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <Space wrap>
                  <Button onClick={() => setZsetEntries(prev => [...prev, { member: '', score: 0 }])}>添加成员</Button>
                  <Button onClick={() => {
                    if (zsetSelected >= 0) setZsetEntries(prev => prev.filter((_, i) => i !== zsetSelected));
                  }} disabled={zsetSelected < 0}>删除选中</Button>
                  <Button onClick={() => {
                    if (zsetSelected > 0) {
                      setZsetEntries(prev => {
                        const arr = [...prev];
                        const tmp = arr[zsetSelected];
                        arr[zsetSelected] = arr[zsetSelected - 1];
                        arr[zsetSelected - 1] = tmp;
                        return arr;
                      });
                      setZsetSelected(zsetSelected - 1);
                    }
                  }} disabled={zsetSelected <= 0}>上移</Button>
                  <Button onClick={() => {
                    if (zsetSelected >= 0 && zsetSelected < zsetEntries.length - 1) {
                      setZsetEntries(prev => {
                        const arr = [...prev];
                        const tmp = arr[zsetSelected];
                        arr[zsetSelected] = arr[zsetSelected + 1];
                        arr[zsetSelected + 1] = tmp;
                        return arr;
                      });
                      setZsetSelected(zsetSelected + 1);
                    }
                  }} disabled={zsetSelected < 0 || zsetSelected >= zsetEntries.length - 1}>下移</Button>
                </Space>
              </div>
              <div>
                {zsetEntries.map((row, idx) => (
                  <div key={idx} onClick={() => setZsetSelected(idx)} style={{ display: 'flex', gap: 8, padding: 6, border: '1px solid #f0f0f0', marginBottom: 4, background: zsetSelected === idx ? 'var(--selected-bg, #fafafa)' : undefined }}>
                    <Tag color="gold">{idx}</Tag>
                    <Input placeholder="成员" value={row.member} onChange={e => {
                      const v = e.target.value;
                      setZsetEntries(prev => { const arr = [...prev]; arr[idx] = { ...arr[idx], member: v }; return arr; });
                    }} style={{ width: 260 }} />
                    <InputNumber placeholder="分数" value={row.score} onChange={(v) => {
                      const s = Number(v ?? 0);
                      setZsetEntries(prev => { const arr = [...prev]; arr[idx] = { ...arr[idx], score: isNaN(s) ? 0 : s }; return arr; });
                    }} />
                  </div>
                ))}
              </div>
            </>
          )}
          {!['string','hash','list','set','zset'].includes(keyType || '') && (
            valueDisplayMode === 'json' ? (
              <JsonPreview value={keyData} />
            ) : (
              <TextPreview value={keyData} />
            )
          )}
          </>
          )
          }
          </>
          )}
        </div>
        </div>
        {/* 底部操作栏：固定底部 */}
        <div style={{ borderTop: '1px solid var(--split-border, #f0f0f0)', padding: 8, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="primary" onClick={handleSave} disabled={!selectedKey}>保存</Button>
          <Button danger onClick={handleDelete} disabled={!selectedKey}>删除</Button>
        </div>
      </div>
    </div>
    );
};

export default RedisDataBrowser;