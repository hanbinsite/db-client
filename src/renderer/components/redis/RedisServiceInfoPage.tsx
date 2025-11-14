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
const bytesToMB = (b: number | undefined) => Number((((b || 0) / (1024 * 1024)).toFixed(2)));
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
  
  const poolId = connection.connectionId || connection.id;

  // 根据分钟与采样间隔，派生样本窗口
  useEffect(() => {
    const count = Math.max(5, Math.round((windowMinutes * 60000) / sampleIntervalMs));
    setSampleWindow(count);
  }, [windowMinutes, sampleIntervalMs]);

  // 初始加载
  useEffect(() => {
    let cancelled = false;
    
    // 检查连接是否已建立
    if (!connection.isConnected) {
      setError('加载失败: 连接尚未建立，请先连接数据库');
      setLoading(false);
      return;
    }
    
    const load = async () => {
        setLoading(true);
        setError('');

        try {
          // 详细日志：打印连接对象
          console.log('RedisServiceInfoPage - 连接对象:', connection);

          // 尝试获取连接池ID
          let currentPoolId = connection.connectionId;
          console.log('RedisServiceInfoPage - 初始连接池ID:', currentPoolId);
          
          // 如果连接池ID不存在，尝试生成与主进程一致的ID并检查
          if (!currentPoolId) {
            // 与主进程generatePoolId函数保持一致的ID生成逻辑
            const databaseName = connection.database || '';
            currentPoolId = `${connection.type}_${connection.host}_${connection.port}_${databaseName}`;
            console.log('RedisServiceInfoPage - 生成的连接池ID:', currentPoolId);
            
            // 检查连接池是否存在
            const poolExists = await (window as any).electronAPI?.getConnectionPoolConfig?.(currentPoolId);
            if (!poolExists) {
                // 打印连接参数
                console.log('RedisServiceInfoPage - connectDatabase params:', connection);
                // 连接池不存在，尝试重新连接
                const res = await (window as any).electronAPI?.connectDatabase?.(connection);
                console.log('RedisServiceInfoPage - 重新连接结果:', res);
                if (res?.success && res?.connectionId) {
                  currentPoolId = res.connectionId;
                  // 更新连接对象的connectionId和isConnected状态
                  connection.connectionId = currentPoolId;
                  connection.isConnected = true;
                  console.log('RedisServiceInfoPage - 重新连接获取的连接池ID:', currentPoolId);
                } else {
                  throw new Error('无法获取连接池ID，重新连接失败');
                }
            } else {
              console.log('RedisServiceInfoPage - 连接池存在，使用生成的ID');
            }
          }
        
        // 执行Redis命令获取真实数据
        console.log('RedisServiceInfoPage - 执行Redis INFO命令');
        const infoResult = await execRedisQueued(currentPoolId as string, 'INFO');
        console.log('RedisServiceInfoPage - INFO命令结果:', infoResult);
        
        console.log('RedisServiceInfoPage - 执行Redis CLUSTER NODES命令');
        const clusterResult = await execRedisQueued(currentPoolId as string, 'CLUSTER', ['NODES']);
        console.log('RedisServiceInfoPage - CLUSTER NODES命令结果:', clusterResult);
        
        console.log('RedisServiceInfoPage - 执行Redis INFO commandstats命令');
        const cmdStatsResult = await execRedisQueued(currentPoolId as string, 'INFO', ['commandstats']);
          console.log('RedisServiceInfoPage - INFO commandstats命令结果:', cmdStatsResult);

          if (cancelled) return;

          // 解析数据
          const parsedSections = parseRedisInfo(infoResult);
          console.log('RedisServiceInfoPage - 解析后的INFO数据:', parsedSections);
          setSections(parsedSections);
          
          setClusterNodes(clusterResult);

          // 解析键空间信息
          const keyspaceSection = parsedSections.keyspace || {};
          const parsedKeyspace = parseKeyspace(Object.entries(keyspaceSection).map(([k, v]) => `${k}:${v}`).join('\n'));
          console.log('RedisServiceInfoPage - 解析后的键空间信息:', parsedKeyspace);
          setKeyspace(parsedKeyspace);

          // 解析命令统计信息
          const commandStatsLines = cmdStatsResult.split('\n');
          const stats = commandStatsLines
            .filter((line: string) => line.startsWith('cmdstat_'))
            .map((line: string) => {
              const [cmdPart, ...restParts] = line.split(':');
              const cmd = cmdPart.replace('cmdstat_', '');
              const rest = restParts.join(':');
              const parts = rest.split(',');
              const obj: any = { cmd };
              parts.forEach((part: string) => {
                const [k, v] = part.split('=');
                obj[k] = Number(v);
              });
              return {
                cmd,
                calls: obj.calls || 0,
                usec: obj.usec || 0,
                usecPerCall: obj.usec_per_call || 0
              };
            });
          console.log('RedisServiceInfoPage - 解析后的命令统计信息:', stats);
          setCommandStats(stats);

          if (!cancelled) setLoading(false);
        } catch (err: any) {
          console.error('RedisServiceInfoPage - 加载失败:', err);
          if (!cancelled) {
            setError(`加载失败: ${err.message || '未知错误'}`);
            setLoading(false);
          }
        }
      };

      load();
    
    return () => {
      cancelled = true;
    };
  }, [connection.isConnected, connection.id, connection.connectionId]);

  // 周期采样
  useEffect(() => {
    if (!enableSampling || !poolId) return;
    
    const adjustedSampleIntervalMs = Math.max(10000, sampleIntervalMs);
    
    const timer = setInterval(async () => {
      if (samplingBusy) return;
      setSamplingBusy(true);
      try {
        // 获取真实Redis信息
        const infoResult = await execRedisQueued(poolId, 'INFO', ['stats', 'memory', 'clients', 'cpu']);
        const parsed = parseRedisInfo(infoResult);
        const mem = parsed.memory || {};
        const stats = parsed.stats || {};
        const clients = parsed.clients || {};

        // 计算 OPS (Operations Per Second)
        const totalCmds = Number(stats.total_commands_processed || 0);
        const currentTs = Date.now();
        let ops = 0;

        if (lastTotalCmds !== null && lastOpsTs !== null) {
          const timeDiffMs = currentTs - lastOpsTs;
          const cmdDiff = totalCmds - lastTotalCmds;
          ops = timeDiffMs > 0 ? Number(((cmdDiff / timeDiffMs) * 1000).toFixed(2)) : 0;
        }
        setLastTotalCmds(totalCmds);
        setLastOpsTs(currentTs);

        // 创建新样本
        const newSample = {
          ts: currentTs,
          ops,
          mem: Number(mem.used_memory || 0),
          memRss: Number(mem.used_memory_rss || 0),
          memPeak: Number(mem.used_memory_peak || 0),
          memDataset: Number(mem.used_memory_dataset || 0),
          memLua: Number(mem.used_memory_lua || 0),
          clients: Number(clients.connected_clients || 0),
          blocked: Number(clients.blocked_clients || 0)
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
  }, [enableSampling, poolId, sampleIntervalMs, sampleWindow, lastTotalCmds, lastOpsTs]);

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
  const overview = useMemo(() => {
    const server = sections.server || {};
    const clients = sections.clients || {};
    const uptimeSec = Number(server.uptime_in_seconds || 0);
    return {
      role: server.redis_role || 'master',
      version: server.redis_version || 'unknown',
      uptimeDays: Math.floor(uptimeSec / (3600 * 24)),
      connectedClients: Number(clients.connected_clients || 0),
      usedMemory: Number((sections.memory || {}).used_memory || 0),
      totalKeys: Object.values(keyspace).reduce((sum, db) => sum + db.keys, 0),
      totalCommands: Number((sections.stats || {}).total_commands_processed || 0),
      hitRate: Number((sections.stats || {}).keyspace_hits || 0) / 
               (Number((sections.stats || {}).keyspace_hits || 0) + Number((sections.stats || {}).keyspace_misses || 0)) * 100
    };
  }, [sections, keyspace]);

  return (
    <div style={{ padding: 12, height: 'calc(100vh - 180px)', overflow: 'auto' }}>
      {loading && (<Spin tip="加载服务信息..." />)}
      {!loading && error && (<Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />)}
      {!loading && !error && (
        <>
          {/* 概览卡片 */}
          <Card title="概览" style={{ marginBottom: 12 }}>
            <Row gutter={16}>
              <Col span={6}><Statistic title="角色" value={overview.role} /></Col>
              <Col span={6}><Statistic title="版本" value={overview.version} /></Col>
              <Col span={6}><Statistic title="运行天数" value={overview.uptimeDays} /></Col>
              <Col span={6}><Statistic title="连接客户端" value={overview.connectedClients} /></Col>
              <Col span={6}><Statistic title="使用内存" value={bytesToMB(overview.usedMemory)} suffix="MB" /></Col>
              <Col span={6}><Statistic title="总键数量" value={overview.totalKeys} /></Col>
              <Col span={6}><Statistic title="总命令数" value={overview.totalCommands} /></Col>
              <Col span={6}><Statistic 
                title="缓存命中率" 
                value={isNaN(overview.hitRate) ? 0 : overview.hitRate} 
                suffix="%" 
                valueStyle={{ color: overview.hitRate > 90 ? '#3f8600' : '#cf1322' }}
              /></Col>
            </Row>
          </Card>

          {/* 性能指标图表 */}
          <Row gutter={16} style={{ marginBottom: 12 }}>
            <Col span={24}>
              <Card title="OPS (Operations Per Second)" style={{ height: 400 }}>
                {infoSamples.length > 0 && (
                  <Line
                    data={infoSamples.map(sample => ({ time: sample.ts, ops: sample.ops }))}
                    xField="time"
                    yField="ops"
                    point={{ shape: 'circle', size: 3 }}
                    lineStyle={{ lineWidth: 2 }}
                    xAxis={{ type: 'time', label: { formatter: (v: number) => fmtTime(v) } }}
                    tooltip={{ formatter: (datum: any) => ({ name: 'OPS', value: datum.ops }) }}
                    smooth
                  />
                )}
              </Card>
            </Col>
          </Row>

          <Row gutter={16} style={{ marginBottom: 12 }}>
            <Col span={12}>
              <Card title="内存使用情况 (MB)" style={{ height: 400 }}>
                {infoSamples.length > 0 && (
                  <DualAxes
                    data={infoSamples.map(sample => ({ 
                      time: sample.ts, 
                      used: bytesToMB(sample.mem), 
                      rss: bytesToMB(sample.memRss),
                      peak: bytesToMB(sample.memPeak)
                    }))}
                    xField="time"
                    yField={['used', 'rss', 'peak']}
                    geometry={[
                      { type: 'line', yField: 'used', smooth: true, color: '#165DFF' },
                      { type: 'line', yField: 'rss', smooth: true, color: '#36CBCB' },
                      { type: 'line', yField: 'peak', smooth: true, color: '#FF7D00' }
                    ]}
                    xAxis={{ type: 'time', label: { formatter: (v: number) => fmtTime(v) } }}
                    tooltip={{ formatter: (datum: any) => ({
                      name: '时间',
                      value: fmtTime(datum.time),
                      used: `${datum.used} MB`,
                      rss: `${datum.rss} MB`,
                      peak: `${datum.peak} MB`
                    }) }}
                  />
                )}
              </Card>
            </Col>
            <Col span={12}>
              <Card title="客户端连接数" style={{ height: 400 }}>
                {infoSamples.length > 0 && (
                  <Area
                  data={infoSamples.map(sample => ({ time: sample.ts, clients: sample.clients }))}
                  xField="time"
                  yField="clients"
                  line={{ size: 2 }}
                  area={{ fill: 'l(270) 0:#ffffff 0.5:#722ED1 1:#F5222D' }}
                  axis={{ x: { type: 'time', label: { formatter: (v: number) => fmtTime(v) } }, y: { type: 'number', title: '客户端连接数' } }}
                  tooltip={{ formatter: (datum: any) => ({ name: '客户端数', value: datum.clients }) }}
                />
                )}
              </Card>
            </Col>
          </Row>

          {/* 系统信息卡片 */}
          <Row gutter={16} style={{ marginBottom: 12 }}>
            <Col span={12}>
              <Card title="服务器信息" style={{ height: 'auto' }}>
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="服务器名称">{sections.server?.run_id || 'unknown'}</Descriptions.Item>
                  <Descriptions.Item label="绑定地址">{sections.server?.tcp_port || '6379'}</Descriptions.Item>
                  <Descriptions.Item label="连接数限制">{sections.clients?.maxclients || '10000'}</Descriptions.Item>
                  <Descriptions.Item label="总连接数">{sections.clients?.total_connections_received || 0}</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
            <Col span={12}>
              <Card title="内存统计" style={{ height: 'auto' }}>
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="已用内存">{bytesToMB(Number((sections.memory || {}).used_memory || 0))} MB</Descriptions.Item>
                  <Descriptions.Item label="已用内存峰值">{bytesToMB(Number((sections.memory || {}).used_memory_peak || 0))} MB</Descriptions.Item>
                  <Descriptions.Item label="内存碎片率">{(sections.memory || {}).mem_fragmentation_ratio || '1.00'}</Descriptions.Item>
                  <Descriptions.Item label="Lua引擎内存">{bytesToMB(Number((sections.memory || {}).used_memory_lua || 0))} MB</Descriptions.Item>
                </Descriptions>
              </Card>
            </Col>
          </Row>

          {/* 键空间分布 */}
          <Card title="键空间分布" style={{ marginBottom: 12 }}>
            {Object.entries(keyspace).length > 0 ? (
              <Row gutter={16}>
                <Col span={12}>
                  <Table
                    dataSource={Object.entries(keyspace).map(([db, data]) => ({ 
                      key: db, 
                      db, 
                      keys: data.keys, 
                      expires: data.expires, 
                      avgTtl: Math.floor(data.avg_ttl / 1000) // 转换为秒
                    }))}
                    columns={[
                      { title: '数据库', dataIndex: 'db', key: 'db' },
                      { title: '键数量', dataIndex: 'keys', key: 'keys' },
                      { title: '过期键数', dataIndex: 'expires', key: 'expires' },
                      { title: '平均过期时间 (秒)', dataIndex: 'avgTtl', key: 'avgTtl' }
                    ]}
                    pagination={false}
                    size="small"
                  />
                </Col>
                <Col span={12} style={{ height: 400 }}>
                  <Pie
                    data={Object.entries(keyspace).map(([db, data]) => ({ type: db, value: data.keys }))}
                    angleField="value"
                    colorField="type"
                    radius={0.8}
                    label={{ type: 'inner', offset: '-30%', content: '{name}: {percentage:.1%}' }}
                    interactions={[{ type: 'pie-legend-active' }, { type: 'element-active' }]}
                  />
                </Col>
              </Row>
            ) : (
              <div style={{ textAlign: 'center', padding: '50px 0', color: '#999' }}>
                暂无键空间数据
              </div>
            )}
          </Card>

          {/* 命令统计信息 */}
          <Card title="命令统计" style={{ marginBottom: 12 }}>
            <Table
              dataSource={displayCommandStats}
              columns={[
                { title: '命令', dataIndex: 'cmd', key: 'cmd' },
                { title: '调用次数', dataIndex: 'calls', key: 'calls' },
                { title: '总执行时间 (微秒)', dataIndex: 'usec', key: 'usec' },
                { title: '平均执行时间 (微秒)', dataIndex: 'usecPerCall', key: 'usecPerCall' },
                { title: '窗口调用次数', dataIndex: 'windowCalls', key: 'windowCalls' },
                { title: '窗口平均执行时间', dataIndex: 'windowUsecPerCall', key: 'windowUsecPerCall' },
                { title: '窗口速率 (次/秒)', dataIndex: 'windowRate', key: 'windowRate' }
              ]}
              pagination={{ pageSize: 10 }}
              size="small"
            />
          </Card>
        </>
      )}
    </div>
  );
};

export default RedisServiceInfoPage;
