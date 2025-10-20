import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input, List, Spin, Empty, Typography, Tag, Space, Divider, Alert, Button, Switch, Select, message, InputNumber, Tooltip, Progress } from 'antd';
import type { DatabaseConnection } from '../../types';

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
const serialChainRef = useRef<Promise<void>>(Promise.resolve());
const execQuery = async (query: string, params?: any[]) => {
  if (!poolId) throw new Error('Pool not ready');
  const runOnce = async (pid: string) => (window as any).electronAPI?.executeQuery(pid, query, params);
  const runWithReconnect = async () => {
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
          console.log('[REDIS BROWSER] reconnect success, new poolId:', currentPid);
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
  if (connection.type === 'redis' && maxConnections <= 1) {
    let result: any;
    const p = serialChainRef.current.then(async () => { result = await runWithReconnect(); });
    serialChainRef.current = p.catch(() => {});
    await p;
    return result;
  }
  return await runWithReconnect();
};
useEffect(() => {
  (async () => {
    try {
      if ((window as any).electronAPI?.getConnectionPoolConfig && poolId) {
        const resp = await (window as any).electronAPI.getConnectionPoolConfig(poolId);
        const mc = (resp && resp.success && resp.config && typeof resp.config.maxConnections === 'number') ? resp.config.maxConnections : 1;
        setMaxConnections(mc);
        console.log('[REDIS BROWSER] pool maxConnections:', mc);
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

  const togglePath = (p: string) => {
    setExpandedPaths(prev => ({ ...prev, [p]: !prev[p] }));
  };

  // ensure connected pool
  useEffect(() => {
    let cancelled = false;
    const ensurePool = async () => {
      try {
        let pid = poolId;
        console.log('[REDIS BROWSER] ensurePool start, current poolId:', pid, 'connId:', connection.connectionId);
        if (!pid) {
          // 优先尝试创建连接池
          const res = await (window as any).electronAPI?.connectDatabase?.(connection);
          console.log('[REDIS BROWSER] connectDatabase result:', res);
          if (res && res.success && res.connectionId) {
            pid = res.connectionId;
            connection.connectionId = pid;
            connection.isConnected = true;
          } else {
            // 回退：仅在确有现有连接池时采用生成的ID
            const generatedId = `${connection.type}_${connection.host}_${connection.port}_${connection.database || ''}`;
            try {
              const cfgRes = await (window as any).electronAPI?.getConnectionPoolConfig?.(generatedId);
              if (cfgRes && cfgRes.success) {
                pid = generatedId;
                console.warn('[REDIS BROWSER] adopting existing poolId via generatedId:', generatedId);
              } else {
                console.warn('[REDIS BROWSER] no existing pool found for generatedId, keep poolId undefined');
              }
            } catch (e) {
              console.warn('[REDIS BROWSER] getConnectionPoolConfig error:', e);
            }
          }
        }
        if (!cancelled && pid) {
          console.log('[REDIS BROWSER] ensurePool set poolId:', pid);
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
      console.log('[REDIS BROWSER] selecting DB index:', dbIndex, 'poolId:', poolId);
      try {
        const res = await (window as any).electronAPI?.executeQuery(poolId, 'select', [String(dbIndex)]);
        console.log('[REDIS BROWSER] select result JSON:', safeStringify(res));
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
        setSelectedKey(null);
        setKeyType('');
        setKeyData(null);
        setKeyMeta({});
        setKeyError('');
        setScanError('');
        // 查询当前DB键数量，以决定是否允许 KEYS 回退
        try {
          const sizeRes = await execQuery('dbsize', []);
          let sizeVal = 0;
          if (sizeRes && sizeRes.success) {
            const d = sizeRes.data;
            if (typeof d === 'number') {
              sizeVal = d;
            } else if (Array.isArray(d) && d.length > 0) {
              const first = d[0];
              if (typeof first === 'number') sizeVal = first;
              else if (first && typeof first === 'object' && typeof (first as any).value === 'number') sizeVal = Number((first as any).value);
            } else if (d && typeof d === 'object' && typeof (d as any).value === 'number') {
              sizeVal = Number((d as any).value);
            } else {
              const n = Number(d as any);
              if (Number.isFinite(n)) sizeVal = n;
            }
          }
          setDbSize(Number.isFinite(sizeVal) ? sizeVal : 0);
          console.log('[REDIS BROWSER] dbsize:', sizeVal);
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
  }, [poolId, connection.type, dbIndex]);

  const loadNext = async () => {
    if (scan.loading || scan.reachedEnd || !poolId || selectingDb) {
      console.log('[REDIS BROWSER] loadNext guard hit', { loading: scan.loading, reachedEnd: scan.reachedEnd, poolId, selectingDb });
      return;
    }
    if (scanAbortRef.current) {
      console.log('[REDIS BROWSER] loadNext aborted');
      setScan(prev => ({ ...prev, loading: false }));
      return;
    }
    if (hardCap > 0 && scan.keys.length >= hardCap) {
      console.log('[REDIS BROWSER] loadNext reached hard cap', hardCap);
      setScan(prev => ({ ...prev, loading: false, reachedEnd: true }));
      message.warning(`达到浏览上限 ${hardCap} 项，已停止扫描`);
      return;
    }
    // 节流：多模式或本地过滤路径在两次批次之间等待 scanThrottleMs
    if ((multiEnabled || localFilterEnabled) && scanThrottleMs > 0) {
      const now = Date.now();
      if (now - (lastBatchAtRef.current || 0) < scanThrottleMs) {
        console.log('[REDIS BROWSER] throttle guard, wait', scanThrottleMs, 'ms');
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
            console.log('[REDIS BROWSER] SCAN(multi-concurrent) params:', params);
            const res = await execQuery('scan', params);
            console.log('[REDIS BROWSER] SCAN(multi-concurrent) raw JSON:', safeStringify(res));
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
                    console.log('[REDIS BROWSER] SCAN empty, fallback KEYS result JSON:', safeStringify(keysRes));
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
              console.log('[REDIS BROWSER] SCAN parsed -> nextCursor:', nextCursor, 'keys count:', keysNormalized.length);
              setScan(prev => ({
                cursor: String(nextCursor),
                keys: [...prev.keys, ...keysNormalized],
                loading: false,
                reachedEnd: String(nextCursor) === '0',
                pattern: prev.pattern
              }));
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
        console.log('[REDIS BROWSER] SCAN(local-filter) params:', params, 'patterns:', multiEnabled ? multiPatterns : filterPatterns);
        const res = await execQuery('scan', params);
        console.log('[REDIS BROWSER] SCAN(local-filter) raw JSON:', safeStringify(res));
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
            cursor: String(nextCursor),
            keys: [...prev.keys, ...filtered.filter(k => !prev.keys.includes(k))],
            loading: false,
            reachedEnd: String(nextCursor) === '0',
            pattern: '*'
          }));
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
      console.log('[REDIS BROWSER] SCAN params:', params);
      const res = await execQuery('scan', params);
      console.log('[REDIS BROWSER] SCAN raw result JSON:', safeStringify(res));
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
            console.log('[REDIS BROWSER] SCAN empty, fallback KEYS result JSON:', safeStringify(keysRes));
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
        console.log('[REDIS BROWSER] SCAN parsed -> nextCursor:', nextCursor, 'keys count:', keysNormalized.length);
        setScan(prev => ({
          cursor: String(nextCursor),
          keys: [...prev.keys, ...keysNormalized],
          loading: false,
          reachedEnd: String(nextCursor) === '0',
          pattern: prev.pattern
        }));
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
  };

  // immediate search executor to avoid stale state
  const performSearch = async (pattern: string) => {
    if (!poolId || selectingDb) {
      console.log('[REDIS BROWSER] performSearch guard hit', { poolId, selectingDb });
      return;
    }

    // 多模式 + 本地过滤：用'*'扫描、前端筛选
    if (multiEnabled && localFilterEnabled) {
      const patterns = (multiPatterns && multiPatterns.length > 0) ? multiPatterns : (pattern ? pattern.split(',').map(s => s.trim()).filter(Boolean) : ['*']);
      setFilterPatterns(patterns);
      setMultiCounts({});
      setScan({ cursor: '0', keys: [], loading: true, reachedEnd: false, pattern: '*' });
      try {
        const params = ['0', 'MATCH', '*', 'COUNT', String(scanCount)];
        console.log('[REDIS BROWSER] SEARCH SCAN(local-filter multi) params:', params);
        const res = await execQuery('scan', params);
        console.log('[REDIS BROWSER] SEARCH SCAN(local-filter multi) raw JSON:', safeStringify(res));
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
          setScan({
            cursor: String(nextCursor),
            keys: filtered,
            loading: false,
            reachedEnd: String(nextCursor) === '0',
            pattern: '*'
          });
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
      try {
        const p0 = patterns[0] || '*';
        const params = ['0', 'MATCH', p0, 'COUNT', String(scanCount)];
        console.log('[REDIS BROWSER] SEARCH SCAN(multi init) params:', params);
        const res = await execQuery('scan', params);
        console.log('[REDIS BROWSER] SEARCH SCAN(multi init) raw JSON:', safeStringify(res));
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
          setScan({
            cursor: '0',
            keys: keysNormalized,
            loading: false,
            reachedEnd: false,
            pattern: p0
          });
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
    try {
      const params = ['0', 'MATCH', pattern || '*', 'COUNT', String(scanCount)];
      console.log('[REDIS BROWSER] SEARCH SCAN params:', params);
      const res = await execQuery('scan', params);
      console.log('[REDIS BROWSER] SEARCH SCAN raw result JSON:', safeStringify(res));
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
          console.warn('[REDIS BROWSER] Unexpected SEARCH SCAN data format, data JSON:', safeStringify(data));
        }
        let keysNormalized: string[] = (keys || []).map((k: any) => toStr(k));
        if (keysNormalized.length === 0 && String(nextCursor) === '0') {
          if (dbSize > 0 && dbSize <= SAFE_KEYS_FALLBACK_LIMIT) {
            try {
              const keysRes = await execQuery('keys', [pattern || '*']);
              console.log('[REDIS BROWSER] SEARCH SCAN empty, fallback KEYS result JSON:', safeStringify(keysRes));
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
        console.log('[REDIS BROWSER] SEARCH parsed -> nextCursor:', nextCursor, 'keys count:', keysNormalized.length);
        setScan({
          cursor: String(nextCursor),
          keys: keysNormalized,
          loading: false,
          reachedEnd: String(nextCursor) === '0',
          pattern
        });
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
      console.log('[REDIS BROWSER] onSearch multi patterns:', patterns, 'localFilter:', localFilterEnabled);
      await performSearch(patterns[0] || '*');
    } else {
      if (localFilterEnabled) setFilterPatterns([raw]);
      console.log('[REDIS BROWSER] onSearch pattern:', raw, 'localFilter:', localFilterEnabled);
      await performSearch(raw);
    }
  };

  // initial load
  useEffect(() => {
    console.log('[REDIS BROWSER] initial load, reset scan state');
    setScan({ cursor: '0', keys: [], loading: false, reachedEnd: false, pattern: '*' });
    setMultiState({ cursors: {}, reached: {}, index: 0 });
    setMultiCounts({});
    setMultiInFlight({});
    setMultiBatches({});
    lastBatchAtRef.current = 0;
  }, [poolId, dbIndex]);

  useEffect(() => {
    if (poolId && !selectingDb) {
      console.log('[REDIS BROWSER] triggering initial loadNext with poolId:', poolId);
      loadNext();
    } else {
      console.log('[REDIS BROWSER] skip initial loadNext due to selectingDb:', selectingDb);
    }
  }, [poolId, selectingDb]);

  // scroll handler for infinite load
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const handler = () => {
      if (!autoLoad || scanAbortRef.current) return;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
        console.log('[REDIS BROWSER] list scroll near bottom, loadNext');
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
            const typeRes = await (window as any).electronAPI?.executeQuery(poolId, 'type', [key]);
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
    console.log('[REDIS BROWSER] onSearch pattern:', pattern);
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
        const res = await (window as any).electronAPI?.executeQuery(poolId, 'rename', [selectedKey, newKey]);
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

      // 如果是字符串类型，保存编辑后的值
      if (keyType === 'string') {
        const resSet = await (window as any).electronAPI?.executeQuery(poolId, 'set', [targetKey, String(stringValueText ?? '')]);
        if (resSet && resSet.success) {
          message.success('值已保存');
          await loadKeyDetail(targetKey);
        } else {
          setKeyError('保存值失败');
        }
      }
    } catch (e: any) {
      setKeyError(e?.message || '保存失败');
    }
  };

  const handleDelete = async () => {
    try {
      if (!poolId || !selectedKey) return;
      const res = await (window as any).electronAPI?.executeQuery(poolId, 'del', [selectedKey]);
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
        <div style={headerStyle}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Typography.Text strong>键列表</Typography.Text>
            <Space>
              <Typography.Text type="secondary">COUNT:</Typography.Text>
              {/* COUNT 滑条 */}
              <div style={{ width: 160 }}>
                {/* 使用原生range替代Slider避免额外导入 */}
                <input type="range" min={10} max={5000} step={10} value={scanCount} onChange={e => setScanCount(Number(e.target.value))} />
              </div>
              <Tag color="purple">DBSIZE: {dbSize}</Tag>
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
          <div ref={listRef} style={{ height: 'calc(100vh - 330px)', overflow: 'auto' }}>
            {scanError && (<Alert style={{ marginBottom: 8 }} type="error" showIcon message={scanError} />)}
            <List
              size="small"
              bordered
              dataSource={displayItems}
              locale={{ emptyText: '暂无键' }}
              renderItem={(item) => (
                <List.Item
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  onClick={() => item.kind === 'key' ? loadKeyDetail(item.fullPath) : togglePath(item.fullPath)}
                >
                  <Typography.Text ellipsis style={{ flex: 1, paddingLeft: item.level * 12 }}>
                    {item.kind === 'folder' ? (expandedPaths[item.fullPath] ? '▼ ' : '▶ ') : ''}
                    {item.name}
                  </Typography.Text>
                </List.Item>
              )}
            />
          </div>
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
          valueDisplayMode === 'json' ? (
          <JsonPreview value={keyData} />
          ) : (
          <TextPreview value={keyData} />
          )
          )}
          {keyType === 'list' && Array.isArray(keyData) && (
          <List size="small" bordered dataSource={keyData as any[]} renderItem={item => (
          <List.Item>
          <Typography.Text>{String(item)}</Typography.Text>
          </List.Item>
          )} />
          )}
          {keyType === 'set' && Array.isArray(keyData) && (
          <List size="small" bordered dataSource={keyData as any[]} renderItem={item => (
          <List.Item>
          <Typography.Text>{String(item)}</Typography.Text>
          </List.Item>
          )} />
          )}
          {keyType === 'zset' && Array.isArray(keyData) && (
          <List size="small" bordered dataSource={keyData as any[]} renderItem={(item, idx) => (
          <List.Item>
          <Space>
          <Tag color="blue">{idx}</Tag>
          <Typography.Text>{typeof item === 'object' ? JSON.stringify(item) : String(item)}</Typography.Text>
          </Space>
          </List.Item>
          )} />
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