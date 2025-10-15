import React from 'react';
import { TreeNode } from './DatabaseTree';

export interface TreeNodeRendererProps {
  node: TreeNode;
  onMenuSelect?: (action: string, node: TreeNode) => void;
  className?: string;
  style?: React.CSSProperties;
}

const TreeNodeRenderer: React.FC<TreeNodeRendererProps> = ({ node, onMenuSelect, className, style }) => {
  // 简化的节点渲染
  return (
    <span className={`tree-node ${className || ''}`} style={style}>
      <span className="tree-node-title">{node.title || 'Unknown'}</span>
    </span>
  );
};

export default TreeNodeRenderer;