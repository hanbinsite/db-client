import React from 'react';
import { DatabaseConnection } from '../../types';
import './DatabasePanel.css';

interface DatabaseStatusProps {
  connection: DatabaseConnection | null;
  loading: boolean;
}

const DatabaseStatus: React.FC<DatabaseStatusProps> = ({
  connection,
  loading
}) => {
  // 根据连接状态获取对应的状态文本和CSS类
  const getConnectionStatus = () => {
    if (loading) {
      return {
        text: '加载中...',
        className: 'database-status-loading'
      };
    }

    if (!connection) {
      return {
        text: '未连接',
        className: 'database-status-disconnected'
      };
    }

    if (connection.isConnected) {
      return {
        text: '已连接',
        className: 'database-status-connected'
      };
    }

    return {
      text: '连接失败',
      className: 'database-status-error'
    };
  };

  const status = getConnectionStatus();

  return (
    <div className="database-status">
      <span className={`status-indicator ${status.className}`}></span>
      <span className="status-text">{status.text}</span>
    </div>
  );
};

export default DatabaseStatus;