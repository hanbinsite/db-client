import React from 'react';
import { Typography } from 'antd';
import { TreeNode } from './DatabaseTree';

const { Text } = Typography;

interface RedisTreeNodeRendererProps {
  node: TreeNode;
  darkMode: boolean;
}

const RedisTreeNodeRenderer: React.FC<RedisTreeNodeRendererProps> = ({ node, darkMode }) => {
  // 为节点添加样式类名
  const getIconClassName = () => {
    const nodeType = node.type as string;
    if (nodeType === 'database') {
      // 提取数据库编号，用于添加特定样式
      const dbNumber = node.title.replace(/^db/, '');
      return `redis-db-icon db-${dbNumber}`;
    } else {
      return 'redis-key-icon';
    }
  };

  // 为Redis数据库节点添加特殊样式
  const getNodeStyle = () => {
    const nodeType = node.type as string;
    if (nodeType === 'database') {
      return {
        fontWeight: 'bold',
        color: darkMode ? '#e6e6e6' : '#333',
        padding: '2px 4px',
        borderRadius: '4px',
        backgroundColor: darkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
        display: 'inline-block'
      };
    }
    return {
      color: darkMode ? '#cccccc' : '#666666'
    };
  };

  // 生成节点显示的文本内容
  const getNodeText = () => {
    const nodeType = node.type as string;
    if (nodeType === 'database') {
      // 直接显示完整的数据库名称
      const keyCount = (node as any).keyCount || 0;
      // 将键数量显示在数据库名称的最右侧
      return `${node.title} (${keyCount})`;
    }
    return node.title;
  };

  // 生成节点的工具提示内容
  const getNodeTooltip = () => {
    if (node.type === 'database') {
      return `Redis数据库: ${node.title}`;
    }
    return undefined;
  };

  const tooltipContent = getNodeTooltip();
  return (
    <span className="tree-node-content-wrapper" style={getNodeStyle()}>
      {/* 简单的图标占位符 */}
      <span className={`${getIconClassName()} icon-placeholder`} style={{ marginRight: 4 }}>•</span>
      <Text>{getNodeText()}</Text>
    </span>
  );
};

export default RedisTreeNodeRenderer;