import React, { useState } from 'react';
import { Button, Space } from 'antd';
import RedisAddKeyModal from './RedisAddKeyModal';
import { DatabaseConnection } from '../../types';

interface RedisActionsProps {
  connection?: DatabaseConnection;
  activeDatabase?: string;
  darkMode?: boolean;
  onOpenServiceInfo?: () => void;
}

const RedisActions: React.FC<RedisActionsProps> = ({ connection, activeDatabase, darkMode, onOpenServiceInfo }) => {
  const [visible, setVisible] = useState(false);

  if (!connection) return null;

  return (
    <div className="toolbar-section">
      <Space>
        <Button onClick={onOpenServiceInfo}>服务信息</Button>
        <Button type="primary" onClick={() => setVisible(true)}>
          新增键
        </Button>
      </Space>
      <RedisAddKeyModal 
        visible={visible}
        onClose={() => setVisible(false)}
        connection={connection}
        activeDatabase={activeDatabase}
        darkMode={darkMode}
        onCreated={() => setVisible(false)}
      />
    </div>
  );
};

export default RedisActions;