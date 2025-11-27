import React, { useEffect, useMemo, useState } from 'react';
import { Card, Descriptions, Statistic, Row, Col, Tag, Space, Alert, Spin, Divider, Tabs, Progress, InputNumber, Select, Switch, Button, Typography, Table, Input, Dropdown, Menu } from 'antd';
// 导入Ant Design Charts组件
import { Line as ChartsLine, Area as ChartsArea } from '@ant-design/charts';
// 保留原有的@ant-design/plots组件用于对比
import { Line, Pie, Column, Area, DualAxes } from '@ant-design/plots';
import type { DatabaseConnection } from '../../types';
import { execRedisQueued, execRedisQueuedWithTimeout } from '../../utils/redis-exec-queue';
import './RedisServiceInfoPage.css';

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

// 确保数值转换安全的辅助函数
const safeToNumber = (value: any): number => {
  if (typeof value === 'number') return value;
  const num = Number(value);
  return isNaN(num) ? 0 : num;
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
  const HH = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${HH}:${mm}:${ss}`;
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
  // 集群模式状态
  const [isClusterMode, setIsClusterMode] = useState<boolean | null>(null);
  // 初始化连接池信息，确保页面加载时显示默认值
  const initPoolInfo = () => {
    return {
      poolSize: 0,
      idleConnections: 0,
      activeConnections: 0,
      poolId: ''
    };
  };
  
  // 数据库名称和连接池ID生成
  const databaseName = connection.type === 'redis' ? (connection.database !== undefined ? String(connection.database) : '0') : (connection.database !== undefined ? String(connection.database) : '');
  const poolId = connection.connectionId || `${(connection.type || 'redis').toLowerCase()}_${connection.host}_${connection.port}_${databaseName}`;
  
  // 连接池状态信息
  const [poolInfo, setPoolInfo] = useState<{poolSize: number; idleConnections: number; activeConnections: number; poolId: string}>(initPoolInfo());
  
  // 采样 & 趋势状态
  const [sampleWindow, setSampleWindow] = useState<number>(30);
  const [sampleIntervalMs, setSampleIntervalMs] = useState<number>(2000);
  // 初始化模拟数据，确保图表首次加载时有内容显示
  const initInfoSamples = () => {
    const now = Date.now();
    const samples = [];
    // 生成过去5分钟的模拟数据点
    for (let i = 29; i >= 0; i--) {
      const ts = now - i * 10000; // 每10秒一个点
      samples.push({
        ts,
        ops: 100 + Math.random() * 200, // 100-300的随机OPS
        mem: 50 * 1024 * 1024 + Math.random() * 200 * 1024 * 1024, // 50-250MB内存
        memRss: 70 * 1024 * 1024 + Math.random() * 250 * 1024 * 1024, // RSS略高
        memPeak: 200 * 1024 * 1024 + Math.random() * 100 * 1024 * 1024, // 峰值
        clients: 10 + Math.floor(Math.random() * 20), // 10-30个客户端连接
      });
    }
    return samples;
  };
  
  // 初始化为模拟数据，确保图表有内容显示
  const [infoSamples, setInfoSamples] = useState<Array<{ ts: number; ops: number; mem: number; memRss?: number; memPeak?: number; memDataset?: number; memLua?: number; clients: number; newConnsRate?: number; blocked?: number; netInKBps?: number; netOutKBps?: number }>>(initInfoSamples());
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
  
  // 连接池历史指标数据 - 使用空数组初始化，优先使用真实数据
  const [poolSamples, setPoolSamples] = useState<Array<{ 
    ts: number; 
    poolSize: number; 
    idleConnections: number; 
    activeConnections: number; 
    usageRate: number; 
    avgWaitTime?: number; 
    waitCount?: number; 
    timeoutCount?: number;
  }>>([]);
  const [hasRealPoolData, setHasRealPoolData] = useState(false); // 标记是否有真实的连接池数据

  // 根据分钟与采样间隔，派生样本窗口
  useEffect(() => {
    const count = Math.max(5, Math.round((windowMinutes * 60000) / sampleIntervalMs));
    setSampleWindow(count);
  }, [windowMinutes, sampleIntervalMs]);

  // 初始加载
  useEffect(() => {
    // 测试console.log是否正常工作
    console.log('RedisServiceInfoPage组件初始化 - 测试console.log');
    console.log(`console.log 功能检查: ${typeof console.log}`);
    
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
          // 确保使用正确的连接池ID，与后端实现保持一致
          let currentPoolId = connection.connectionId;
          let poolExists = false;
          
          // 检查连接池是否存在并有效
          const checkPool = async () => {
            if (currentPoolId) {
              poolExists = await (window as any).electronAPI?.getConnectionPoolConfig?.(currentPoolId) || false;
            }
            
            if (!poolExists) {
              // 如果连接池不存在或无效，尝试重新创建
              const res = await (window as any).electronAPI?.['create-connection-pool']?.({ config: connection, poolConfig: { 
                maxConnections: 5, 
                minConnections: 1, 
                testOnBorrow: true
              } });
              if (res?.success) {
                currentPoolId = res.poolId || '';
                // 更新连接对象的connectionId
                connection.connectionId = currentPoolId;
                poolExists = true;
              } else {
                // 如果直接创建失败，尝试重新连接数据库
                const connectRes = await (window as any).electronAPI?.connectDatabase?.(connection);
                if (connectRes?.success && connectRes?.connectionId) {
                  currentPoolId = connectRes.connectionId;
                  connection.connectionId = currentPoolId;
                  poolExists = true;
                } else {
                  // 最后尝试使用与主进程一致的ID生成逻辑
                  const databaseName = connection.type === 'redis' ? (connection.database !== undefined ? String(connection.database) : '0') : (connection.database !== undefined ? String(connection.database) : '');
                  currentPoolId = `${(connection.type || 'redis').toLowerCase()}_${connection.host}_${connection.port}_${databaseName}`;
                  // 再次检查是否存在
                  poolExists = await (window as any).electronAPI?.getConnectionPoolConfig?.(currentPoolId) || false;
                }
              }
            }
          };
          
          await checkPool();
          
          if (!poolExists || !currentPoolId) {
            throw new Error('无法获取或创建有效的连接池ID');
          }
        
        // 执行Redis命令获取真实数据
        const infoResult = await execRedisQueued(currentPoolId as string, 'INFO');
        
        // 尝试执行CLUSTER NODES命令，但在非集群环境下提供更友好的错误处理
        let clusterResult = null;
        let isClusterMode = false;
        try {
          clusterResult = await execRedisQueued(currentPoolId as string, 'CLUSTER', ['NODES']);
          if (clusterResult?.success && clusterResult.data) {
            isClusterMode = true;
            console.log('Redis实例处于集群模式');
          }
        } catch (error) {
          // 忽略所有CLUSTER命令相关的错误，这些在非集群模式下是正常的
          // 不设置全局错误状态，允许页面继续渲染
          console.log('检测到Redis实例处于非集群模式或不支持CLUSTER命令');
          // 设置为null表示没有集群信息，不影响页面其他部分显示
        }
        
        const cmdStatsResult = await execRedisQueued(currentPoolId as string, 'INFO', ['commandstats']);

        if (cancelled) return;

        // 检查执行结果是否成功
        if (!infoResult?.success) throw new Error('Failed to execute INFO command');
        // 仅在clusterResult不为null且我们期望成功结果时检查success
        if (isClusterMode && clusterResult !== null && !clusterResult?.success) {
          console.error('CLUSTER NODES命令执行失败，但Redis实例应处于集群模式');
          // 不抛出错误，而是设置标志以便UI中显示警告
        }
        if (!cmdStatsResult?.success) throw new Error('Failed to execute INFO commandstats');

        // 提取真实数据
        const infoData = infoResult.data;
        const clusterData = isClusterMode && clusterResult?.data ? clusterResult.data : '';
        const cmdStatsData = cmdStatsResult.data;

        // 解析数据
        const parsedSections = parseRedisInfo(infoData);
        setSections(parsedSections);
        
        // 更新集群节点信息和模式状态
        setClusterNodes(clusterData);
        setIsClusterMode(isClusterMode); // 更新组件状态
        // 在UI中显示Redis实例是否处于集群模式
        console.log(`Redis实例模式: ${isClusterMode ? '集群模式' : '单实例模式'}`);

        // 解析键空间信息
        const keyspaceSection = parsedSections.keyspace || {};
        const parsedKeyspace = parseKeyspace(Object.entries(keyspaceSection).map(([k, v]) => `${k}:${v}`).join('\n'));
        setKeyspace(parsedKeyspace);

        // 解析命令统计信息
        const commandStatsLines = cmdStatsData.split('\n');
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
          setCommandStats(stats);

          if (!cancelled) setLoading(false);
        } catch (err: any) {
          // 仅记录错误，不输出详细日志
          console.error('Redis信息加载失败:', err);
          if (!cancelled) {
            // 提供更友好的错误信息
            let errorMessage = '加载Redis服务信息失败';
            if (err.message) {
              if (err.message.includes('无法获取连接池ID')) {
                errorMessage = '无法连接到Redis连接池，请检查连接配置';
              } else {
                errorMessage = `加载失败: ${err.message}`;
              }
            }
            setError(errorMessage);
            setLoading(false);
          }
        } finally {
          // 尝试获取连接池信息，即使其他操作失败也尝试获取
          if (!cancelled && poolId) {
            try {
              const poolConfig = await (window as any).electronAPI?.getConnectionPoolConfig?.(poolId);
              if (poolConfig && poolConfig.poolSize > 0) {
                setHasRealPoolData(true);
                setPoolInfo({
                  poolSize: poolConfig.poolSize,
                  idleConnections: poolConfig.idleConnections || 0,
                  activeConnections: poolConfig.poolSize - (poolConfig.idleConnections || 0),
                  poolId: poolId
                });
              } else {
                // 如果无法获取有效的连接池配置，设置为无数据状态
                console.warn('无法获取有效的连接池配置');
                setHasRealPoolData(false);
                setPoolInfo(initPoolInfo());
              }
            } catch (err) {
              console.error('获取连接池信息失败:', err);
              setHasRealPoolData(false);
              setPoolInfo(initPoolInfo());
            }
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
        const currentTs = Date.now();
        
        // 并行获取Redis信息和连接池配置
        const [infoResult, poolConfig] = await Promise.all([
          execRedisQueued(poolId, 'INFO', ['stats', 'memory', 'clients', 'cpu']).catch(() => null),
          (window as any).electronAPI?.getConnectionPoolConfig?.(poolId).catch(() => null)
        ]);

        // 处理Redis信息采样
          if (infoResult) {
            const parsed = parseRedisInfo(infoResult);
            const mem = parsed.memory || {};
            const stats = parsed.stats || {};
            const clients = parsed.clients || {};

            // 计算 OPS (Operations Per Second)
            const totalCmds = safeToNumber(stats.total_commands_processed);
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
              mem: safeToNumber(mem.used_memory),
              memRss: safeToNumber(mem.used_memory_rss),
              memPeak: safeToNumber(mem.used_memory_peak),
              memDataset: safeToNumber(mem.used_memory_dataset),
              memLua: safeToNumber(mem.used_memory_lua),
              clients: safeToNumber(clients.connected_clients),
              blocked: safeToNumber(clients.blocked_clients)
            };
            
            setInfoSamples(prev => {
              const updated = [...prev, newSample];
              return updated.slice(-sampleWindow);
            });
          } else {
            console.warn('无法获取Redis真实数据，生成模拟数据以保持图表显示');
            // 生成模拟数据以保持图表有内容显示
            const mockOps = 100 + Math.random() * 200; // 100-300的随机OPS
            const mockClients = 10 + Math.floor(Math.random() * 20); // 10-30个客户端连接
            
            const mockSample = {
              ts: currentTs,
              ops: mockOps,
              mem: 50 * 1024 * 1024 + Math.random() * 200 * 1024 * 1024,
              clients: mockClients,
              blocked: Math.floor(Math.random() * 5)
            };
            
            setInfoSamples(prev => {
              const updated = [...prev, mockSample];
              return updated.slice(-sampleWindow);
            });
          }

        // 处理连接池采样
        if (poolConfig && poolConfig.poolSize > 0) {
          setHasRealPoolData(true);
          const activeConn = poolConfig.poolSize - (poolConfig.idleConnections || 0);
          const usageRate = poolConfig.poolSize > 0 ? (activeConn / poolConfig.poolSize) * 100 : 0;
          
          const newPoolSample = {
            ts: currentTs,
            poolSize: poolConfig.poolSize,
            idleConnections: poolConfig.idleConnections || 0,
            activeConnections: activeConn,
            usageRate: Number(usageRate.toFixed(1)),
            avgWaitTime: poolConfig.avgWaitTime || 0,
            waitCount: poolConfig.waitCount || 0,
            timeoutCount: poolConfig.timeoutCount || 0
          };
          
          setPoolSamples(prev => {
            const updated = [...prev, newPoolSample];
            return updated.slice(-sampleWindow);
          });
        } else if (poolSamples.length > 0) {
          // 如果没有有效的连接池数据但已有历史数据，清空采样数据
          setPoolSamples([]);
          setHasRealPoolData(false);
        }
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
        const av = safeToNumber(a[sortKey]);
        const bv = safeToNumber(b[sortKey]);
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
      const windowCalls = Math.max(0, safeToNumber(last?.calls) - safeToNumber(first?.calls));
      const windowUsec = Math.max(0, safeToNumber(last?.usec) - safeToNumber(first?.usec));
      const windowUsecPerCall = windowCalls > 0 ? Number((windowUsec / windowCalls).toFixed(2)) : safeToNumber(last?.upc);
      const elapsedSec = Math.max(1, ((last?.ts ?? 0) - (first?.ts ?? 0)) / 1000);
      const windowRate = Number((windowCalls / elapsedSec).toFixed(2));
      return { ...c, windowCalls, windowUsecPerCall, windowRate };
    });
    
    merged.sort((a: any, b: any) => {
      const key = ['windowCalls','windowUsecPerCall','windowRate'].includes(commandSortKey) ? commandSortKey : commandSortKey;
      const av = safeToNumber(a[key]);
      const bv = safeToNumber(b[key]);
      return commandSortOrder === 'desc' ? (bv - av) : (av - bv);
    });
    
    return merged.slice(0, Math.max(1, topN || 10));
  }, [commandStats, cmdSamples, cmdViewMode, commandSortKey, commandSortOrder, topN]);

  // 概览数据
  const overview = useMemo(() => {
    const server = sections.server || {};
    const clients = sections.clients || {};
    const stats = sections.stats || {};
    const uptimeSec = safeToNumber(server.uptime_in_seconds);
    
    // 计算缓存命中率，避免除以0
    const hits = safeToNumber(stats.keyspace_hits);
    const misses = safeToNumber(stats.keyspace_misses);
    const hitRate = (hits + misses) > 0 ? (hits / (hits + misses)) * 100 : 0;
    
    return {
      role: server.redis_role || 'master',
      version: server.redis_version || 'unknown',
      uptimeDays: Math.floor(uptimeSec / (3600 * 24)),
      connectedClients: safeToNumber(clients.connected_clients),
      usedMemory: safeToNumber((sections.memory || {}).used_memory),
      totalKeys: Object.values(keyspace).reduce((sum, db) => sum + db.keys, 0),
      totalCommands: safeToNumber(stats.total_commands_processed),
      hitRate
    };
  }, [sections, keyspace]);

  return (
    <div style={{ padding: 12, height: 'calc(100vh - 180px)', overflow: 'auto', background: 'transparent' }}>
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
                value={isNaN(overview.hitRate) ? 0 : Number(overview.hitRate.toFixed(2))} 
                suffix="%" 
                valueStyle={{ color: overview.hitRate > 90 ? '#3f8600' : '#cf1322' }}
              /></Col>
            </Row>
            {isClusterMode !== null && (
              <div style={{ marginTop: 12 }}>
                <Space>
                  <Tag color={isClusterMode ? "blue" : "green"}>
                    Redis模式: {isClusterMode ? "集群模式" : "单实例模式"}
                  </Tag>
                </Space>
              </div>
            )}
          </Card>
          
          {/* 连接池状态卡片 - 只在有真实数据时显示 */}
          {hasRealPoolData && (
            <Card title="连接池状态" style={{ marginBottom: 12 }}>
              <Row gutter={16}>
                <Col span={6}>
                  <Statistic 
                    title="连接池大小" 
                    value={poolInfo.poolSize} 
                    suffix="" 
                    valueStyle={{ color: '#007BFF' }}
                  />
                </Col>
                <Col span={6}>
                  <Statistic 
                    title="空闲连接数" 
                    value={poolInfo.idleConnections} 
                    suffix="" 
                    valueStyle={{ color: '#3f8600' }}
                  />
                </Col>
                <Col span={6}>
                  <Statistic 
                    title="活动连接数" 
                    value={poolInfo.activeConnections} 
                    suffix="" 
                    valueStyle={{ color: poolInfo.activeConnections > poolInfo.poolSize * 0.8 ? '#cf1322' : '#1677ff' }}
                  />
                </Col>
                <Col span={6}>
                  <Statistic 
                    title="连接使用率" 
                    value={Number(((poolInfo.activeConnections / poolInfo.poolSize) * 100).toFixed(1))} 
                    suffix="%" 
                    valueStyle={{ 
                      color: (poolInfo.activeConnections / poolInfo.poolSize) > 0.8 ? '#cf1322' : '#1677ff' 
                    }}
                  />
                </Col>
              </Row>
              {poolInfo.poolId && (
                <div style={{ marginTop: 12, fontSize: 12, color: '#666' }}>
                  <Tag color="blue">连接池ID: {poolInfo.poolId}</Tag>
                </div>
              )}
            </Card>
          )}

          {/* 性能指标图表 */}
          <Row gutter={16} style={{ marginBottom: 16 }}>
            {/* 性能指标图表 - 已隐藏，原因：当前展示的都是假数据，无法获取真实数据，tooltip显示不正确 */}
            {/* <Row gutter={16} style={{ marginBottom: 12 }}>
              <Col span={12}>
                <Card title="OPS (每秒操作数)" className="chart-card">
                  <div className="chart-container">
                    {infoSamples.length > 0 && (
                      <ChartsLine
                        data={infoSamples.map(sample => ({ time: fmtTime(sample.ts), ops: sample.ops }))}
                        xField="time"
                        yField="ops"
                        point={{ 
                          shape: 'circle', 
                          size: 4,
                          style: { 
                            fill: '#40a9ff', 
                            strokeWidth: 2, 
                            stroke: '#fff' 
                          } 
                        }}
                        line={{ 
                          size: 3, 
                          color: '#40a9ff' 
                        }}
                        x={{
                          type: 'cat',
                          label: {
                            autoHide: true,
                            autoRotate: false,
                            rotate: 45,
                            style: {
                              fill: '#333',
                              fontWeight: 'bold'
                            }
                          }
                        }}
                        y={{
                          type: 'number',
                          title: {
                            text: '操作数/秒',
                            style: {
                              fill: '#333',
                              fontWeight: 'bold'
                            }
                          },
                          label: {
                            style: {
                              fill: '#333',
                              fontWeight: 'bold'
                            }
                          }
                        }}
                        tooltip={{
                          showCrosshairs: true,
                          shared: true,
                          formatter: (datum: any) => {
                            // 添加调试日志，查看datum的实际类型和值
                            console.log('OPS图表tooltip datum:', typeof datum, datum);
                            
                            // 检查datum是否为数组
                            if (Array.isArray(datum)) {
                              // 处理数组情况，返回数组格式
                              return datum.map(item => ({
                                name: 'OPS',
                                value: (item?.ops || 0).toFixed(2)
                              }));
                            } else if (datum && typeof datum === 'object') {
                              // 处理单个对象情况
                              return {
                                name: 'OPS',
                                value: (datum.ops || 0).toFixed(2)
                              };
                            }
                            // 异常情况返回空字符串
                            return '';
                          }
                        }}
                        smooth
                      />
                    )}
                    {infoSamples.length === 0 && (
                      <div className="no-data">暂无数据</div>
                    )}
                  </div>
                </Card>
              </Col>
            </Row> */}

            {/* 客户端连接数和等待与超时计数图表 - 已隐藏，原因：当前展示的都是假数据，无法获取真实数据，tooltip显示不正确 */}
            {/* <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={12}>
                <Card title="客户端连接数" className="chart-card">
                  <div className="chart-container">
                    {infoSamples.length > 0 && (
                      <ChartsArea
                        data={infoSamples.map(sample => ({ time: fmtTime(sample.ts), clients: sample.clients }))}
                        xField="time"
                        yField="clients"
                        line={{
                          size: 3,
                          color: '#fa8c16',
                          style: {
                            opacity: 1
                          }
                        }}
                        area={{
                          fill: 'l(270) 0:#ffffff33 0.5:#fa8c1688 1:#fa8c16'
                        }}
                        x={{
                          type: 'cat',
                          label: {
                            rotate: 45,
                            style: {
                              fill: '#333',
                              fontWeight: 'bold'
                            }
                          }
                        }}
                        y={{
                          type: 'number',
                          title: {
                            text: '连接数',
                            style: {
                              fill: '#333',
                              fontWeight: 'bold'
                            }
                          },
                          label: {
                            style: {
                              fill: '#333',
                              fontWeight: 'bold'
                            }
                          }
                        }}
                        tooltip={{
                          showCrosshairs: true,
                          shared: true,
                          formatter: (datum: any) => {
                            // 添加调试日志，查看datum的实际类型和值
                            console.log('客户端连接数图表tooltip datum:', typeof datum, datum);
                            
                            // 检查datum是否为数组
                            if (Array.isArray(datum)) {
                              // 处理数组情况，返回数组格式
                              return datum.map(item => ({
                                name: '客户端数',
                                value: item?.clients || 0
                              }));
                            } else if (datum && typeof datum === 'object') {
                              // 处理单个对象情况
                              return {
                                name: '客户端数',
                                value: datum.clients || 0
                              };
                            }
                            // 异常情况返回空字符串
                            return '';
                          }
                        }}
                      />
                    )}
                    {infoSamples.length === 0 && (
                      <div className="no-data">暂无数据</div>
                    )}
                  </div>
                </Card>
              </Col>
                        {/* 等待与超时计数图表 - 只在有真实数据时显示 */}
            {hasRealPoolData && (
              <Col span={12}>
                <Card title="等待与超时计数" className="chart-card">
                  <div className="chart-container">
                    {poolSamples.length > 0 && (
                      <ChartsArea
                        data={poolSamples.map(sample => ({ 
                          time: fmtTime(sample.ts), 
                          waitCount: Number(sample.waitCount || 0),
                          timeoutCount: Number(sample.timeoutCount || 0)
                        }))}
                        xField="time"
                        yField={['waitCount', 'timeoutCount']}
                        seriesField="type"
                        line={{
                          size: 3
                        }}
                        area={{
                          fillOpacity: 0.8
                        }}
                        colorField="type"
                        x={{
                          type: 'cat',
                          label: {
                            rotate: 45,
                            style: {
                              fill: '#333',
                              fontWeight: 'bold'
                            }
                          }
                        }}
                        y={{
                          type: 'number',
                          title: {
                            text: '数量',
                            style: {
                              fill: '#333',
                              fontWeight: 'bold'
                            }
                          },
                          label: {
                            style: {
                              fill: '#333',
                              fontWeight: 'bold'
                            }
                          }
                        }}
                        tooltip={{
                          showCrosshairs: true,
                          shared: true,
                          formatter: (datum: any) => {
                            // 添加调试日志，查看datum的实际类型和值
                            // 同时输出到控制台，便于查看
                            console.log('等待与超时计数图表tooltip datum:', typeof datum, datum);
                            
                            const result = [];
                            // 处理数组类型的datum（多数据点情况）
                            if (Array.isArray(datum)) {
                              datum.forEach(item => {
                                if (item.waitCount !== undefined) {
                                  result.push({
                                    name: '等待次数',
                                    value: item.waitCount || 0
                                  });
                                }
                                if (item.timeoutCount !== undefined) {
                                  result.push({
                                    name: '超时次数',
                                    value: item.timeoutCount || 0
                                  });
                                }
                              });
                            } else if (datum && typeof datum === 'object') {
                              // 处理单个对象类型的datum
                              if (datum.waitCount !== undefined) {
                                result.push({
                                  name: '等待次数',
                                  value: datum.waitCount || 0
                                });
                              }
                              if (datum.timeoutCount !== undefined) {
                                result.push({
                                  name: '超时次数',
                                  value: datum.timeoutCount || 0
                                });
                              }
                            }
                            return result;
                          }
                        }}
                        legend={{
                          position: 'top',
                          itemName: {
                            style: {
                              fill: '#333'
                            }
                          }
                        }}
                      />
                    )}
                    {poolSamples.length === 0 && (
                      <div className="no-data">暂无数据</div>
                    )}
                  </div>
                </Card>
              </Col>
            )}
          </Row>
          
          {/* 连接池使用率趋势图表 - 已隐藏，原因：当前展示的都是假数据，无法获取真实数据，tooltip显示不正确 */}
          {/* {hasRealPoolData && (
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col span={24}>
                <Card title="连接池使用率趋势" className="chart-card">
                  <div className="chart-container">
                    {poolSamples.length > 0 && (
                      <Line
                        data={poolSamples.map(sample => ({ 
                          time: fmtTime(sample.ts), 
                          usageRate: sample.usageRate,
                          activeConnections: sample.activeConnections,
                          poolSize: sample.poolSize
                        }))}
                        xField="time"
                        yField={['usageRate', 'activeConnections', 'poolSize']}
                        geometry={[
                          { type: 'line', yField: 'usageRate', smooth: true, color: '#40a9ff', name: '使用率', style: { lineWidth: 3, opacity: 1 } },
                          { type: 'line', yField: 'activeConnections', smooth: true, color: '#52c41a', name: '活跃连接', style: { lineWidth: 3, opacity: 1 } },
                          { type: 'line', yField: 'poolSize', smooth: true, color: '#ffeb3b', name: '池大小', style: { lineWidth: 3, lineDash: [4, 4], opacity: 1 } }
                        ]}
                        xAxis={{ type: 'cat', label: { rotate: 45, fill: '#333', fontWeight: 'bold' } }}
                        yAxis={[
                          { title: { text: '使用率 (%)', fill: '#333', fontWeight: 'bold' }, position: 'left', min: 0, max: 100, label: { fill: '#333', fontWeight: 'bold' } },
                          { title: { text: '连接数', fill: '#333', fontWeight: 'bold' }, position: 'right', min: 0, label: { fill: '#333', fontWeight: 'bold' } }
                        ]}
                        tooltip={{ 
                          showCrosshairs: true,
                          shared: true,
                          formatter: (datum: any) => {
                            if (!datum) return '';
                            return `时间: ${datum.time || ''}\n使用率: ${datum.usageRate || 0}%\n活跃连接: ${datum.activeConnections || 0}\n池大小: ${datum.poolSize || 0}`;
                          }
                        }}
                        legend={{ position: 'top', text: { fill: '#333' } }}
                      />
                    )}
                    {poolSamples.length === 0 && (
                      <div className="no-data">暂无数据</div>
                    )}
                  </div>
                </Card>
              </Col>
            )} */}

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

          {/* 内存使用情况表格 */}
          <Card title="内存使用情况" style={{ marginBottom: 12 }}>
            {Object.keys(sections.memory || {}).length > 0 ? (
              <Table
                className="redis-table"
                dataSource={[
                  { key: 'used_memory', name: '已用内存', value: `${bytesToMB(safeToNumber((sections.memory || {}).used_memory))} MB` },
                  { key: 'used_memory_human', name: '已用内存', value: (sections.memory || {}).used_memory_human || '0 MB' },
                  { key: 'used_memory_rss', name: '操作系统分配的内存', value: `${bytesToMB(safeToNumber((sections.memory || {}).used_memory_rss))} MB` },
                  { key: 'used_memory_rss_human', name: '操作系统分配的内存', value: (sections.memory || {}).used_memory_rss_human || '0 MB' },
                  { key: 'used_memory_peak', name: '内存使用峰值', value: `${bytesToMB(safeToNumber((sections.memory || {}).used_memory_peak))} MB` },
                  { key: 'used_memory_peak_human', name: '内存使用峰值', value: (sections.memory || {}).used_memory_peak_human || '0 MB' },
                  { key: 'used_memory_lua', name: 'Lua引擎使用内存', value: `${bytesToMB(safeToNumber((sections.memory || {}).used_memory_lua))} MB` },
                  { key: 'used_memory_lua_human', name: 'Lua引擎使用内存', value: (sections.memory || {}).used_memory_lua_human || '0 MB' },
                  { key: 'mem_fragmentation_ratio', name: '内存碎片率', value: safeToNumber((sections.memory || {}).mem_fragmentation_ratio) || '1.00' },
                  { key: 'used_memory_dataset', name: '数据集使用内存', value: `${bytesToMB(safeToNumber((sections.memory || {}).used_memory_dataset))} MB` },
                  { key: 'used_memory_dataset_human', name: '数据集使用内存', value: (sections.memory || {}).used_memory_dataset_human || '0 MB' },
                ]}
                columns={[
                  { title: '指标', dataIndex: 'name', key: 'name' },
                  { title: '值', dataIndex: 'value', key: 'value' },
                ]}
                pagination={{ 
                  pageSize: 10,
                  prevIcon: <span style={{ color: '#333' }}>‹</span>,
                  nextIcon: <span style={{ color: '#333' }}>›</span>
                }}
                size="small"
              />
            ) : (
              <div style={{ textAlign: 'center', padding: '50px 0', color: '#999' }}>
                暂无内存使用情况数据
              </div>
            )}
          </Card>

          {/* 键空间分布 */}
          <Card title="键空间分布" style={{ marginBottom: 12 }}>
            {Object.entries(keyspace).length > 0 ? (
              <Row gutter={16}>
                <Col span={12}>
                  <Table
                    className="redis-table"
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
                {/* 键空间分布Pie图表 - 已隐藏，原因：当前展示的都是假数据，无法获取真实数据 */}
                {/* <Col span={12} style={{ height: 400 }}>
                  <Pie
                      data={Object.entries(keyspace).map(([db, data]) => ({ type: db, value: data.keys }))}
                      angleField="value"
                      colorField="type"
                      radius={0.8}
                      color={['#40a9ff', '#52c41a', '#fa8c16', '#ff4d4f', '#722ed1', '#eb2f96']}
                      label={{ type: 'inner', offset: '-30%', content: '{name}: {percentage:.1%}', style: { fill: '#333', fontWeight: 'bold' } }}
                      interactions={[{ type: 'pie-legend-active' }, { type: 'element-active' }]}
                    />
                </Col> */}
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
              className="redis-table"
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
              pagination={{ 
                pageSize: 10,
                prevIcon: <span style={{ color: '#333' }}>‹</span>,
                nextIcon: <span style={{ color: '#333' }}>›</span>
              }}
              size="small"
            />
          </Card>
        </>
      )}
    </div>
  );
};

export default RedisServiceInfoPage;




