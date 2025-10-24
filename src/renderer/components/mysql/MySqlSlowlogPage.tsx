import React, { useEffect, useMemo, useState } from 'react';
import { Card, Table, Space, Typography, Alert, Divider, Button } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { DatabaseConnection } from '../../types';
import dayjs from 'dayjs';

interface Props {
  connection: DatabaseConnection;
  database: string;
  darkMode?: boolean;
}

interface SlowLogRow {
  start_time: string | Date;
  query_time_ms: number;
  lock_time_ms: number;
  rows_examined: number;
  sql_text: string;
}

const MySqlSlowlogPage: React.FC<Props> = ({ connection, database, darkMode }) => {
  const [rows, setRows] = useState<SlowLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{ slow_query_log?: string; log_output?: string; long_query_time?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connectionId = useMemo(() => connection?.connectionId || connection?.id, [connection]);

  const columns: ColumnsType<SlowLogRow> = [
    {
      title: '开始时间',
      dataIndex: 'start_time',
      key: 'start_time',
      width: 180,
      render: (v: any) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm:ss') : '')
    },
    { title: '耗时(ms)', dataIndex: 'query_time_ms', key: 'query_time_ms', width: 110 },
    { title: '锁等待(ms)', dataIndex: 'lock_time_ms', key: 'lock_time_ms', width: 120 },
    { title: '行数', dataIndex: 'rows_examined', key: 'rows_examined', width: 100 },
    {
      title: '示例SQL',
      dataIndex: 'sql_text',
      key: 'sql_text',
      render: (text: string) => (
        <Typography.Paragraph ellipsis={{ rows: 2 }} copyable style={{ marginBottom: 0 }}>
          {text}
        </Typography.Paragraph>
      )
    }
  ];

  useEffect(() => {
    let mounted = true;

    const fetchDiagnostics = async () => {
      try {
        const sql = "SHOW VARIABLES WHERE Variable_name IN ('slow_query_log','log_output','long_query_time')";
        const res = await window.electronAPI.executeQuery(connectionId, sql);
        if (res?.success && Array.isArray(res.data)) {
          const diag: any = {};
          for (const r of res.data) {
            const name = (r.Variable_name || r.variable_name || '').toLowerCase();
            const val = r.Value || r.value;
            if (name) diag[name] = String(val);
          }
          if (mounted) setDiagnostics(diag);
        }
      } catch (e) {
        // 诊断信息失败不阻断主流程
      }
    };

    const fetchSlowLogs = async () => {
      if (!connectionId) return;
      setLoading(true);
      setError(null);
      try {
        const limit = 100;
        const offset = 0;
        const whereDb = database ? 'WHERE db = ?' : '';
        const sql = `SELECT start_time, TIME_TO_SEC(query_time)*1000 AS query_time_ms, TIME_TO_SEC(lock_time)*1000 AS lock_time_ms, rows_examined, sql_text FROM mysql.slow_log ${whereDb} ORDER BY start_time DESC LIMIT ? OFFSET ?`;
        const params = database ? [database, limit, offset] : [limit, offset];
        const res = await window.electronAPI.executeQuery(connectionId, sql, params);
        if (res?.success && Array.isArray(res.data)) {
          if (mounted) setRows(res.data as SlowLogRow[]);
        } else {
          throw new Error(res?.error || res?.message || '查询失败');
        }
      } catch (e: any) {
        // 常见异常：mysql.slow_log 不存在或 log_output != TABLE
        if (mounted) setError(e?.message || String(e));
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchDiagnostics();
    fetchSlowLogs();

    return () => {
      mounted = false;
    };
  }, [connectionId, database]);

  const showDiagAlert = useMemo(() => {
    if (!diagnostics) return null;
    const slowOn = diagnostics.slow_query_log?.toLowerCase() === 'on' || diagnostics.slow_query_log === '1';
    const isTable = (diagnostics.log_output || '').toUpperCase() === 'TABLE';
    if (!slowOn || !isTable) {
      const msg = [
        !slowOn ? '当前 slow_query_log 未开启（OFF），将无法记录慢查询。' : null,
        !isTable ? '当前 log_output 不是 TABLE，无法通过 mysql.slow_log 表读取慢日志。' : null,
        diagnostics.long_query_time ? `long_query_time = ${diagnostics.long_query_time} 秒` : null
      ].filter(Boolean).join(' ');
      return (
        <Alert
          type="warning"
          showIcon
          message="慢日志未完全可用"
          description={msg}
        />
      );
    }
    return null;
  }, [diagnostics]);

  return (
    <div style={{ padding: 12 }}>
      <Card title="MySQL 慢日志" bordered>
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {showDiagAlert}
          {error && (
            <Alert type="error" showIcon message="查询失败" description={error} />
          )}
          <Table
            size="small"
            rowKey={(r, idx) => String(idx)}
            columns={columns}
            dataSource={rows}
            pagination={{ pageSize: 50 }}
            loading={loading}
          />
          {!rows?.length && !loading && (
            <Typography.Text type="secondary">
              暂无慢日志数据。若已开启 slow_query_log 且 log_output=TABLE，请稍后重试。
            </Typography.Text>
          )}
          <Divider style={{ margin: '12px 0' }} />
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            后续将支持按照时间范围、最小耗时阈值与关键字进行筛选，并提供导出功能。
          </Typography.Paragraph>
        </Space>
      </Card>
    </div>
  );
};

export default MySqlSlowlogPage;