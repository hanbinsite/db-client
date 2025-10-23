import React from 'react';
import { Card, Table } from 'antd';
import type { DatabaseConnection } from '../../types';

interface Props {
  connection: DatabaseConnection;
  database: string;
  darkMode?: boolean;
}

const columns = [
  { title: '开始时间', dataIndex: 'start_time', key: 'start_time' },
  { title: '耗时(ms)', dataIndex: 'query_time_ms', key: 'query_time_ms' },
  { title: '锁等待(ms)', dataIndex: 'lock_time_ms', key: 'lock_time_ms' },
  { title: '行数', dataIndex: 'rows_examined', key: 'rows_examined' },
  { title: '示例SQL', dataIndex: 'sql_text', key: 'sql_text' }
];

const MySqlSlowlogPage: React.FC<Props> = ({ connection, database, darkMode }) => {
  return (
    <div style={{ padding: 12 }}>
      <Card title="MySQL 慢日志" bordered>
        <Table
          size="small"
          rowKey={(r, idx) => String(idx)}
          columns={columns}
          dataSource={[]}
          pagination={false}
        />
        <div style={{ marginTop: 12, color: '#888' }}>
          暂未接入服务端查询，后续将展示slow_query日志与分析。
        </div>
      </Card>
    </div>
  );
};

export default MySqlSlowlogPage;