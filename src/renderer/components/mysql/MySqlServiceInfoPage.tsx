import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Col, Divider, Row, Space, Statistic, Tag, Typography, message, Table, Input, InputNumber, Select, Button, Checkbox, Popconfirm, Pagination, Tabs } from 'antd';
import { DatabaseInfo, DatabaseConnection } from '../../types';

// 颜色常量
const GREEN = '#52c41a';
const ORANGE = '#fa8c16';
const RED = '#f5222d';

// 阈值颜色映射
const getTierColor = (value: number, thresholds: [number, number]) => {
  const [t1, t2] = thresholds;
  if (value < t1) return GREEN;
  if (value < t2) return ORANGE;
  return RED;
};

// 滑动平均
const movingAverage = (series: number[], windowSize: number) => {
  if (!series || series.length === 0) return 0;
  const len = Math.min(series.length, windowSize);
  const sum = series.slice(series.length - len).reduce((a, b) => a + b, 0);
  return Number((sum / len).toFixed(2));
};

// 轻量级趋势图（Sparkline）
const Sparkline: React.FC<{ data: number[]; color?: string; height?: number }> = ({ data, color = '#1890ff', height = 60 }) => {
  const n = data?.length || 0;
  if (n < 2) return <Typography.Text type="secondary">暂无趋势数据</Typography.Text>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const H = 30; // 视图高度单位
  const points = data.map((v, i) => {
    const x = (i / (n - 1)) * 100; // 归一化到[0,100]
    const y = H - ((v - min) / range) * H;
    return `${x},${y}`;
  });
  const d = `M ${points[0]} ` + points.slice(1).map(p => `L ${p}`).join(' ');
  return (
    <svg width="100%" height={height} viewBox={`0 0 100 ${H}`} preserveAspectRatio="none">
      <path d={d} stroke={color} fill="none" strokeWidth={1.5} />
    </svg>
  );
};

interface Props {
  connection: DatabaseConnection | null;
  database?: string;
  darkMode?: boolean;
}

const MySqlServiceInfoPage: React.FC<Props> = ({ connection }) => {
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<DatabaseInfo | null>(null);
  // 局部刷新：仅用于指标数值的独立状态，避免整页刷新
  const [perf, setPerf] = useState<Partial<DatabaseInfo['performance']>>({});
  // 采样间隔可配置 + QPS平滑显示
  const [refreshMs, setRefreshMs] = useState<number>(5000);
  const [displayQps, setDisplayQps] = useState<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const lastFrameTsRef = useRef<number | null>(null);
  const [connCount, setConnCount] = useState<number>(0);
  const [samples, setSamples] = useState<Array<{ ts: number; qps: number; connections: number; bpReads: number; bpReadReq: number; bpWriteReq: number }>>([]);
  const [scope, setScope] = useState<'database' | 'instance'>('database');
  const [activeTab, setActiveTab] = useState<string>('overview');

  // 获取poolId
  const getPoolId = (conn?: DatabaseConnection | null) => {
    if (!conn) return undefined;
    const fallbackPoolId = `${conn?.type}_${conn?.host}_${conn?.port}_${conn?.database || ''}`;
    return conn?.connectionId || fallbackPoolId || conn?.id;
  };

  // 进程列表：数据、排序、筛选、分页（Antd控件）
  const [processList, setProcessList] = useState<any[]>([]);
  const [processLoading, setProcessLoading] = useState(false);
  const [filterId, setFilterId] = useState<string>('');
  const [filterUser, setFilterUser] = useState('');
  const [filterCommand, setFilterCommand] = useState('');
  const [minTime, setMinTime] = useState<number>(0);
  const [maxTime, setMaxTime] = useState<number | undefined>(undefined);

  const [filterDb, setFilterDb] = useState('');
  const [filterState, setFilterState] = useState('');
  const [onlyLong, setOnlyLong] = useState<boolean>(false);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);

  // 变量与状态：数据与搜索
  const [variablesList, setVariablesList] = useState<Array<{ name: string; value: any }>>([]);
  const [variablesLoading, setVariablesLoading] = useState(false);
  const [variablesQuery, setVariablesQuery] = useState('');
  const [variablesCategory, setVariablesCategory] = useState<string>('');
  const [statusList, setStatusList] = useState<Array<{ name: string; value: any }>>([]);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusQuery, setStatusQuery] = useState('');
  const [statusCategory, setStatusCategory] = useState<string>('');

  const refresh = async () => {
    const fallbackPoolId = connection ? `${connection.type}_${connection.host}_${connection.port}_${connection.database || ''}` : undefined;
    const id = connection?.connectionId || fallbackPoolId || connection?.id;
    if (!id) return;
    if (!window.electronAPI || !window.electronAPI.getDatabaseInfo) return;
    try {
      setLoading(true);
      const res = await window.electronAPI.getDatabaseInfo(id);
      if (res?.success && res.info) {
        const next = res.info as DatabaseInfo;
        setPerf(next.performance || {});
        setConnCount(next.connections || 0);
        setInfo(prev => {
          if (!prev) return next;
          const prevStorageKey = `${prev.storage?.total}-${prev.storage?.used}-${prev.storage?.free}-${prev.storageInstance?.total}-${prev.storageInstance?.used}-${prev.storageInstance?.free}`;
          const nextStorageKey = `${next.storage?.total}-${next.storage?.used}-${next.storage?.free}-${next.storageInstance?.total}-${next.storageInstance?.used}-${next.storageInstance?.free}`;
          const shouldUpdateStatic = prev.version !== next.version || prevStorageKey !== nextStorageKey;
          return shouldUpdateStatic ? next : prev;
        });
        setSamples(prev => {
          const now = Date.now();
          const qpsVal = (next?.performance?.queriesPerSecondAvg ?? next?.performance?.queriesPerSecond ?? 0);
          const s = [
            ...prev,
            {
              ts: now,
              qps: qpsVal,
              connections: next?.connections || 0,
              bpReads: next?.performance?.innodbBufferPoolReads || 0,
              bpReadReq: next?.performance?.innodbBufferPoolReadRequests || 0,
              bpWriteReq: next?.performance?.innodbBufferPoolWriteRequests || 0,
            }
          ];
          return s.length > 60 ? s.slice(s.length - 60) : s;
        });
      }
    } catch (e) {
      console.error('获取MySQL服务信息失败:', e);
    } finally {
      setLoading(false);
    }
  };

  // 每秒值序列（由样本差分）
  const perSecSeries = (field: 'bpReads' | 'bpReadReq' | 'bpWriteReq') => {
    if (samples.length < 2) return [];
    const deltas: number[] = [];
    for (let i = 1; i < samples.length; i++) {
      const dt = (samples[i].ts - samples[i - 1].ts) / 1000;
      const dv = (samples[i][field] - samples[i - 1][field]);
      if (dt > 0 && dv >= 0) deltas.push(Number((dv / dt).toFixed(2)));
    }
    return deltas;
  };

  // 根据配置的采样间隔进行刷新（仅在概览页激活时）
  useEffect(() => {
    if (activeTab !== 'overview') return;
    const timer = setInterval(refresh, refreshMs);
    refresh();
    return () => clearInterval(timer);
  }, [connection?.id, connection?.connectionId, refreshMs, activeTab]);

  // rAF平滑渲染QPS（仅在概览页激活时）
  const qpsTarget = perf?.queriesPerSecondAvg ?? perf?.queriesPerSecond ?? 0;
  useEffect(() => {
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    if (activeTab !== 'overview') {
      rafIdRef.current = null;
      return;
    }
    lastFrameTsRef.current = null;
    const step = () => {
      const current = displayQps;
      const target = qpsTarget;
      const alpha = 0.2;
      const nextVal = current + (target - current) * alpha;
      setDisplayQps(Number(nextVal.toFixed(2)));
      rafIdRef.current = requestAnimationFrame(step);
    };
    rafIdRef.current = requestAnimationFrame(step);
    return () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    };
  }, [qpsTarget, activeTab]);

  // 计算实时指标
  const qps = qpsTarget;
  const slowQueries = perf?.slowQueries || 0;
  const bpReadsPerSecRaw = perSecSeries('bpReads').slice(-1)[0] || 0;
  const bpReadReqPerSecRaw = perSecSeries('bpReadReq').slice(-1)[0] || 0;
  const bpWriteReqPerSecRaw = perSecSeries('bpWriteReq').slice(-1)[0] || 0;
  const bpReadsPerSec = movingAverage(perSecSeries('bpReads'), 3) || bpReadsPerSecRaw;
  const bpReadReqPerSec = movingAverage(perSecSeries('bpReadReq'), 3) || bpReadReqPerSecRaw;
  const bpWriteReqPerSec = movingAverage(perSecSeries('bpWriteReq'), 3) || bpWriteReqPerSecRaw;
  const bpHitRatio = (perf?.innodbBufferPoolReadRequests && perf?.innodbBufferPoolReadRequests > 0)
    ? Number((1 - ((perf?.innodbBufferPoolReads || 0) / (perf?.innodbBufferPoolReadRequests || 1))) * 100).toFixed(2)
    : '0.00';
  const avgQps = useMemo(() => movingAverage(samples.map(s => s.qps), 5), [samples]);
  const avgConnections = useMemo(() => movingAverage(samples.map(s => s.connections), 5), [samples]);
  const qpsColor = getTierColor(qps, [100, 500]);
  const slowColor = getTierColor(slowQueries, [100, 1000]);
  const threadsColor = getTierColor(perf?.threadsRunning || 0, [10, 50]);
  const openTablesColor = getTierColor(perf?.openTables || 0, [200, 500]);
  const hitRatioNum = typeof bpHitRatio === 'string' ? parseFloat(bpHitRatio) : (bpHitRatio || 0);
  const hitColor = hitRatioNum < 95 ? RED : hitRatioNum < 99 ? ORANGE : GREEN;
  const storageData = useMemo(() => {
    const s = scope === 'instance' ? info?.storageInstance || info?.storage : info?.storage;
    const used = s?.used || 0;
    const free = s?.free || 0;
    const total = (s?.total || 0);
    const usedMB = Number((used / (1024 * 1024)).toFixed(2));
    const freeMB = Number((free / (1024 * 1024)).toFixed(2));
    const totalMB = Number((total / (1024 * 1024)).toFixed(2));
    return { usedMB, freeMB, totalMB };
  }, [scope, info?.storage, info?.storageInstance]);
  const bpSizeMB = useMemo(() => Number(((perf?.innodbBufferPoolSize || info?.performance?.innodbBufferPoolSize || 0) / (1024 * 1024)).toFixed(2)), [perf?.innodbBufferPoolSize, info?.performance?.innodbBufferPoolSize]);
  const usedMB = storageData.usedMB;
  const totalMB = storageData.totalMB;
  const storageTags = useMemo(() => {
    const s = scope === 'instance' ? info?.storageInstance || info?.storage : info?.storage;
    const used = s?.used || 0;
    const total = (s?.total || 0);
    const free = s?.free || 0;
    const usedPct = total > 0 ? Number(((used / total) * 100).toFixed(2)) : 0;
    return (
      <Space>
        <Tag color="blue">范围={scope === 'instance' ? '全实例' : '当前库'}</Tag>
        <Tag color="red">已用={usedMB}MB</Tag>
        <Tag color="green">剩余={Number((free / (1024 * 1024)).toFixed(2))}MB</Tag>
        <Tag color={getTierColor(usedPct, [70, 85])}>使用率={usedPct}%</Tag>
      </Space>
    );
  }, [scope, info?.storage, info?.storageInstance, usedMB]);

  // 进程列表 - 查询与处理
  const normalizeRow = (row: any) => {
    const pick = (k: string) => row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
    return {
      ID: pick('ID') ?? pick('Id') ?? pick('id'),
      USER: pick('USER') ?? pick('User'),
      HOST: pick('HOST') ?? pick('Host'),
      DB: pick('DB') ?? pick('Db') ?? pick('database'),
      COMMAND: pick('COMMAND') ?? pick('Command'),
      TIME: Number(pick('TIME') ?? 0),
      STATE: pick('STATE') ?? pick('State'),
      INFO: pick('INFO') ?? pick('Info'),
    };
  };

  const refreshProcessList = async () => {
    const poolId = getPoolId(connection);
    if (!poolId || !window.electronAPI?.executeQuery) return;
    try {
      setProcessLoading(true);
      const sql = 'SELECT ID, USER, HOST, DB, COMMAND, TIME, STATE, INFO FROM information_schema.PROCESSLIST';
      const res = await window.electronAPI.executeQuery(poolId, sql);
      if (res?.success && Array.isArray(res.data)) {
        setProcessList(res.data.map(normalizeRow));
      } else {
        setProcessList([]);
      }
    } catch (e) {
      console.error('刷新进程列表失败:', e);
      setProcessList([]);
    } finally {
      setProcessLoading(false);
    }
  };

  const killProcess = async (id: number) => {
    const poolId = getPoolId(connection);
    if (!poolId || !window.electronAPI?.executeQuery || !id) return;
    try {
      const result = await window.electronAPI.executeQuery(poolId, `KILL ${id}`);
      if (result?.success) {
        message.success(`进程 ${id} 已结束`);
      } else {
        message.error(`结束进程失败: ${result?.error || '未知错误'}`);
      }
      await refreshProcessList();
    } catch (e: any) {
      console.error('结束进程失败:', e);
      message.error(`结束进程失败: ${e?.message || '未知错误'}`);
    }
  };

  const filteredProcesses = useMemo(() => {
    const LONG_THRESHOLD = 60;
    let arr = [...processList];
    const ft = (v: any) => String(v ?? '').toLowerCase();
    if (filterId) arr = arr.filter(p => String(p.ID ?? '').includes(filterId));
    if (filterUser) arr = arr.filter(p => ft(p.USER).includes(filterUser.toLowerCase()));
    if (filterCommand) arr = arr.filter(p => ft(p.COMMAND).includes(filterCommand.toLowerCase()));
    if (filterDb) arr = arr.filter(p => ft(p.DB) === filterDb.toLowerCase());
    if (filterState === 'sleep') arr = arr.filter(p => ft(p.COMMAND) === 'sleep');
    else if (filterState === 'running') arr = arr.filter(p => ft(p.COMMAND) !== 'sleep');
    if (typeof minTime === 'number' && minTime > 0) arr = arr.filter(p => Number(p.TIME) >= minTime);
    if (typeof maxTime === 'number') arr = arr.filter(p => Number(p.TIME) <= maxTime!);
    if (onlyLong) arr = arr.filter(p => Number(p.TIME) >= LONG_THRESHOLD);
    return arr;
  }, [processList, filterId, filterUser, filterCommand, filterDb, filterState, minTime, maxTime, onlyLong]);

  const totalFiltered = filteredProcesses.length;
  const pageData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredProcesses.slice(start, start + pageSize);
  }, [filteredProcesses, page, pageSize]);

  // 变量/状态 - 查询
  const refreshVariables = async () => {
    const poolId = getPoolId(connection);
    if (!poolId || !window.electronAPI?.executeQuery) return;
    try {
      setVariablesLoading(true);
      const res = await window.electronAPI.executeQuery(poolId, 'SHOW GLOBAL VARIABLES');
      const pick = (row: any, k: string) => row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
      const data = Array.isArray(res?.data) ? res!.data.map((r: any) => ({ name: pick(r, 'Variable_name'), value: pick(r, 'Value') })) : [];
      setVariablesList(data);
    } catch (e) {
      console.error('刷新变量失败:', e);
      setVariablesList([]);
    } finally {
      setVariablesLoading(false);
    }
  };

  const refreshStatus = async () => {
    const poolId = getPoolId(connection);
    if (!poolId || !window.electronAPI?.executeQuery) return;
    try {
      setStatusLoading(true);
      const res = await window.electronAPI.executeQuery(poolId, 'SHOW GLOBAL STATUS');
      const pick = (row: any, k: string) => row[k] ?? row[k.toLowerCase()] ?? row[k.toUpperCase()];
      const data = Array.isArray(res?.data) ? res!.data.map((r: any) => ({ name: pick(r, 'Variable_name') ?? pick(r, 'Variable'), value: pick(r, 'Value') })) : [];
      setStatusList(data);
    } catch (e) {
      console.error('刷新状态失败:', e);
      setStatusList([]);
    } finally {
      setStatusLoading(false);
    }
  };

  const variablesCategories = useMemo(() => {
    const cats = new Set<string>();
    variablesList.forEach(v => {
      const name = String(v.name || '');
      const cat = name.includes('_') ? name.split('_')[0] : 'general';
      if (cat) cats.add(cat);
    });
    return Array.from(cats);
  }, [variablesList]);

  const statusCategories = useMemo(() => {
    const cats = new Set<string>();
    statusList.forEach(s => {
      const name = String(s.name || '');
      const cat = name.includes('_') ? name.split('_')[0] : 'general';
      if (cat) cats.add(cat);
    });
    return Array.from(cats);
  }, [statusList]);

  const variablesFiltered = useMemo(() => {
    const q = variablesQuery.trim().toLowerCase();
    let list = variablesList;
    if (variablesCategory) {
      list = list.filter(v => {
        const name = String(v.name || '');
        const cat = name.includes('_') ? name.split('_')[0] : 'general';
        return cat === variablesCategory;
      });
    }
    if (!q) return list;
    return list.filter(v => String(v.name).toLowerCase().includes(q));
  }, [variablesList, variablesQuery, variablesCategory]);

  const statusFiltered = useMemo(() => {
    const q = statusQuery.trim().toLowerCase();
    let list = statusList;
    if (statusCategory) {
      list = list.filter(s => {
        const name = String(s.name || '');
        const cat = name.includes('_') ? name.split('_')[0] : 'general';
        return cat === statusCategory;
      });
    }
    if (!q) return list;
    return list.filter(s => String(s.name).toLowerCase().includes(q));
  }, [statusList, statusQuery, statusCategory]);

  useEffect(() => {
    // 初次加载与连接变化时拉取
    refreshProcessList();
    refreshVariables();
    refreshStatus();
    setPage(1);
  }, [connection?.id, connection?.connectionId]);

  // 进程列表列定义（Antd Table + 展开行）
  const processColumns = [
    { title: 'ID', dataIndex: 'ID', key: 'ID', sorter: (a: any, b: any) => Number(a.ID) - Number(b.ID), width: 90 },
    { title: '用户', dataIndex: 'USER', key: 'USER', sorter: (a: any, b: any) => String(a.USER).localeCompare(String(b.USER)), width: 120 },
    { title: '主机', dataIndex: 'HOST', key: 'HOST', sorter: (a: any, b: any) => String(a.HOST).localeCompare(String(b.HOST)), width: 160 },
    { title: '数据库', dataIndex: 'DB', key: 'DB', sorter: (a: any, b: any) => String(a.DB).localeCompare(String(b.DB)), width: 140 },
    { title: '命令', dataIndex: 'COMMAND', key: 'COMMAND', sorter: (a: any, b: any) => String(a.COMMAND).localeCompare(String(b.COMMAND)), width: 120 },
    { title: '耗时', dataIndex: 'TIME', key: 'TIME', sorter: (a: any, b: any) => Number(a.TIME) - Number(b.TIME), width: 100 },
    { title: '状态', dataIndex: 'STATE', key: 'STATE', sorter: (a: any, b: any) => String(a.STATE).localeCompare(String(b.STATE)), width: 140 },
    {
      title: '信息', dataIndex: 'INFO', key: 'INFO', ellipsis: true,
      render: (text: any) => <Typography.Paragraph style={{ margin: 0 }} ellipsis={{ rows: 1, tooltip: String(text || '') }}>{String(text || '')}</Typography.Paragraph>,
    },
    {
      title: '操作', key: 'action', width: 100,
      render: (_: any, record: any) => (
        <Popconfirm title={`确认结束进程 ${record.ID} ?`} onConfirm={() => killProcess(Number(record.ID))} okText="结束" cancelText="取消">
          <Button danger size="small">结束</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div style={{ padding: 12 }}>
      <Typography.Title level={5} style={{ marginBottom: 8 }}>MySQL 服务信息</Typography.Title>
      <div style={{ marginBottom: 8 }}>
        <Space>
          <Tag>版本={info?.version || '-'}</Tag>
          <Tag color="blue">{`地址=${connection?.host || '-'}:${connection?.port ?? '-'}`}</Tag>
          <Tag color="cyan">{`数据库=${connection?.database || '-'}`}</Tag>
          <Tag color="geekblue">连接数={connCount}</Tag>
          <Tag color="purple">采样间隔={refreshMs}ms</Tag>
          {typeof perf?.queriesPerSecondAvgWindowSize === 'number' && (
            <Tag color="blue">平均窗口={perf?.queriesPerSecondAvgWindowSize}样本</Tag>
          )}
          <Select value={refreshMs} onChange={(v) => setRefreshMs(Number(v))} size="small" style={{ width: 110 }}
            options={[{ value: 1000, label: '1000ms' }, { value: 2000, label: '2000ms' }, { value: 5000, label: '5000ms' }]} />
          {loading && <Tag color="gold">刷新中...</Tag>}
        </Space>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k)}
        items={[
          {
            key: 'overview',
            label: '概览',
            children: (
              <div>
                <Row gutter={16}>
                  <Col span={6}><Statistic title="QPS" value={displayQps} valueStyle={{ color: qpsColor }} /></Col>
                  <Col span={6}><Statistic title="慢查询数" value={slowQueries} valueStyle={{ color: slowColor }} /></Col>
                  <Col span={6}><Statistic title="Threads_running" value={perf?.threadsRunning || 0} valueStyle={{ color: threadsColor }} /></Col>
                  <Col span={6}><Statistic title="Open_tables" value={perf?.openTables || 0} valueStyle={{ color: openTablesColor }} /></Col>
                </Row>
                <div style={{ marginTop: 6 }}>
                  <Space>
                    <Tag color="green">QPS均值={avgQps}</Tag>
                    <Tag color="blue">连接均值={avgConnections}</Tag>
                  </Space>
                </div>

                <Divider style={{ margin: '12px 0' }} />

                <Row gutter={16}>
                  <Col span={6}><Statistic title="InnoDB缓冲池(MB)" value={bpSizeMB} /></Col>
                  <Col span={6}><Statistic title="读请求/s" value={bpReadReqPerSec} /></Col>
                  <Col span={6}><Statistic title="缓冲池Reads/s" value={bpReadsPerSec} /></Col>
                  <Col span={6}><Statistic title="命中率(%)" value={bpHitRatio} valueStyle={{ color: hitColor }} /></Col>
                </Row>
                <div style={{ marginTop: 8 }}>
                  <Space>
                    <Tag color="geekblue">reads总={perf?.innodbBufferPoolReads || 0}</Tag>
                    <Tag color="blue">readReq总={perf?.innodbBufferPoolReadRequests || 0}</Tag>
                    <Tag color="purple">writeReq总={perf?.innodbBufferPoolWriteRequests || 0}</Tag>
                    <Tag>{`平滑Reads/s=${bpReadsPerSec}`}</Tag>
                    <Tag>{`平滑ReadReq/s=${bpReadReqPerSec}`}</Tag>
                    <Tag>{`平滑WriteReq/s=${bpWriteReqPerSec}`}</Tag>
                  </Space>
                </div>

                <Divider style={{ margin: '12px 0' }} />

                <Row gutter={16}>
                  <Col span={6}><Statistic title="已用存储(MB)" value={usedMB} /></Col>
                  <Col span={6}><Statistic title="总存储(MB)" value={totalMB} /></Col>
                  <Col span={12}>
                    <Space>
                      <span>统计范围</span>
                      <Select value={scope} onChange={(v) => setScope(v as any)} size="small" style={{ width: 120 }}
                        options={[{ value: 'database', label: '当前库' }, { value: 'instance', label: '全实例' }]} />
                    </Space>
                  </Col>
                </Row>
                <div style={{ marginTop: 12 }}>{storageTags}</div>

                <Divider style={{ margin: '12px 0' }} />

                {samples.length === 0 ? (
                  <Typography.Text type="secondary">暂无趋势数据</Typography.Text>
                ) : (
                  <Row gutter={12}>
                    <Col span={12}>
                      <Card size="small" title="QPS趋势">
                        <Sparkline data={samples.map(s => s.qps)} color="#1890ff" height={80} />
                        <div style={{ marginTop: 6 }}>
                          <Space>
                            <Tag>{`最小=${Math.min(...(samples.map(s => s.qps).length ? samples.map(s => s.qps) : [0]))}`}</Tag>
                            <Tag>{`最大=${Math.max(...(samples.map(s => s.qps).length ? samples.map(s => s.qps) : [0]))}`}</Tag>
                            <Tag color="geekblue">{`当前=${qps}`}</Tag>
                          </Space>
                        </div>
                      </Card>
                    </Col>
                    <Col span={12}>
                      <Card size="small" title="连接数趋势">
                        <Sparkline data={samples.map(s => s.connections)} color="#52c41a" height={80} />
                        <div style={{ marginTop: 6 }}>
                          <Space>
                            <Tag>{`最小=${Math.min(...(samples.map(s => s.connections).length ? samples.map(s => s.connections) : [0]))}`}</Tag>
                            <Tag>{`最大=${Math.max(...(samples.map(s => s.connections).length ? samples.map(s => s.connections) : [0]))}`}</Tag>
                            <Tag color="geekblue">{`当前=${connCount}`}</Tag>
                          </Space>
                        </div>
                      </Card>
                    </Col>
                  </Row>
                )}
              </div>
            ),
          },
          {
            key: 'processes',
            label: '进程',
            children: (
              <Card size="small" title="进程列表" extra={
                <Space wrap>
                  <Button onClick={refreshProcessList} loading={processLoading} size="small">刷新</Button>
                  <Input placeholder="线程ID" value={filterId} onChange={(e) => setFilterId(e.target.value)} size="small" style={{ width: 100 }} />
                  <Input placeholder="用户" value={filterUser} onChange={(e) => setFilterUser(e.target.value)} size="small" style={{ width: 110 }} />
                  <Select allowClear placeholder="命令" value={filterCommand || undefined} onChange={(v) => setFilterCommand(String(v || ''))} size="small" style={{ width: 120 }}
                     options={Array.from(new Set(processList.map(p => String(p.COMMAND || '').trim()).filter(Boolean))).map(c => ({ value: c, label: c }))} />
                  <Select allowClear placeholder="数据库" value={filterDb || undefined} onChange={(v) => setFilterDb(String(v || ''))} size="small" style={{ width: 140 }}
                    options={Array.from(new Set(processList.map(p => String(p.DB || '').trim()).filter(Boolean))).map(db => ({ value: db, label: db }))} />
                  <Select value={filterState || 'all'} onChange={(v) => setFilterState(String(v))} size="small" style={{ width: 120 }}
                    options={[{ value: 'all', label: '全部' }, { value: 'running', label: 'Running' }, { value: 'sleep', label: 'Sleep' }]} />
                  <Checkbox checked={onlyLong} onChange={(e) => setOnlyLong(e.target.checked)}>仅长事务(≥60s)</Checkbox>
                  <InputNumber placeholder="最小时长" min={0} value={minTime} onChange={(v) => setMinTime(Number(v || 0))} size="small" style={{ width: 120 }} />
                  <InputNumber placeholder="最大时长" min={0} value={typeof maxTime === 'number' ? maxTime : undefined} onChange={(v) => setMaxTime(typeof v === 'number' ? v : undefined)} size="small" style={{ width: 120 }} />
                  <Select value={pageSize} onChange={(v) => { setPageSize(Number(v)); setPage(1); }} size="small" style={{ width: 110 }}
                    options={[{ value: 10, label: '每页10' }, { value: 20, label: '每页20' }, { value: 50, label: '每页50' }]} />
                </Space>
              }>
                <div style={{ overflow: 'hidden' }}>
                  <Table
                    size="small"
                    dataSource={pageData}
                    columns={processColumns as any}
                    pagination={false}
                    rowKey={(r) => `${r.ID}`}
                    scroll={{ y: 'calc(100% - 100px)' }}
                    expandable={{
                      expandedRowRender: (record: any) => (
                        <Typography.Paragraph style={{ margin: 0 }}>
                          {String(record.INFO || '')}
                        </Typography.Paragraph>
                      ),
                    }}
                  />
                </div>
                <div style={{ marginTop: 8, textAlign: 'right' }}>
                  <Pagination current={page} pageSize={pageSize} total={totalFiltered} onChange={(p, ps) => { setPage(p); setPageSize(ps); }} size="small" />
                </div>
              </Card>
            ),
          },
          {
            key: 'variables',
            label: '变量',
            children: (
              <Card size="small" title="变量">
                <Space style={{ marginBottom: 8 }} wrap>
                  <Button onClick={refreshVariables} loading={variablesLoading} size="small">刷新</Button>
                  <Input placeholder="搜索变量名" value={variablesQuery} onChange={(e) => setVariablesQuery(e.target.value)} size="small" style={{ width: 160 }} />
                </Space>
                <div style={{ overflow: 'hidden' }}>
                    <Table
                    size="small"
                    scroll={{ y: 'calc(100vh - 500px)' }}
                    dataSource={variablesFiltered}
                    columns={[
                      { title: '名称', dataIndex: 'name', key: 'name', width: 220, sorter: (a: any, b: any) => String(a.name).localeCompare(String(b.name)),
                        filters: Array.from(new Set(variablesList.map(v => (String(v.name || '').includes('_') ? String(v.name).split('_')[0] : 'general')))).map(c => ({ text: c, value: c })),
                        onFilter: (value: any, record: any) => {
                          const cat = String(record.name || '').includes('_') ? String(record.name).split('_')[0] : 'general';
                          return cat === value;
                        }
                      },
                      { title: '值', dataIndex: 'value', key: 'value', sorter: (a: any, b: any) => String(a.value).localeCompare(String(b.value)), render: (v: any) => <Typography.Paragraph style={{ margin: 0 }} ellipsis={{ rows: 1, tooltip: String(v || '') }}>{String(v || '')}</Typography.Paragraph> },
                    ] as any}
                    pagination={false}
                    rowKey={(r) => `${r.name}`}
                  />
                </div>
              </Card>
            ),
          },
          {
            key: 'status',
            label: '状态',
            children: (
              <Card size="small" title="状态">
                <Space style={{ marginBottom: 8 }} wrap>
                  <Button onClick={refreshStatus} loading={statusLoading} size="small">刷新</Button>
                  <Input placeholder="搜索状态名" value={statusQuery} onChange={(e) => setStatusQuery(e.target.value)} size="small" style={{ width: 160 }} />
                </Space>
                <div style={{ overflow: 'hidden' }}>
                   <Table
                    size="small"
                    scroll={{ y: 'calc(100vh - 500px)' }}
                    dataSource={statusFiltered}
                    columns={[
                      { title: '名称', dataIndex: 'name', key: 'name', width: 220, sorter: (a: any, b: any) => String(a.name).localeCompare(String(b.name)),
                        filters: Array.from(new Set(statusList.map(s => (String(s.name || '').includes('_') ? String(s.name).split('_')[0] : 'general')))).map(c => ({ text: c, value: c })),
                        onFilter: (value: any, record: any) => {
                          const cat = String(record.name || '').includes('_') ? String(record.name).split('_')[0] : 'general';
                          return cat === value;
                        }
                      },
                      { title: '值', dataIndex: 'value', key: 'value', sorter: (a: any, b: any) => String(a.value).localeCompare(String(b.value)), render: (v: any) => <Typography.Paragraph style={{ margin: 0 }} ellipsis={{ rows: 1, tooltip: String(v || '') }}>{String(v || '')}</Typography.Paragraph> },
                    ] as any}
                    pagination={false}
                    rowKey={(r) => `${r.name}`}
                  />
                </div>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
};

export default MySqlServiceInfoPage;