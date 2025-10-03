import React from 'react';
import { Tree, Spin } from 'antd';
import type { Key } from 'react';
import { DatabaseOutlined, TableOutlined, FolderOutlined, CodeOutlined, FunctionOutlined, IeOutlined } from '@ant-design/icons';
import { useTheme } from './ThemeContext';

const { DirectoryTree } = Tree;

export interface TreeNode {
  key: string;
  title: string;
  icon?: React.ReactNode;
  children?: TreeNode[];
  isLeaf?: boolean;
  type?: 'database' | 'table' | 'view' | 'procedure' | 'function' | 'query' | 'backup';
  disabled?: boolean;
}

export interface DatabaseTreeProps {
  treeData: TreeNode[];
  expandedKeys: Key[];
  selectedKeys: Key[];
  onNodeSelect: (node: TreeNode) => void;
  onMenuSelect: (action: string, node: TreeNode) => void;
  loading: boolean;
  darkMode: boolean;
}

const DatabaseTree: React.FC<DatabaseTreeProps> = ({
  treeData,
  expandedKeys,
  selectedKeys,
  onNodeSelect,
  onMenuSelect,
  loading,
  darkMode
}) => {
  // 数据库对象类型图标映射
  const objectTypeIcons: Record<string, React.ReactNode> = {
    database: <DatabaseOutlined />,
    table: <TableOutlined />,
    view: <IeOutlined />,
    procedure: <CodeOutlined />,
    function: <FunctionOutlined />
  };

  console.log('DATABASE TREE - 渲染数据库树组件', {
    treeDataLength: treeData.length,
    expandedKeysLength: expandedKeys.length,
    selectedKeysLength: selectedKeys.length,
    loading
  });

  // 处理节点选择
  const handleSelect = (selectedKeys: Key[], info: any) => {
    console.log('DATABASE TREE - 节点选择事件', { selectedKeys, info });
    
    // 健壮的节点信息获取逻辑
    try {
      // 确保info对象和node对象存在
      if (!info || !info.node) {
        console.warn('DATABASE TREE - 选择事件缺少必要信息', { selectedKeys, info });
        return;
      }
      
      // 安全地获取选中的节点数据
      const selectedNode = info.node.props?.dataRef || info.node;
      if (selectedNode && selectedNode.key && selectedNode.title) {
        console.log('DATABASE TREE - 选择节点:', selectedNode.key, selectedNode.title);
        onNodeSelect(selectedNode);
      } else {
        console.warn('DATABASE TREE - 选中的节点数据不完整', { selectedNode });
      }
    } catch (error) {
      console.error('DATABASE TREE - 处理节点选择时发生错误:', error);
      // 尝试从selectedKeys直接获取信息（作为最后的备用方案）
      if (selectedKeys && selectedKeys.length > 0) {
        console.log('DATABASE TREE - 尝试使用selectedKeys作为备用:', selectedKeys);
        // 至少触发一个基本的选择事件
        if (treeData && treeData.length > 0) {
          // 查找与selectedKeys匹配的节点
          const findNodeByKey = (nodes: TreeNode[], key: Key): TreeNode | undefined => {
            for (const node of nodes) {
              if (node.key === key) return node;
              if (node.children) {
                const found = findNodeByKey(node.children, key);
                if (found) return found;
              }
            }
            return undefined;
          };
          
          // 尝试找到匹配的节点
          for (const key of selectedKeys) {
            const matchedNode = findNodeByKey(treeData, key);
            if (matchedNode) {
              onNodeSelect(matchedNode);
              break;
            }
          }
        }
      }
    }
  };

  // 处理节点展开
  const handleExpand = (expandedKeys: Key[]) => {
    // 这里可以添加展开逻辑，但接口定义中没有onExpand属性
  };

  // 渲染树节点
  const renderTreeNode = (node: any) => {
    // 安全地获取节点数据
    const nodeData = node?.props?.dataRef || node;
    const { title, type, key } = nodeData;
    const icon = type ? objectTypeIcons[type] || <FolderOutlined /> : <FolderOutlined />;
    
    return (
      <span className={`tree-node ${darkMode ? 'dark-mode' : ''}`}>
        <span className="tree-node-icon">{icon}</span>
        <span className="tree-node-title">{title || 'Unknown'}</span>
      </span>
    );
  };

  if (loading) {
    return (
      <div className="loading-container">
        <Spin tip="加载中..." />
      </div>
    );
  }

  return (
    <DirectoryTree
      treeData={treeData}
      expandedKeys={expandedKeys}
      selectedKeys={selectedKeys}
      onSelect={handleSelect}
      onExpand={handleExpand}
      showIcon={false}
      defaultExpandAll={false}
      titleRender={renderTreeNode}
    />
  );
};

export default DatabaseTree;