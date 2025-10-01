import React, { useState } from 'react';
import { Tabs, Card, Row, Col, Statistic, Table, Space, Button, Tag } from 'antd';
import { DatabaseOutlined, TableOutlined, BarChartOutlined, CodeOutlined, SettingOutlined } from '@ant-design/icons';
import { DatabaseConnection, DatabaseType } from '../types';
import QueryPanel from './QueryPanel';
import DataPanel from './DataPanel';

const { TabPane } = Tabs;

interface DatabaseTabPanelProps {
  connection: DatabaseConnection | null;
  database: string;
  type: DatabaseType;
  darkMode: boolean;
}

const DatabaseTabPanel: React.FC<DatabaseTabPanelProps> = ({
  connection,
  database,
  type,
  darkMode
}) => {
  const [activeTab, setActiveTab] = useState('tables');
  const [activeTable, setActiveTable] = useState<string>('');

  // 模拟数据库统计信息
  const databaseStats = {
    tableCount: 24,
    totalSize: '2.4 GB',
    rowCount: 1250000,
    indexCount: 48
  };

  // 模拟表列表
  const tableList = [
    { name: 'users', rows: 50000, size: '450 MB', created: '2023-01-15', comment: '用户信息表', engine: 'InnoDB' },
    { name: 'orders', rows: 800000, size: '1.2 GB', created: '2023-02-20', comment: '订单信息表', engine: 'InnoDB' },
    { name: 'products', rows: 15000, size: '120 MB', created: '2023-01-10', comment: '产品信息表', engine: 'InnoDB' },
    { name: 'categories', rows: 500, size: '2 MB', created: '2023-01-08', comment: '分类信息表', engine: 'MyISAM' },
    { name: 'logs', rows: 400000, size: '650 MB', created: '2023-03-01', comment: '系统日志表', engine: 'MyISAM' }
  ];

  // 模拟最近查询
  const recentQueries = [
    { query: 'SELECT * FROM users WHERE status = \'active\'', time: '2.3s', rows: 15000 },
    { query: 'UPDATE orders SET status = \'completed\' WHERE created_at < \'2023-06-01\'', time: '1.8s', rows: 120000 },
    { query: 'CREATE INDEX idx_users_email ON users(email)', time: '0.5s', rows: 0 }
  ];

  const handleTableSelect = (tableName: string) => {
    setActiveTable(tableName);
    setActiveTab('data');
  };

  const getDatabaseColor = (dbType: DatabaseType) => {
    const colors = {
      mysql: '#00758f',
      postgresql: '#336791',
      oracle: '#c74634',
      sqlite: '#003b57',
      redis: '#a41e11',
      gaussdb: '#1890ff'
    };
    return colors[dbType] || '#666';
  };

  const tableColumns = [
    {
      title: '表名',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => (
        <Button 
          type="link" 
          onClick={() => handleTableSelect(text)}
          icon={<TableOutlined />}
        >
          {text}
        </Button>
      )
    },
    {
      title: '表注释',
      dataIndex: 'comment',
      key: 'comment',
      width: 150
    },
    {
      title: '数据库引擎',
      dataIndex: 'engine',
      key: 'engine',
      width: 120
    },
    {
      title: '行数',
      dataIndex: 'rows',
      key: 'rows',
      render: (rows: number) => rows.toLocaleString()
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size'
    },
    {
      title: '创建时间',
      dataIndex: 'created',
      key: 'created'
    }
  ];

  const queryColumns = [
    {
      title: '查询语句',
      dataIndex: 'query',
      key: 'query',
      render: (text: string) => (
        <code style={{ fontSize: '12px', background: '#f5f5f5', padding: '2px 4px', borderRadius: '3px' }}>
          {text.length > 80 ? text.substring(0, 80) + '...' : text}
        </code>
      )
    },
    {
      title: '执行时间',
      dataIndex: 'time',
      key: 'time',
      width: 80
    },
    {
      title: '影响行数',
      dataIndex: 'rows',
      key: 'rows',
      width: 100,
      render: (rows: number) => rows.toLocaleString()
    }
  ];

  return (
    <div className="database-tab-panel">
      {/* 数据库头部信息 */}
      <Card 
        className="database-header-card"
        bodyStyle={{ padding: '16px 24px' }}
      >
        <Row gutter={16} align="middle">
          <Col flex="none">
            <div 
              className="database-icon"
              style={{ 
                backgroundColor: getDatabaseColor(type),
                width: 48,
                height: 48,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: 20
              }}
            >
              <DatabaseOutlined />
            </div>
          </Col>
          <Col flex="auto">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
                  {database}
                </h2>
                <Space size={8} style={{ marginTop: 4 }}>
                  <Tag color={getDatabaseColor(type)}>{type.toUpperCase()}</Tag>
                  <span style={{ color: '#666', fontSize: 12 }}>
                    连接: {connection?.name || '-'}
                  </span>
                </Space>
              </div>
              <Space>
                <Statistic title="表数量" value={databaseStats.tableCount} />
                <Statistic title="总大小" value={databaseStats.totalSize} />
                <Statistic title="总行数" value={databaseStats.rowCount} formatter={value => 
                  Number(value).toLocaleString()
                } />
              </Space>
            </div>
          </Col>
        </Row>
      </Card>

      {/* 标签页内容 */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        className="database-tabs"
        items={[
          {
            key: 'tables',
            label: (
              <span>
                <TableOutlined />
                表对象
              </span>
            ),
            children: (
              <div style={{ padding: '24px 0' }}>
                <Card title="表列表" size="small">
                  <Table
                    dataSource={tableList}
                    columns={tableColumns}
                    pagination={false}
                    size="small"
                    rowKey="name"
                  />
                </Card>
              </div>
            )
          },
          {
            key: 'recent-queries',
            label: (
              <span>
                <BarChartOutlined />
                最近查询
              </span>
            ),
            children: (
              <div style={{ padding: '24px 0' }}>
                <Card title="最近查询" size="small">
                  <Table
                    dataSource={recentQueries}
                    columns={queryColumns}
                    pagination={false}
                    size="small"
                    rowKey="query"
                  />
                </Card>
              </div>
            )
          },
          {
            key: 'data',
            label: (
              <span>
                <DatabaseOutlined />
                数据
              </span>
            ),
            children: (
              <DataPanel
                connection={connection}
                database={database}
                table={activeTable}
              />
            )
          },
          {
            key: 'structure',
            label: (
              <span>
                <SettingOutlined />
                结构
              </span>
            ),
            children: (
              <div style={{ padding: '24px', textAlign: 'center', color: '#666' }}>
                <DatabaseOutlined style={{ fontSize: 48, marginBottom: 16 }} />
                <p>数据库结构查看功能开发中...</p>
              </div>
            )
          }
        ]}
      />
    </div>
  );
};

export default DatabaseTabPanel;