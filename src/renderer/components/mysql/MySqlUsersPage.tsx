import React from 'react';
import { Card, Table } from 'antd';
import type { DatabaseConnection } from '../../types';

interface Props {
  connection: DatabaseConnection;
  database: string;
  darkMode?: boolean;
}

type UserRow = { user: string; host: string; privs?: string };

const columns: any[] = [
  { title: '用户名', dataIndex: 'user', key: 'user' },
  { title: '主机', dataIndex: 'host', key: 'host' },
  { title: '权限概要', dataIndex: 'privs', key: 'privs' }
];

const MySqlUsersPage: React.FC<Props> = ({ connection, database, darkMode }) => {
  return (
    <div style={{ padding: 12 }}>
      <Card title="MySQL 用户信息" bordered>
        <Table<UserRow>
          size="small"
          rowKey={(r) => `${r.user}@${r.host}`}
          columns={columns}
          dataSource={[]}
          pagination={false}
        />
        <div style={{ marginTop: 12, color: '#888' }}>
          暂未接入服务端查询，后续将展示用户、主机与权限信息。
        </div>
      </Card>
    </div>
  );
};

export default MySqlUsersPage;