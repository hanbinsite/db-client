import React from 'react';
import { Button, Tooltip } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useTheme } from './ThemeContext';

interface DatabaseHeaderProps {
  loading: boolean;
  onRefresh: () => void;
}

const DatabaseHeader: React.FC<DatabaseHeaderProps> = ({
  loading,
  onRefresh
}) => {
  const { darkMode } = useTheme();

  console.log('DATABASE HEADER - 渲染数据库面板头部');

  return (
    <div className={`database-header ${darkMode ? 'dark' : ''}`}>
      <div className="header-content">
        <span className="header-title">数据库</span>
        <div className="header-actions">
          <Tooltip title="刷新">
            <Button 
              type="text"
              icon={<ReloadOutlined />}
              onClick={onRefresh}
              size="small"
              className="refresh-btn"
              shape="circle"
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
};

export default DatabaseHeader;