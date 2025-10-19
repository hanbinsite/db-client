import React, { useState } from 'react';
import { Button } from 'antd';
import RedisAddKeyModal from './RedisAddKeyModal';
import { DatabaseConnection } from '../../types';

interface RedisActionsProps {
  connection?: DatabaseConnection;
  activeDatabase?: string;
  darkMode?: boolean;
}

const RedisActions: React.FC<RedisActionsProps> = ({ connection, activeDatabase, darkMode }) => {
  const [visible, setVisible] = useState(false);

  if (!connection) return null;

  return (
    <div className="toolbar-section">
      <Button type="primary" onClick={() => setVisible(true)}>
        新增键
      </Button>
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