import React, { useState, useEffect } from 'react';
import { DatabaseConnection } from '../../types';
import QueryPanelFactory from './QueryPanelFactory';
import './QueryPanel.css';

interface QueryPanelProps {
  connection: DatabaseConnection | null;
  database: string;
  tabKey?: string;
  onTabClose?: (key: string) => void;
  darkMode: boolean;
}

/**
 * SQL查询面板包装组件
 * 根据数据库类型动态选择对应的查询面板实现
 * 解决了查询页面一直处于loading状态的问题
 * 支持多条SQL执行（按;分割）
 */
const QueryPanel: React.FC<QueryPanelProps> = ({ connection, database, tabKey, onTabClose, darkMode }) => {
  // 修复loading状态问题：确保组件正确渲染
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // 组件初始化完成
    setIsInitialized(true);
  }, []);

  // 只有当初始化完成后才渲染查询面板
  if (!isInitialized) {
    return null;
  }

  // 使用工厂组件根据数据库类型渲染对应的查询面板
  return (
    <QueryPanelFactory
      connection={connection}
      database={database}
      tabKey={tabKey}
      onTabClose={onTabClose}
      darkMode={darkMode}
    />
  );
};

export default QueryPanel;