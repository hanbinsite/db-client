import React, { useEffect, useMemo, useState } from 'react';
import { Card, Descriptions, Statistic, Row, Col, Tag, Space, Alert, Spin, Divider, Tabs, Progress, InputNumber, Select, Switch, Button, Typography, Table, Input } from 'antd';
import { Line, Pie, Column, Area } from '@ant-design/plots';
import type { DatabaseConnection } from '../../types';
import { execRedisQueued } from '../../utils/redis-exec-queue';

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

  // Keyspace 控制（过滤/排序）
  const [keyspaceFilter, setKeyspaceFilter] = useState<string>('');
  const [keyspaceSort, setKeyspaceSort] = useState<'keys'|'expires'|'avg_ttl'>('keys');
  const [keyspaceSortDesc, setKeyspaceSortDesc] = useState<boolean>(true);

  // 命令统计控制（过滤/排序/TopN/图表指标）
  const [commandFilter, setCommandFilter] = useState<string>('');
  const [commandTopN, setCommandTopN] = useState<number>(10);
  const [commandSortKey, setCommandSortKey] = useState<'calls'|'usec'|'usecPerCall'>('calls');
  const [commandSortDesc, setCommandSortDesc] = useState<boolean>(true);
  const [commandMetricPie, setCommandMetricPie] = useState<'calls'|'usecPerCall'>('calls');

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

        // 命令统计
        let cmdText = '';
        if (poolId) {
          const cmdRes = await (window as any).electronAPI?.executeQuery(poolId, 'info', ['commandstats']);
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
            const cnRes = await (window as any).electronAPI?.executeQuery(poolId, 'cluster', ['nodes']);
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
          const mem = num(secs.memory?.used_memory);
          const clients = num(secs.clients?.connected_clients);
          const ops = num(stats.instantaneous_ops_per_sec);
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

  // 周期采样 recent N 次 INFO
  useEffect(() => {
    if (!enableSampling || !poolId) return;
    const timer = setInterval(async () => {
      if (samplingBusy) return;
      setSamplingBusy(true);
      try {
        const res = await (window as any).electronAPI?.executeQuery(poolId, 'info', []);
        if (res && res.success) {
          const data = Array.isArray(res.data) ? (res.data[0]?.value ?? res.data[0]) : res.data;
          const secs = parseRedisInfo(String(data || ''));
          const stats = secs.stats || {};
          const mem = num(secs.memory?.used_memory);
          const clients = num(secs.clients?.connected_clients);
          const ops = num(stats.instantaneous_ops_per_sec);
          const ts = Date.now();
          setInfoSamples(prev => {
            const next = [...prev, { ts, ops, mem, clients }];
            return next.length > sampleWindow ? next.slice(next.length - sampleWindow) : next;
          });
        }
        // 命令统计采样
        const cmdRes = await execRedisQueued(poolId, 'info', ['commandstats']);
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
    const usedMemoryHuman = memory.used_memory_human || (Number(memory.used_memory || 0) + ' bytes');

    let totalKeys = 0;
    Object.values(keyspace).forEach(v => { totalKeys += v.keys || 0; });

    return { role, version, uptimeSec, uptimeDays, connectedClients, opsPerSec, usedMemoryHuman, totalKeys };
  }, [sections, keyspace]);

  const memUnit = useMemo<'MB'|'GB'>(() => {
    const sampleMax = Math.max(...infoSamples.map(s => s.mem), Number(sections.memory?.used_memory || 0), 0);
    return sampleMax >= 1024 * 1024 * 1024 ? 'GB' : 'MB';
  }, [infoSamples, sections]);

  // Keyspace 过滤排序后的视图
  const keyspaceView = useMemo(() => {
    let entries = Object.entries(keyspace);
    if (keyspaceFilter && keyspaceFilter.trim()) {
      const f = keyspaceFilter.trim().toLowerCase();
      entries = entries.filter(([db]) => db.toLowerCase().includes(f));
    }
    entries.sort((a, b) => {
      const va = (a[1] as any)[keyspaceSort] || 0;
      const vb = (b[1] as any)[keyspaceSort] || 0;
      return keyspaceSortDesc ? (vb - va) : (va - vb);
    });
    return entries;
  }, [keyspace, keyspaceFilter, keyspaceSort, keyspaceSortDesc]);

  // 命令统计视图：过滤 + 排序 + TopN
  const commandView = useMemo(() => {
    let arr = [...commandStats];
    if (commandFilter && commandFilter.trim()) {
      const f = commandFilter.trim().toLowerCase();
      arr = arr.filter(c => c.cmd.toLowerCase().includes(f));
    }
    arr.sort((a, b) => {
      const va = (a as any)[commandSortKey] || 0;
      const vb = (b as any)[commandSortKey] || 0;
      return commandSortDesc ? (vb - va) : (va - vb);
    });
    return arr.slice(0, Math.max(1, commandTopN || 10));
  }, [commandStats, commandFilter, commandSortKey, commandSortDesc, commandTopN]);

  // 命令占比/柱状图数据（与表格排序联动）
  const commandChartData = useMemo(() => {
    return commandView.map(c => ({
      type: c.cmd,
      value: commandSortKey === 'usecPerCall' ? c.usecPerCall : (commandSortKey === 'usec' ? c.usec : c.calls)
    }));
  }, [commandView, commandSortKey]);

  // 命令趋势数据（按采样计算速率，受过滤/TopN影响）
  const commandTrendData = useMemo(() => {
    const allow = new Set(commandView.map(c => c.cmd));
    const series: Array<{ time: string; rate: number; cmd: string }> = [];
    for (const [cmd, arr] of Object.entries(cmdSamples)) {
      if (!allow.has(cmd)) continue;
      for (let i = 1; i < arr.length; i++) {
        const prev = arr[i - 1];
        const cur = arr[i];
        const dt = Math.max(1, (cur.ts - prev.ts) / 1000);
        const rate = Math.max(0, (cur.calls - prev.calls) / dt);
        series.push({ time: fmtTime(cur.ts), rate: Number(rate.toFixed(2)), cmd });
      }
    }
    return series;
  }, [cmdSamples, commandView]);

  const chartTheme = darkMode ? 'dark' : 'classic';

  return (
    <div style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      <Tabs
        items={[
          {
            key: 'overview',
            label: '概览',
            children: (
              <Card bordered>
                {loading ? <Spin /> : (
                  <>
                    <Row gutter={16}>
                      <Col xs={12} md={6}><Statistic title="版本" value={overview.version} /></Col>
                      <Col xs={12} md={6}><Statistic title="角色" value={overview.role} /></Col>
                      <Col xs={12} md={6}><Statistic title="运行时长(天)" value={overview.uptimeDays} /></Col>
                      <Col xs={12} md={6}><Statistic title="客户端连接数" value={overview.connectedClients} /></Col>
                    </Row>
                    <Divider style={{ margin: '12px 0' }} />
                    <Row gutter={16}>
                      <Col xs={24} md={8}><Statistic title="每秒操作" value={overview.opsPerSec} /></Col>
                      <Col xs={24} md={10}>
                        <Card size="small" title="内存使用">
                          <Space direction="vertical" style={{ width: '100%' }}>
                            <div>
                              <span style={{ marginRight: 8 }}>{overview.usedMemoryHuman}</span>
                            </div>
                            {(() => {
                              const used = Number(sections.memory?.used_memory || 0);
                              const maxm = Number(sections.memory?.maxmemory || 0);
                              const percent = maxm > 0 ? Math.min(100, Number(((used / maxm) * 100).toFixed(2))) : undefined;
                              return percent !== undefined ? (
                                <Progress percent={percent} size="small" status="active" />
                              ) : (
                                <Alert type="info" showIcon message="未配置maxmemory，显示原始已用内存" />
                              );
                            })()}
                          </Space>
                        </Card>
                      </Col>
                      <Col xs={24} md={6}><Statistic title="总键数" value={overview.totalKeys} /></Col>
                    </Row>

                    {/* 概览趋势：ops/内存/客户端 */}
                    <Divider style={{ margin: '12px 0' }} />
                    <Card size="small" title="趋势（最近N次采样）">
                      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <Space>
                          <Typography.Text type="secondary">窗口N:</Typography.Text>
                          <InputNumber min={5} max={200} value={sampleWindow} onChange={(v) => setSampleWindow(Math.max(5, Number(v || 30)))} />
                          <Typography.Text type="secondary">间隔(ms):</Typography.Text>
                          <InputNumber min={500} max={10000} step={500} value={sampleIntervalMs} onChange={(v) => setSampleIntervalMs(Math.max(500, Number(v || 2000)))} />
                        </Space>
                        <Space>
                          <Switch checked={enableSampling} onChange={setEnableSampling} checkedChildren="采样中" unCheckedChildren="暂停采样" />
                        </Space>
                      </Space>
                      <Row gutter={12} style={{ marginTop: 12 }}>
                        <Col xs={24} md={12}>
                          <Card size="small" title="每秒操作趋势">
                            <Line
                              theme={chartTheme}
                              data={infoSamples.map(s => ({ time: fmtTime(s.ts), value: s.ops }))}
                              xField="time"
                              yField="value"
                              height={180}
                            />
                          </Card>
                        </Col>
                        <Col xs={24} md={12}>
                          <Card size="small" title="内存使用趋势">
                            <Area
                              theme={chartTheme}
                              data={infoSamples.map(s => ({ time: fmtTime(s.ts), value: bytesTo(s.mem, memUnit) }))}
                              xField="time"
                              yField="value"
                              axis={{ y: { labelFormatter: (v: any) => `${v} ${memUnit}` } }}
                              height={180}
                            />
                          </Card>
                        </Col>
                      </Row>
                    </Card>
                  </>
                )}
                {error && <Alert type="error" message={error} showIcon style={{ marginTop: 12 }} />}
              </Card>
            )
          },
          {
            key: 'activity',
            label: '活动状态',
            children: (
              <Card bordered>
                {loading ? <Spin /> : (
                  <>
                    <Descriptions size="small" column={2}>
                      <Descriptions.Item label="每秒命令">{sections.stats?.instantaneous_ops_per_sec || '-'}</Descriptions.Item>
                      <Descriptions.Item label="总命令数">{sections.stats?.total_commands_processed || '-'}</Descriptions.Item>
                      <Descriptions.Item label="累计连接">{sections.stats?.total_connections_received || '-'}</Descriptions.Item>
                      <Descriptions.Item label="拒绝连接">{sections.stats?.rejected_connections || '-'}</Descriptions.Item>
                      <Descriptions.Item label="命中率">{sections.stats?.keyspace_hits || '0'}/{sections.stats?.keyspace_misses || '0'}</Descriptions.Item>
                      <Descriptions.Item label="阻塞客户端">{sections.clients?.blocked_clients || '-'}</Descriptions.Item>
                    </Descriptions>
                    <Divider style={{ margin: '12px 0' }} />
                    {/* 活动折线（每秒操作） */}
                    <Card size="small" title="每秒操作趋势">
                      <Line
                        theme={chartTheme}
                        data={infoSamples.map(s => ({ time: fmtTime(s.ts), value: s.ops }))}
                        xField="time"
                        yField="value"
                        height={220}
                      />
                    </Card>
                  </>
                )}
              </Card>
            )
          },
          {
            key: 'keyspace',
            label: 'Keyspace',
            children: (
              <Card bordered>
                {loading ? <Spin /> : (
                  <>
                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                      <Space>
                        <Typography.Text type="secondary">过滤:</Typography.Text>
                        <Select
                          showSearch
                          style={{ minWidth: 160 }}
                          placeholder="输入db过滤，如 db0"
                          value={keyspaceFilter || undefined}
                          onSearch={(v) => setKeyspaceFilter(v)}
                          onChange={(v) => setKeyspaceFilter(String(v || ''))}
                          options={Object.keys(keyspace).map(db => ({ label: db, value: db }))}
                          allowClear
                        />
                        <Typography.Text type="secondary">排序:</Typography.Text>
                        <Select
                          style={{ width: 140 }}
                          value={keyspaceSort}
                          onChange={(v) => setKeyspaceSort(v as any)}
                          options={[{ value: 'keys', label: 'keys' }, { value: 'expires', label: 'expires' }, { value: 'avg_ttl', label: 'avg_ttl' }]}
                        />
                        <Switch checked={keyspaceSortDesc} onChange={setKeyspaceSortDesc} checkedChildren="降序" unCheckedChildren="升序" />
                      </Space>
                    </Space>
                    <Divider style={{ margin: '12px 0' }} />
                    <Row gutter={16}>
                      {keyspaceView.length === 0 && (
                        <Col span={24}><Alert type="info" message="当前无键空间信息或数据库为空" /></Col>
                      )}
                      {(() => {
                        const maxKeys = Math.max(...keyspaceView.map(([_, v]) => v.keys), 1);
                        return keyspaceView.map(([db, info]) => (
                          <Col xs={24} md={12} lg={8} key={db}>
                            <Card size="small" title={db}>
                              <Space direction="vertical" style={{ width: '100%' }}>
                                <div>
                                  <Tag color="blue">keys: {info.keys}</Tag>
                                  <Tag color="orange">expires: {info.expires}</Tag>
                                  <Tag>avg_ttl: {info.avg_ttl}</Tag>
                                </div>
                                <div style={{ background: '#f0f2f5', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                                  <div style={{ width: `${Math.round((info.keys / maxKeys) * 100)}%`, height: '100%', background: '#1677ff' }} />
                                </div>
                              </Space>
                            </Card>
                          </Col>
                        ));
                      })()}
                    </Row>
                    <Divider style={{ margin: '12px 0' }} />
                    {/* Keyspace 分布饼图 */}
                    <Card size="small" title="各DB键数占比">
                      <Pie
                        theme={chartTheme}
                        data={keyspaceView.map(([db, v]) => ({ type: db, value: v.keys }))}
                        angleField="value"
                        colorField="type"
                        radius={1}
                        innerRadius={0.4}
                        label={{ type: 'outer', content: '{name} {percentage}' }}
                        height={240}
                      />
                    </Card>
                    <Divider style={{ margin: '12px 0' }} />
                    {/* 键类型分布采样 */}
                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                      <Space>
                        <Typography.Text type="secondary">采样数量:</Typography.Text>
                        <InputNumber min={50} max={2000} step={50} value={typeSampleCount} onChange={(v) => setTypeSampleCount(Math.max(50, Number(v || 200)))} />
                      </Space>
                      <Space>
                        <Button type="primary" loading={typeSampling} onClick={async () => {
                          if (!poolId) return;
                          setTypeSampling(true);
                          try {
                            let cursor = '0';
                            const collected: string[] = [];
                            while (collected.length < typeSampleCount) {
                              const params = [cursor, 'MATCH', '*', 'COUNT', String(Math.min(200, typeSampleCount - collected.length))];
                              const res = await (window as any).electronAPI?.executeQuery(poolId, 'scan', params);
                              if (res && res.success) {
                                const data = res.data;
                                let nextCursor: string = '0';
                                let keys: any[] = [];
                                if (Array.isArray(data) && data.length >= 2) {
                                  nextCursor = String(data[0]?.value ?? data[0]);
                                  keys = Array.isArray(data[1]) ? data[1] : [];
                                } else if (data && typeof data === 'object' && 'cursor' in data && 'keys' in data) {
                                  nextCursor = String((data as any).cursor);
                                  keys = Array.isArray((data as any).keys) ? (data as any).keys : [];
                                }
                                const ks = (keys || []).map(k => String(k?.value ?? k));
                                collected.push(...ks);
                                cursor = nextCursor;
                                if (cursor === '0') break;
                              } else {
                                break;
                              }
                            }
                            const typeMap: Record<string, number> = {};
                            const sample = collected.slice(0, typeSampleCount);
                            await Promise.all(sample.map(async (key) => {
                              try {
                                const tRes = await (window as any).electronAPI?.executeQuery(poolId, 'type', [key]);
                                if (tRes && tRes.success) {
                                  const data = tRes.data;
                                  const typeStr = Array.isArray(data) ? String(data[0]?.value ?? data[0]) : String(data || '');
                                  const t = typeStr.toLowerCase();
                                  typeMap[t] = (typeMap[t] || 0) + 1;
                                }
                              } catch {}
                            }));
                            setTypeDist(typeMap);
                          } catch (e) {
                          } finally {
                            setTypeSampling(false);
                          }
                        }}>采样键类型分布</Button>
                      </Space>
                    </Space>
                    <Divider style={{ margin: '12px 0' }} />
                    <Card size="small" title="键类型分布">
                      <Pie
                        theme={chartTheme}
                        data={Object.entries(typeDist).map(([t, n]) => ({ type: t, value: n }))}
                        angleField="value"
                        colorField="type"
                        radius={1}
                        innerRadius={0.4}
                        label={{ type: 'outer', content: '{name} {percentage}' }}
                        height={240}
                      />
                    </Card>
                  </>
                )}
              </Card>
            )
          },
          {
            key: 'persistence',
            label: '持久化',
            children: (
              <Card bordered>
                {loading ? <Spin /> : (
                  <Descriptions size="small" column={2}>
                    <Descriptions.Item label="RDB最后状态">{sections.persistence?.rdb_last_bgsave_status || '-'}</Descriptions.Item>
                    <Descriptions.Item label="RDB耗时(s)">{sections.persistence?.rdb_last_bgsave_time_sec || '-'}</Descriptions.Item>
                    <Descriptions.Item label="AOF启用">{sections.persistence?.aof_enabled || '-'}</Descriptions.Item>
                    <Descriptions.Item label="AOF重写状态">{sections.persistence?.aof_last_bgrewrite_status || '-'}</Descriptions.Item>
                  </Descriptions>
                )}
              </Card>
            )
          },
          {
            key: 'cpu',
            label: 'CPU',
            children: (
              <Card bordered>
                {loading ? <Spin /> : (
                  <>
                    <Descriptions size="small" column={2}>
                      <Descriptions.Item label="sys">{sections.cpu?.used_cpu_sys || '-'}</Descriptions.Item>
                      <Descriptions.Item label="user">{sections.cpu?.used_cpu_user || '-'}</Descriptions.Item>
                      <Descriptions.Item label="sys_children">{sections.cpu?.used_cpu_sys_children || '-'}</Descriptions.Item>
                      <Descriptions.Item label="user_children">{sections.cpu?.used_cpu_user_children || '-'}</Descriptions.Item>
                    </Descriptions>
                    {(() => {
                      const vals = [
                        Number(sections.cpu?.used_cpu_sys || 0),
                        Number(sections.cpu?.used_cpu_user || 0),
                        Number(sections.cpu?.used_cpu_sys_children || 0),
                        Number(sections.cpu?.used_cpu_user_children || 0)
                      ];
                      const max = Math.max(...vals, 1);
                      const labels = ['sys', 'user', 'sys_children', 'user_children'];
                      return (
                        <Row gutter={12} style={{ marginTop: 12 }}>
                          {vals.map((v, i) => (
                            <Col xs={24} md={12} key={labels[i]}>
                              <Card size="small" title={labels[i]}>
                                <div style={{ background: '#f0f2f5', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                                  <div style={{ width: `${Math.round((v / max) * 100)}%`, height: '100%', background: '#52c41a' }} />
                                </div>
                                <div style={{ marginTop: 6, fontSize: 12, color: '#666' }}>{v}</div>
                              </Card>
                            </Col>
                          ))}
                        </Row>
                      );
                    })()}
                  </>
                )}
              </Card>
            )
          },
          {
            key: 'commands',
            label: '命令统计',
            children: (
              <Card bordered>
                {loading ? <Spin /> : (
                  <>
                    <Row gutter={16}>
                      {commandStats.length === 0 && (
                        <Col span={24}><Alert type="info" message="暂无命令统计信息" /></Col>
                      )}
                      {(() => {
                        const maxCalls = Math.max(...commandStats.map(c => c.calls), 1);
                        return commandStats.map(item => (
                          <Col xs={24} md={12} lg={8} key={item.cmd}>
                            <Card size="small" title={item.cmd}>
                              <Space direction="vertical" style={{ width: '100%' }}>
                                <div>
                                  <Tag color="blue">calls: {item.calls}</Tag>
                                  <Tag color="geekblue">usec: {item.usec}</Tag>
                                  <Tag color="green">usec/call: {item.usecPerCall}</Tag>
                                </div>
                                <div style={{ background: '#f0f2f5', height: 8, borderRadius: 4, overflow: 'hidden' }}>
                                  <div style={{ width: `${Math.round((item.calls / maxCalls) * 100)}%`, height: '100%', background: '#faad14' }} />
                                </div>
                              </Space>
                            </Card>
                          </Col>
                        ));
                      })()}
                    </Row>
                    <Divider style={{ margin: '12px 0' }} />
                    <Row gutter={12}>
                      <Col xs={24} md={8}>
                        <Card size="small" title="图表指标">
                          <Select
                            style={{ width: 180 }}
                            value={commandMetricPie}
                            onChange={(v) => {
                              const key = v as 'calls' | 'usecPerCall';
                              setCommandMetricPie(key);
                              setCommandSortKey(key);
                              setCommandSortDesc(true);
                            }}
                            options={[
                              { value: 'calls', label: '调用次数' },
                              { value: 'usecPerCall', label: '平均耗时(usec/call)' },
                            ]}
                          />
                        </Card>
                      </Col>
                      <Col xs={24} md={8}>
                        <Card size="small" title="过滤命令">
                          <Input
                            allowClear
                            placeholder="输入关键字过滤命令"
                            value={commandFilter}
                            onChange={(e) => setCommandFilter(e.target.value)}
                          />
                        </Card>
                      </Col>
                      <Col xs={24} md={8}>
                        <Card size="small" title="TopN">
                          <Space>
                            <Typography.Text type="secondary">显示前N项:</Typography.Text>
                            <InputNumber min={1} max={50} value={commandTopN} onChange={(v) => setCommandTopN(Math.max(1, Number(v || 10)))} />
                          </Space>
                        </Card>
                      </Col>
                      <Col xs={24} md={8}>
                        <Card size="small" title="采集">
                          <Space>
                            <Button onClick={async () => {
                              if (!poolId) return;
                              try {
                                const cmdRes = await (window as any).electronAPI?.executeQuery(poolId, 'info', ['commandstats']);
                                let text = '';
                                if (cmdRes && cmdRes.success) {
                                  const data = Array.isArray(cmdRes.data) ? (cmdRes.data[0]?.value ?? cmdRes.data[0]) : cmdRes.data;
                                  text = String(data || '');
                                }
                                if (!text) {
                                  const res = await (window as any).electronAPI?.executeQuery(poolId, 'info', []);
                                  if (res && res.success) {
                                    const data = Array.isArray(res.data) ? (res.data[0]?.value ?? res.data[0]) : res.data;
                                    text = String(data || '');
                                  }
                                }
                                const lines = String(text).split(/\r?\n/).filter((l: string) => l.startsWith('cmdstat_'));
                                const list: Array<{cmd: string; calls: number; usec: number; usecPerCall: number}> = lines.map((l: string) => {
                                  const m = l.match(/^cmdstat_(\w+):calls=(\d+),usec=(\d+),usec_per_call=([\d\.]+)/);
                                  return {
                                    cmd: m?.[1] || '-',
                                    calls: Number(m?.[2] || 0),
                                    usec: Number(m?.[3] || 0),
                                    usecPerCall: Number(m?.[4] || 0)
                                  };
                                }).sort((a,b) => b.calls - a.calls);
                                setCommandStats(list);
                              } catch {}
                            }}>重新采集</Button>
                          </Space>
                        </Card>
                      </Col>
                    </Row>
                    <Row gutter={12} style={{ marginTop: 12 }}>
                      <Col xs={24}>
                        <Card size="small" title="TOP命令柱状图（按当前排序）">
                          <Column
                            theme={chartTheme}
                            data={commandChartData}
                            xField="type"
                            yField="value"
                            height={240}
                          />
                        </Card>
                      </Col>
                    </Row>
                    <Divider style={{ margin: '12px 0' }} />
                    <Card size="small" title="命令统计列表（与图表联动）">
                      <Table
                        size="small"
                        rowKey="cmd"
                        dataSource={commandView}
                        pagination={{ pageSize: 10 }}
                        onChange={(pagination, filters, sorter: any) => {
                          const key = (sorter?.columnKey || sorter?.field) as 'calls'|'usec'|'usecPerCall' | undefined;
                          const order = sorter?.order as ('ascend'|'descend' | undefined);
                          if (key && (key === 'calls' || key === 'usec' || key === 'usecPerCall')) {
                            setCommandSortKey(key);
                            setCommandSortDesc(order !== 'ascend');
                          }
                        }}
                        columns={[
                          { title: '命令', dataIndex: 'cmd', key: 'cmd' },
                          { title: '调用次数', dataIndex: 'calls', key: 'calls', sorter: (a: any, b: any) => a.calls - b.calls },
                          { title: '耗时(usec)', dataIndex: 'usec', key: 'usec', sorter: (a: any, b: any) => a.usec - b.usec },
                          { title: '单次耗时(usec/call)', dataIndex: 'usecPerCall', key: 'usecPerCall', sorter: (a: any, b: any) => a.usecPerCall - b.usecPerCall },
                        ]}
                      />
                    </Card>
                  </>
                )}
              </Card>
            )
          },
          {
            key: 'cluster',
            label: '集群节点',
            children: !!clusterNodes ? (
              <Card bordered>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{clusterNodes}</pre>
              </Card>
            ) : (
              <Alert type="info" message="未启用集群或无法获取节点信息" />
            )
          },
          {
            key: 'server',
            label: '服务器信息',
            children: (
              <Card bordered>
                {loading ? <Spin /> : (
                  <Descriptions size="small" column={2}>
                    <Descriptions.Item label="版本">{sections.server?.redis_version || '-'}</Descriptions.Item>
                    <Descriptions.Item label="端口">{sections.server?.tcp_port || '-'}</Descriptions.Item>
                    <Descriptions.Item label="OS">{sections.server?.os || '-'}</Descriptions.Item>
                    <Descriptions.Item label="架构">{sections.server?.arch_bits || '-'}</Descriptions.Item>
                    <Descriptions.Item label="进程ID">{sections.server?.process_id || '-'}</Descriptions.Item>
                    <Descriptions.Item label="配置文件">{sections.server?.config_file || '-'}</Descriptions.Item>
                  </Descriptions>
                )}
              </Card>
            )
          }
        ]}
      />
    </div>
  );
};

export default RedisServiceInfoPage;