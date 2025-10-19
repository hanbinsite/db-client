import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input, List, Spin, Empty, Typography, Tag, Space, Divider, Alert } from 'antd';
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

const PAGE_COUNT = 200;

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
  overflow: 'auto'
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

  // ensure connected pool
  useEffect(() => {
    let cancelled = false;
    const ensurePool = async () => {
      try {
        let pid = poolId;
        console.log('[REDIS BROWSER] ensurePool start, current poolId:', pid, 'connId:', connection.connectionId);
        if (!pid) {
          const res = await (window as any).electronAPI?.connectDatabase(connection);
          console.log('[REDIS BROWSER] connectDatabase result:', res);
          if (res && res.success && res.connectionId) {
            pid = res.connectionId;
            connection.connectionId = pid;
            connection.isConnected = true;
          } else {
            const databaseName = connection.database || '';
            pid = `${connection.type}_${connection.host}_${connection.port}_${databaseName}`;
            console.warn('[REDIS BROWSER] using fallback poolId:', pid);
          }
        }
        if (!cancelled) {
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
        setSelectingDb(false);
        setScan(prev => ({ cursor: '0', keys: [], loading: false, reachedEnd: false, pattern: prev.pattern || '*' }));
        setTimeout(() => { loadNext(); }, 0);
        setSelectedKey(null);
        setKeyType('');
        setKeyData(null);
        setKeyMeta({});
        setKeyError('');
      }
    };
    selectDb();
  }, [poolId, connection.type, dbIndex]);

  const loadNext = async () => {
    if (scan.loading || scan.reachedEnd || !poolId || selectingDb) {
      console.log('[REDIS BROWSER] loadNext guard hit', { loading: scan.loading, reachedEnd: scan.reachedEnd, poolId, selectingDb });
      return;
    }
    setScan(prev => ({ ...prev, loading: true }));
    try {
      const params = ['' + scan.cursor, 'MATCH', scan.pattern || '*', 'COUNT', String(PAGE_COUNT)];
      console.log('[REDIS BROWSER] SCAN params:', params);
      const res = await (window as any).electronAPI?.executeQuery(poolId, 'scan', params);
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
        // Fallback: if SCAN returns empty and finished immediately, try KEYS once
        if (keysNormalized.length === 0 && String(nextCursor) === '0' && scan.cursor === '0') {
          try {
            const keysRes = await (window as any).electronAPI?.executeQuery(poolId, 'keys', [scan.pattern || '*']);
            console.log('[REDIS BROWSER] SCAN empty, fallback KEYS result JSON:', safeStringify(keysRes));
            if (keysRes && keysRes.success) {
              const kd = keysRes.data;
              // keys 命令通常返回字符串数组或被包装成 [{value: 'key'}]
              if (Array.isArray(kd)) {
                if (kd.length > 0 && typeof kd[0] === 'object' && kd[0] && 'value' in kd[0]) {
                  keysNormalized = kd.map((x: any) => toStr(x));
                } else {
                  keysNormalized = kd.map((x: any) => toStr(x));
                }
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
      }
    } catch (e) {
      console.error('[REDIS BROWSER] SCAN error:', e);
      setScan(prev => ({ ...prev, loading: false }));
    }
  };

  // immediate search executor to avoid stale state
  const performSearch = async (pattern: string) => {
    if (!poolId || selectingDb) {
      console.log('[REDIS BROWSER] performSearch guard hit', { poolId, selectingDb });
      return;
    }
    // reset and mark loading
    setScan({ cursor: '0', keys: [], loading: true, reachedEnd: false, pattern });
    try {
      const params = ['0', 'MATCH', pattern || '*', 'COUNT', String(PAGE_COUNT)];
      console.log('[REDIS BROWSER] SEARCH SCAN params:', params);
      const res = await (window as any).electronAPI?.executeQuery(poolId, 'scan', params);
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
          try {
            const keysRes = await (window as any).electronAPI?.executeQuery(poolId, 'keys', [pattern || '*']);
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

  // initial load
  useEffect(() => {
    console.log('[REDIS BROWSER] initial load, reset scan state');
    setScan({ cursor: '0', keys: [], loading: false, reachedEnd: false, pattern: '*' });
  }, [poolId, dbIndex]);

  useEffect(() => {
    if (poolId) {
      console.log('[REDIS BROWSER] triggering initial loadNext with poolId:', poolId);
      loadNext();
    }
  }, [poolId]);

  // scroll handler for infinite load
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const handler = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 100) {
        console.log('[REDIS BROWSER] list scroll near bottom, loadNext');
        loadNext();
      }
    };
    el.addEventListener('scroll', handler);
    return () => el.removeEventListener('scroll', handler);
  }, [listRef, scan.loading, scan.reachedEnd, poolId]);

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
            const typeStr = typeRes && typeRes.success ? (Array.isArray(typeRes.data) ? (typeRes.data[0]?.value ?? typeRes.data[0]) : typeRes.data) : '';
            const t = typeof typeStr === 'string' ? typeStr : String(typeStr || '');
            updates[key] = typeTo3Chars(t);
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

  // search
  const onSearch = async (value: string) => {
    const pattern = value && value.trim() ? value.trim() : '*';
    console.log('[REDIS BROWSER] onSearch pattern:', pattern);
    await performSearch(pattern);
  };

  // key select -> load type + value
  const loadKeyDetail = async (key: string) => {
    if (!poolId || !key) return;
    setSelectedKey(key);
    setKeyLoading(true);
    setKeyError('');
    setKeyData(null);
    setKeyMeta({});
    try {
      // type
      const typeRes = await (window as any).electronAPI?.executeQuery(poolId, 'type', [key]);
      const typeStr = typeRes && typeRes.success ? (Array.isArray(typeRes.data) ? (typeRes.data[0]?.value || typeRes.data[0]) : typeRes.data) : '';
      const t = typeof typeStr === 'string' ? typeStr : String(typeStr || 'string');
      setKeyType(t);
      setKeyTypes(prev => ({ ...prev, [key]: typeTo3Chars(t) }));
  
      // ttl
      try {
        const ttlRes = await (window as any).electronAPI?.executeQuery(poolId, 'ttl', [key]);
        let ttlVal = undefined;
        if (ttlRes && ttlRes.success) {
          const v = Array.isArray(ttlRes.data) ? ttlRes.data[0]?.value ?? ttlRes.data[0] : ttlRes.data;
          ttlVal = Number(v);
        }
        setKeyMeta(prev => ({ ...prev, ttl: ttlVal }));
      } catch {}
  
      // exists
      try {
        const exRes = await (window as any).electronAPI?.executeQuery(poolId, 'exists', [key]);
        let existsVal = undefined;
        if (exRes && exRes.success) {
          const v = Array.isArray(exRes.data) ? exRes.data[0]?.value ?? exRes.data[0] : exRes.data;
          existsVal = Number(v) === 1;
        }
        setKeyMeta(prev => ({ ...prev, exists: existsVal }));
      } catch {}
  
      // value by type
      let valueRes: any = null;
      if (t === 'string') {
        valueRes = await (window as any).electronAPI?.executeQuery(poolId, 'get', [key]);
        const val = valueRes && valueRes.success ? (Array.isArray(valueRes.data) ? (valueRes.data[0]?.value ?? valueRes.data[0]) : valueRes.data) : null;
        setKeyData(val);
      } else if (t === 'hash') {
        valueRes = await (window as any).electronAPI?.executeQuery(poolId, 'hgetall', [key]);
        const val = valueRes && valueRes.success ? (Array.isArray(valueRes.data) ? valueRes.data[0] : valueRes.data) : null;
        setKeyData(val);
      } else if (t === 'list') {
        valueRes = await (window as any).electronAPI?.executeQuery(poolId, 'lrange', [key, '0', '-1']);
        const val = valueRes && valueRes.success ? (Array.isArray(valueRes.data) ? valueRes.data : [valueRes.data]) : [];
        setKeyData(val);
      } else if (t === 'set') {
        valueRes = await (window as any).electronAPI?.executeQuery(poolId, 'smembers', [key]);
        const val = valueRes && valueRes.success ? (Array.isArray(valueRes.data) ? valueRes.data : [valueRes.data]) : [];
        setKeyData(val);
      } else if (t === 'zset') {
        // Try WITHSCORES, will gracefully fall back
        valueRes = await (window as any).electronAPI?.executeQuery(poolId, 'zrange', [key, '0', '-1', 'withscores']);
        const val = valueRes && valueRes.success ? (Array.isArray(valueRes.data) ? valueRes.data : [valueRes.data]) : [];
        setKeyData(val);
      } else {
        // default attempt GET
        valueRes = await (window as any).electronAPI?.executeQuery(poolId, 'get', [key]);
        const val = valueRes && valueRes.success ? (Array.isArray(valueRes.data) ? (valueRes.data[0]?.value ?? valueRes.data[0]) : valueRes.data) : null;
        setKeyData(val);
      }
    } catch (e: any) {
      setKeyError(e?.message || '加载键详情失败');
    } finally {
      setKeyLoading(false);
    }
  };

  const renderKeyMeta = () => (
    <Space size={8} wrap style={{ marginTop: 8 }}>
      {keyType && <Tag color="blue">类型: {keyType}</Tag>}
      {keyMeta.exists !== undefined && <Tag color={keyMeta.exists ? 'green' : 'red'}>{keyMeta.exists ? '存在' : '不存在'}</Tag>}
      {keyMeta.ttl !== undefined && <Tag color={keyMeta.ttl && keyMeta.ttl > 0 ? 'orange' : 'default'}>TTL: {keyMeta.ttl}</Tag>}
    </Space>
  );

  return (
    <div style={containerStyle}>
      {/* 左侧：键列表 */}
      <div style={leftPaneStyle}>
        <div style={headerStyle}>
          <Space style={{ width: '100%' }}>
            <Typography.Text strong>键列表</Typography.Text>
          </Space>
          <div style={{ marginTop: 8 }}>
            <Input.Search placeholder="搜索键 (支持通配符)" allowClear onSearch={onSearch} enterButton />
          </div>
        </div>
        <div ref={scrollRef} style={scrollAreaStyle}>
          {selectingDb && <Spin style={{ marginBottom: 8 }} />}
          <div ref={listRef} style={{ height: 'calc(100vh - 330px)', overflow: 'auto' }}>
            <List
              size="small"
              bordered
              dataSource={scan.keys}
              locale={{ emptyText: '暂无键' }}
              renderItem={(item) => (
                <List.Item style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => loadKeyDetail(item)}>
                  <Tag color={typeColorForLabel(keyTypes[item])} style={{ minWidth: 36, textAlign: 'center' }}>{keyTypes[item] || 'UNK'}</Tag>
                  <Typography.Text ellipsis style={{ flex: 1 }}>{item}</Typography.Text>
                </List.Item>
              )}
            />
          </div>
          {scan.loading && (
            <div style={{ padding: 8 }}><Spin /></div>
          )}
          {/* 移除重复的空状态展示，统一使用 List 的 emptyText */}
          
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
        <div style={{ padding: 12, overflow: 'auto', flex: 1 }}>
          {!selectedKey && (
            <Empty description="请选择左侧的一个键" />
          )}
          {selectedKey && (
            <>
              <Typography.Title level={5} style={{ marginTop: 0 }}>{selectedKey}</Typography.Title>
              {renderKeyMeta()}
              <Divider style={{ margin: '12px 0' }} />
              {keyError && <Alert type="error" message={keyError} showIcon style={{ marginBottom: 12 }} />}
              {keyLoading ? (
                <Spin />
              ) : (
                <>
                  {keyType === 'string' && (
                    <JsonPreview value={keyData} />
                  )}
                  {keyType === 'hash' && (
                    <JsonPreview value={keyData} />
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
                  {/* Fallback render */}
                  {!['string','hash','list','set','zset'].includes(keyType || '') && (
                    <JsonPreview value={keyData} />
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default RedisDataBrowser;