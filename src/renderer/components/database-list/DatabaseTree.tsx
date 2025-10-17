import React from 'react';
import { DatabaseType } from '../../types';
import MySqlDatabaseTree from './MySqlDatabaseTree';
import PostgreSqlDatabaseTree from './PostgreSqlDatabaseTree';
import RedisDatabaseTree from './RedisDatabaseTree';

export interface TreeNode {
  key: string;
  title: string;
  icon?: React.ReactNode;
  children?: TreeNode[];
  isLeaf?: boolean;
  type?: 'database' | 'table' | 'view' | 'materialized-view' | 'procedure' | 'function' | 'query' | 'backup' | 'schema';
  disabled?: boolean;
}

export interface DatabaseTreeProps {
  treeData: TreeNode[];
  expandedKeys: React.Key[];
  selectedKeys: React.Key[];
  onNodeSelect: (node: TreeNode) => void;
  onNodeDoubleClick?: (node: TreeNode) => void;
  onMenuSelect?: (action: string, node: TreeNode) => void;
  onExpand?: (expandedKeys: React.Key[]) => void;
  loading: boolean;
  darkMode: boolean;
  databaseType: DatabaseType;
}

const DatabaseTree: React.FC<DatabaseTreeProps> = ({
  treeData,
  expandedKeys,
  selectedKeys,
  onNodeSelect,
  onNodeDoubleClick,
  onMenuSelect,
  onExpand,
  loading,
  darkMode,
  databaseType
}) => {
  console.log('DATABASE TREE - 渲染数据库树组件', {
    treeDataLength: treeData.length,
    expandedKeysLength: expandedKeys.length,
    selectedKeysLength: selectedKeys.length,
    loading,
    databaseType
  });

  // 根据数据库类型渲染相应的专用组件
  const renderDatabaseSpecificTree = () => {
    const commonProps = {
      treeData,
      expandedKeys,
      selectedKeys,
      onNodeSelect,
      onNodeDoubleClick,
      onMenuSelect,
      onExpand,
      loading
    };

    // 直接比较字符串值，使用小写形式匹配types.ts中的定义
    if (databaseType === 'mysql') {
      console.log('DATABASE TREE - 渲染MySQL数据库树');
      return <MySqlDatabaseTree {...commonProps} />;
    } else if (databaseType === 'postgresql') {
      console.log('DATABASE TREE - 渲染PostgreSQL数据库树');
      return <PostgreSqlDatabaseTree {...commonProps} />;
    } else if (databaseType === 'redis') {
      console.log('DATABASE TREE - 渲染Redis数据库树');
      return <RedisDatabaseTree {...commonProps} darkMode={darkMode} />;
    } else {
      console.log('DATABASE TREE - 渲染默认数据库树');
      // 默认情况下显示加载状态
      return (
        <div className="loading-container">
          <div style={{ textAlign: 'center', padding: '20px', color: darkMode ? '#fff' : '#333' }}>
            不支持的数据库类型: {databaseType}
          </div>
        </div>
      );
    }
  };

  return renderDatabaseSpecificTree();
};

export default DatabaseTree;