import React from 'react';
import { Tree, Spin } from 'antd';
import { DatabaseOutlined, TableOutlined, FolderOutlined, CodeOutlined, FunctionOutlined, IeOutlined } from '@ant-design/icons';
import DatabaseContextMenu from './DatabaseContextMenu';
import { useTheme } from '../common/ThemeContext';
import { DatabaseType } from '../../types';

const { DirectoryTree } = Tree;

export interface TreeNode {
  key: string;
  title: string;
  icon?: React.ReactNode;
  children?: TreeNode[];
  isLeaf?: boolean;
  type?: 'database' | 'table' | 'view' | 'materialized-view' | 'procedure' | 'function' | 'query' | 'backup' | 'schema';
  disabled?: boolean;
}

export interface PostgreSqlDatabaseTreeProps {
  treeData: TreeNode[];
  expandedKeys: React.Key[];
  selectedKeys: React.Key[];
  onNodeSelect: (node: TreeNode) => void;
  onNodeDoubleClick?: (node: TreeNode) => void;
  onMenuSelect?: (action: string, node: TreeNode) => void;
  onExpand?: (expandedKeys: React.Key[]) => void;
  loading: boolean;
}

const PostgreSqlDatabaseTree: React.FC<PostgreSqlDatabaseTreeProps> = ({
  treeData,
  expandedKeys,
  selectedKeys,
  onNodeSelect,
  onNodeDoubleClick,
  onMenuSelect,
  onExpand,
  loading
}) => {
  const { darkMode } = useTheme();
  
  // PostgreSQL数据库对象类型图标映射
  const objectTypeIcons: Record<string, React.ReactNode> = {
    database: <DatabaseOutlined />,
    schema: <FolderOutlined />,
    table: <TableOutlined />,
    view: <IeOutlined />,
    'materialized-view': <IeOutlined />,
    procedure: <CodeOutlined />,
    function: <FunctionOutlined />,
    // PostgreSQL特有对象
    sequence: <CodeOutlined />,
    index: <FolderOutlined />,
    trigger: <CodeOutlined />,
    type: <IeOutlined />,
    domain: <IeOutlined />
  };

  console.log('POSTGRESQL DATABASE TREE - 渲染PostgreSQL数据库树组件', {
    treeDataLength: treeData.length,
    expandedKeysLength: expandedKeys.length,
    selectedKeysLength: selectedKeys.length,
    loading
  });

  // 处理节点选择
  const handleSelect = (selectedKeys: React.Key[], info: any) => {
    console.log('POSTGRESQL DATABASE TREE - 节点选择事件', { selectedKeys, info });
    
    // 改进的节点信息获取逻辑，确保能够更可靠地获取节点数据
    try {
      // 直接从info中获取节点数据
      if (info && info.node && info.node.props && info.node.props.dataRef) {
        const selectedNode = info.node.props.dataRef;
        console.log('POSTGRESQL DATABASE TREE - 选择节点:', selectedNode.key, selectedNode.title);
        onNodeSelect(selectedNode);
      } else {
        console.log('POSTGRESQL DATABASE TREE - 尝试从selectedKeys和treeData获取节点数据');
        // 当info对象不完整时，尝试直接从treeData中查找节点
        if (selectedKeys && selectedKeys.length > 0) {
          const findNodeByKey = (nodes: TreeNode[], key: React.Key): TreeNode | undefined => {
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
              console.log('POSTGRESQL DATABASE TREE - 从treeData中查找到匹配节点:', key);
              onNodeSelect(matchedNode);
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error('POSTGRESQL DATABASE TREE - 处理节点选择时发生错误:', error);
    }
  };

  // 处理节点展开/折叠
  const handleExpand = (expandedKeys: React.Key[], info: any) => {
    console.log('POSTGRESQL DATABASE TREE - 处理节点展开/折叠:', expandedKeys, info);
    try {
      // 调用父组件传入的onExpand回调函数
      if (onExpand) {
        onExpand(expandedKeys);
        console.log('POSTGRESQL DATABASE TREE - 节点展开/折叠事件已传递给父组件');
      }
    } catch (error) {
      console.error('POSTGRESQL DATABASE TREE - 处理节点展开/折叠时发生错误:', error);
    }
  };

  // 处理节点双击事件
  const handleDoubleClick = (info: any) => {
    console.log('POSTGRESQL DATABASE TREE - 节点双击事件:', info);
    try {
      // 从info中获取节点数据
      if (info && info.node && info.node.props && info.node.props.dataRef) {
        const clickedNode = info.node.props.dataRef;
        console.log('POSTGRESQL DATABASE TREE - 双击节点:', clickedNode.key, clickedNode.title);
        // 调用父组件传入的onNodeDoubleClick回调函数
        if (onNodeDoubleClick) {
          onNodeDoubleClick(clickedNode);
          console.log('POSTGRESQL DATABASE TREE - 节点双击事件已传递给父组件');
        }
      }
    } catch (error) {
      console.error('POSTGRESQL DATABASE TREE - 处理节点双击时发生错误:', error);
    }
  };

  // 渲染树节点
  const renderTreeNode = (node: any) => {
    // 安全地获取节点数据
    const nodeData = node?.props?.dataRef || node;
    const { title, type, key } = nodeData;
    const icon = type ? objectTypeIcons[type] || <FolderOutlined /> : <FolderOutlined />;
    
    // 包装节点以提供右键菜单，传递PostgreSQL数据库类型
    return (
      <DatabaseContextMenu 
        node={nodeData} 
        onMenuSelect={onMenuSelect || (() => {})}
        databaseType={DatabaseType.PostgreSQL}
      >
        <span className={`tree-node ${darkMode ? 'dark-mode' : ''}`}>
          <span className="tree-node-icon">{icon}</span>
          <span className="tree-node-title">{title || 'Unknown'}</span>
        </span>
      </DatabaseContextMenu>
    );
  };

  if (loading) {
    return (
      <div className="loading-container">
        <Spin tip="加载PostgreSQL数据中..." />
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
      onDoubleClick={handleDoubleClick}
      showIcon={false}
      defaultExpandAll={false}
      titleRender={renderTreeNode}
    />
  );
};

export default PostgreSqlDatabaseTree;