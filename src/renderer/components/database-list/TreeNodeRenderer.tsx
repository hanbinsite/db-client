import React from 'react';
import { DatabaseType } from '../../types';
import MySqlTreeNodeRenderer from './MySqlTreeNodeRenderer';
import PostgreSqlTreeNodeRenderer from './PostgreSqlTreeNodeRenderer';
import { TreeNode } from './DatabaseTree';

export interface TreeNodeRendererProps {
  node: TreeNode;
  onMenuSelect?: (action: string, node: TreeNode) => void;
  databaseType: DatabaseType;
}

const TreeNodeRenderer: React.FC<TreeNodeRendererProps> = ({ node, onMenuSelect, databaseType }) => {
  console.log('TreeNodeRenderer - 渲染节点', { node, databaseType });
  
  // 根据数据库类型渲染相应的专用渲染器
  const renderDatabaseSpecificRenderer = () => {
    const commonProps = {
      node,
      onMenuSelect
    };

    switch (databaseType) {
      case DatabaseType.MySQL:
        console.log('TreeNodeRenderer - 渲染MySQL节点');
        return <MySqlTreeNodeRenderer {...commonProps} />;
      
      case DatabaseType.PostgreSQL:
        console.log('TreeNodeRenderer - 渲染PostgreSQL节点');
        return <PostgreSqlTreeNodeRenderer {...commonProps} />;
      
      default:
        console.log('TreeNodeRenderer - 渲染默认节点');
        // 默认渲染
        return (
          <span className="tree-node">
            <span className="tree-node-title">{node.title || 'Unknown'}</span>
          </span>
        );
    }
  };

  return renderDatabaseSpecificRenderer();
};

export default TreeNodeRenderer;