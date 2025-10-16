import React from 'react';
import { DatabaseConnection } from '../../types';
import { BaseQueryPanelProps } from './types';
import MySqlQueryPanel from './MySqlQueryPanel';
import PostgreSqlQueryPanel from './PostgreSqlQueryPanel';

// 默认查询面板组件（如果没有匹配的数据库类型）
const DefaultQueryPanel: React.FC<BaseQueryPanelProps> = ({ connection, database, tabKey, onTabClose, darkMode }) => {
  return (
    <div style={{ 
      padding: '20px', 
      textAlign: 'center', 
      color: darkMode ? '#999' : '#666' 
    }}>
      <h3>不支持的数据库类型</h3>
      <p>当前数据库类型: {connection?.type || '未知'}</p>
      <p>请使用MySQL或PostgreSQL数据库</p>
    </div>
  );
};

interface QueryPanelFactoryProps extends BaseQueryPanelProps {
  // 可以添加额外的工厂配置属性
}

const QueryPanelFactory: React.FC<QueryPanelFactoryProps> = ({ 
  connection, 
  database, 
  tabKey, 
  onTabClose, 
  darkMode 
}) => {
  // 根据数据库类型选择对应的查询面板组件
  const getQueryPanelComponent = () => {
    switch (connection?.type) {
      case 'mysql':
        return MySqlQueryPanel;
      case 'postgresql':
        return PostgreSqlQueryPanel;
      default:
        return DefaultQueryPanel;
    }
  };

  const QueryPanelComponent = getQueryPanelComponent();

  return (
    <QueryPanelComponent
      connection={connection}
      database={database}
      tabKey={tabKey}
      onTabClose={onTabClose}
      darkMode={darkMode}
    />
  );
};

export default QueryPanelFactory;