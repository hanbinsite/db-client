import React from 'react';
import { Tree, Spin, Dropdown, Menu } from 'antd';
import { DatabaseOutlined, TableOutlined, FolderOutlined, CodeOutlined, FunctionOutlined, IeOutlined, EditOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, MoreOutlined, EyeOutlined, CopyOutlined } from '@ant-design/icons';
import { TreeNode } from './DatabaseTree';
import DatabaseContextMenu from './DatabaseContextMenu';
import { useTheme } from '../common/ThemeContext';
import { DatabaseType } from '../../types';

const { DirectoryTree } = Tree;



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
    
    // 创建包含图标和标题的自定义内容
    const nodeContent = (
      <span className={`tree-node ${darkMode ? 'dark-mode' : ''}`}>
        <span className="tree-node-icon">{icon}</span>
        <span className="tree-node-title">{title || 'Unknown'}</span>
      </span>
    );
    
    // 使用Dropdown组件直接实现右键菜单功能
    return (
      <Dropdown
        overlay={
          <Menu
            items={[
              // 数据库节点菜单
              ...(nodeData.type === 'database' ? [
                { key: 'new-query', label: '新建查询', icon: <CodeOutlined /> },
                { key: 'new-table', label: '新建表', icon: <PlusOutlined /> },
                { key: 'refresh', label: '刷新', icon: <ReloadOutlined /> },
                { key: 'properties', label: '属性', icon: <MoreOutlined /> },
                // PostgreSQL特有菜单项
                { key: 'new-schema', label: '新建架构', icon: <PlusOutlined /> }
              ] : []),
              // 架构节点菜单
              ...(nodeData.type === 'schema' ? [
                { key: 'refresh', label: '刷新', icon: <ReloadOutlined /> },
                { key: 'create-table', label: '创建表', icon: <PlusOutlined /> },
                { key: 'create-view', label: '创建视图', icon: <IeOutlined /> }
              ] : []),
              // 表节点菜单
              ...(nodeData.type === 'table' ? [
                { key: 'select', label: '查询数据', icon: <EyeOutlined /> },
                { key: 'insert', label: '插入数据', icon: <PlusOutlined /> },
                { key: 'edit', label: '编辑表', icon: <EditOutlined /> },
                { key: 'copy', label: '复制表', icon: <CopyOutlined /> },
                { key: 'delete', label: '删除表', icon: <DeleteOutlined /> },
                // PostgreSQL特有菜单项
                { key: 'manage-indexes', label: '管理索引', icon: <CodeOutlined /> },
                { key: 'manage-constraints', label: '管理约束', icon: <CodeOutlined /> }
              ] : []),
              // 视图节点菜单
              ...(nodeData.type === 'view' || nodeData.type === 'materialized-view' ? [
                { key: 'select', label: '查询数据', icon: <EyeOutlined /> },
                { key: 'edit', label: '编辑视图', icon: <EditOutlined /> },
                { key: 'refresh', label: '刷新视图', icon: <ReloadOutlined /> },
                { key: 'delete', label: '删除视图', icon: <DeleteOutlined /> }
              ] : []),
              // 存储过程和函数菜单
              ...(nodeData.type === 'procedure' || nodeData.type === 'function' ? [
                { key: 'execute', label: '执行', icon: <CodeOutlined /> },
                { key: 'edit', label: '编辑', icon: <EditOutlined /> },
                { key: 'delete', label: '删除', icon: <DeleteOutlined /> }
              ] : []),
              // PostgreSQL特有对象菜单
              ...(['sequence'].includes(nodeData.type as string) ? [
                { key: 'view', label: '查看序列', icon: <EyeOutlined /> },
                { key: 'edit', label: '编辑序列', icon: <EditOutlined /> },
                { key: 'delete', label: '删除序列', icon: <DeleteOutlined /> }
              ] : []),
              ...(['type', 'domain'].includes(nodeData.type as string) ? [
                { key: 'edit', label: '编辑类型', icon: <EditOutlined /> },
                { key: 'delete', label: '删除类型', icon: <DeleteOutlined /> }
              ] : [])
            ]}
            onClick={({ key }: { key: string }) => {
              if (onMenuSelect) {
                console.log('PostgreSQL右键菜单选择:', key, nodeData);
                onMenuSelect(key, nodeData);
              }
            }}
          />
        }
        trigger={['contextMenu']}
      >
        <div style={{ userSelect: 'none', display: 'inline-block' }}>
          {nodeContent}
        </div>
      </Dropdown>
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