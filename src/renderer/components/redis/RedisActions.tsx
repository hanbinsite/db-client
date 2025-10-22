import React, { useState } from 'react';
import { Button, Space } from 'antd';
import { DatabaseConnection } from '../../types';
interface RedisActionsProps {
  connection?: DatabaseConnection;
  activeDatabase?: string;
  darkMode?: boolean;
  onOpenServiceInfo?: () => void;
  onOpenSlowlog?: () => void;
  onOpenCli?: () => void;
  onOpenPubSub?: () => void;
}

const RedisActions: React.FC<RedisActionsProps> = ({ connection, activeDatabase, darkMode, onOpenServiceInfo, onOpenSlowlog, onOpenCli, onOpenPubSub }) => {
  if (!connection) return null;

  return (
    <div className="toolbar-section">
      <Space>
        <Button onClick={onOpenServiceInfo}>服务信息</Button>
        <Button onClick={onOpenCli}>命令行</Button>
        <Button onClick={onOpenSlowlog}>慢日志</Button>
        <Button onClick={onOpenPubSub}>发布/订阅</Button>
      </Space>
    </div>
  );
};

export default RedisActions;