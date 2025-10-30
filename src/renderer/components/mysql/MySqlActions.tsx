import React from 'react';
import { Button, Space } from 'antd';
import type { DatabaseConnection } from '../../types';

interface MySqlActionsProps {
  connection?: DatabaseConnection;
  activeDatabase?: string;
  darkMode?: boolean;
  onOpenServiceInfo?: () => void;
  onOpenUsers?: () => void;
  onOpenCli?: () => void;
  onOpenSlowlog?: () => void;
}

const MySqlActions: React.FC<MySqlActionsProps> = ({ connection, activeDatabase, darkMode, onOpenServiceInfo, onOpenUsers, onOpenCli, onOpenSlowlog }) => {
  if (!connection) return null;
  return (
    <div className="toolbar-section">
      <Space>
        <Button onClick={onOpenServiceInfo}>服务信息</Button>
        <Button onClick={onOpenUsers}>用户信息</Button>
        <Button onClick={onOpenCli}>命令行</Button>
        <Button onClick={onOpenSlowlog}>慢日志</Button>
      </Space>
    </div>
  );
};

export default MySqlActions;