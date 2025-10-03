import React from 'react';
import { Button, Tooltip, Dropdown } from 'antd';
import { RestOutlined, MoreOutlined } from '@ant-design/icons';
import { useTheme } from './ThemeContext';

interface DatabaseHeaderProps {
  loading: boolean;
  onRefresh: () => void;
  onExpandCollapse: (type: 'expand' | 'collapse' | 'expandAll' | 'collapseAll') => void;
  expandAll: () => void;
  collapseAll: () => void;
}

const DatabaseHeader: React.FC<DatabaseHeaderProps> = ({
  loading,
  onRefresh,
  onExpandCollapse,
  expandAll,
  collapseAll
}) => {
  const { darkMode } = useTheme();

  console.log('DATABASE HEADER - 渲染数据库面板头部');

  return (
    <div className="database-header">
      <div className="header-content">
        <span className="header-title">数据库</span>
        <div className="header-actions">
          <Tooltip title="刷新">
            <Button 
              type="text" 
              icon={<RestOutlined />} 
              onClick={onRefresh}
              size="small"
              className="refresh-btn"
            />
          </Tooltip>
          <Dropdown 
            menu={{
                items: [
                  {
                    key: 'expand-all',
                    label: '全部展开',
                    onClick: expandAll
                  },
                  {
                    key: 'collapse-all',
                    label: '全部折叠',
                    onClick: collapseAll
                  }
                ]
              }}
          >
            <Button 
              type="text" 
              icon={<MoreOutlined />}
              size="small"
              className="more-btn"
            />
          </Dropdown>
        </div>
      </div>
    </div>
  );
};

export default DatabaseHeader;