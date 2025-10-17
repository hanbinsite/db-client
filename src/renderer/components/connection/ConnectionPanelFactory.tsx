import React from 'react';
import { ConnectionPanelFactoryProps } from './types';
import MySqlConnectionPanel from './MySqlConnectionPanel';
import PostgreSqlConnectionPanel from './PostgreSqlConnectionPanel';
import OracleConnectionPanel from './OracleConnectionPanel';
import RedisConnectionPanel from './RedisConnectionPanel';
import SqliteConnectionPanel from './SqliteConnectionPanel';
import GaussDbConnectionPanel from './GaussDbConnectionPanel';

// 数据库连接面板组件映射
const connectionPanelComponents = {
  mysql: MySqlConnectionPanel,
  postgresql: PostgreSqlConnectionPanel,
  oracle: OracleConnectionPanel,
  redis: RedisConnectionPanel,
  sqlite: SqliteConnectionPanel,
  gaussdb: GaussDbConnectionPanel
};

// 默认连接面板组件（用于未知数据库类型）
const DefaultConnectionPanel: React.FC<ConnectionPanelFactoryProps> = ({ databaseType, darkMode }) => {
  return (
    <div style={{ 
      padding: '40px', 
      textAlign: 'center',
      color: darkMode ? '#ccc' : '#666'
    }}>
      <h3>不支持的数据库类型</h3>
      <p>当前选择的数据库类型: {databaseType}</p>
      <p>请选择支持的数据库类型进行连接</p>
    </div>
  );
};

const ConnectionPanelFactory: React.FC<ConnectionPanelFactoryProps> = ({
  form,
  databaseType,
  connection,
  darkMode,
  onUrlChange,
  initialValues
}) => {
  // 获取对应的连接面板组件
  const ConnectionPanelComponent = connectionPanelComponents[databaseType] || DefaultConnectionPanel;

  return (
    <ConnectionPanelComponent
      form={form}
      connection={connection}
      databaseType={databaseType}
      darkMode={darkMode}
      onUrlChange={onUrlChange}
      initialValues={initialValues}
    />
  );
};

export default ConnectionPanelFactory;

// 导出所有数据库类型的配置信息 - 按指定顺序返回
export const getAllDatabaseTypes = () => {
  // 定义需要的顺序：将Redis放在倒数第二，SQLite放在最后
  const orderedTypes = ['mysql', 'postgresql', 'oracle', 'gaussdb', 'redis', 'sqlite'];
  
  return orderedTypes.map(key => {
    const component = connectionPanelComponents[key as keyof typeof connectionPanelComponents];
    return {
      value: key as keyof typeof connectionPanelComponents,
      label: component.label,
      defaultPort: component.defaultPort
    };
  });
};

// 导出数据库类型图标映射接口
export interface DatabaseTypeIconMap {
  [key: string]: React.ReactNode;
}