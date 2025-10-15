import React from 'react';
import { Tree, Spin, Dropdown, Menu } from 'antd';
import { DatabaseOutlined, TableOutlined, FolderOutlined, CodeOutlined, FunctionOutlined, IeOutlined, ThunderboltOutlined, CalendarOutlined, EditOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, MoreOutlined, EyeOutlined, CopyOutlined } from '@ant-design/icons';
import { TreeNode } from './DatabaseTree';
import DatabaseContextMenu from './DatabaseContextMenu';
import { useTheme } from '../common/ThemeContext';
import { DatabaseType } from '../../types';

const { DirectoryTree } = Tree;



export interface MySqlDatabaseTreeProps {
  treeData: TreeNode[];
  expandedKeys: React.Key[];
  selectedKeys: React.Key[];
  onNodeSelect: (node: TreeNode) => void;
  onNodeDoubleClick?: (node: TreeNode) => void;
  onMenuSelect?: (action: string, node: TreeNode) => void;
  onExpand?: (expandedKeys: React.Key[]) => void;
  loading: boolean;
}

const MySqlDatabaseTree: React.FC<MySqlDatabaseTreeProps> = ({
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
  
  // MySQL数据库对象类型图标映射
  const objectTypeIcons: Record<string, React.ReactNode> = {
    database: <DatabaseOutlined />,
    table: <TableOutlined />,
    view: <IeOutlined />,
    procedure: <CodeOutlined />,
    function: <FunctionOutlined />,
    // MySQL特有对象
    trigger: <CodeOutlined />,
    event: <CodeOutlined />
  };

  console.log('MYSQL DATABASE TREE - 渲染MySQL数据库树组件', {
    treeDataLength: treeData.length,
    expandedKeysLength: expandedKeys.length,
    selectedKeysLength: selectedKeys.length,
    loading
  });

  // 处理节点选择
  const handleSelect = (selectedKeys: React.Key[], info: any) => {
    console.log('MYSQL DATABASE TREE - 节点选择事件', { selectedKeys, info });
    
    // 改进的节点信息获取逻辑，确保能够更可靠地获取节点数据
    try {
      // 直接从info中获取节点数据
      if (info && info.node && info.node.props && info.node.props.dataRef) {
        const selectedNode = info.node.props.dataRef;
        console.log('MYSQL DATABASE TREE - 选择节点:', selectedNode.key, selectedNode.title);
        onNodeSelect(selectedNode);
      } else {
        console.log('MYSQL DATABASE TREE - 尝试从selectedKeys和treeData获取节点数据');
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
              console.log('MYSQL DATABASE TREE - 从treeData中查找到匹配节点:', key);
              onNodeSelect(matchedNode);
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error('MYSQL DATABASE TREE - 处理节点选择时发生错误:', error);
    }
  };

  // 处理节点展开/折叠
  const handleExpand = (expandedKeys: React.Key[], info: any) => {
    console.log('MYSQL DATABASE TREE - 处理节点展开/折叠:', expandedKeys, info);
    try {
      // 调用父组件传入的onExpand回调函数
      if (onExpand) {
        onExpand(expandedKeys);
        console.log('MYSQL DATABASE TREE - 节点展开/折叠事件已传递给父组件');
      }
    } catch (error) {
      console.error('MYSQL DATABASE TREE - 处理节点展开/折叠时发生错误:', error);
    }
  };

  // 处理节点双击事件
  const handleDoubleClick = (info: any) => {
    console.log('MYSQL DATABASE TREE - 节点双击事件:', info);
    try {
      // 从info中获取节点数据
      if (info && info.node && info.node.props && info.node.props.dataRef) {
        const clickedNode = info.node.props.dataRef;
        console.log('MYSQL DATABASE TREE - 双击节点:', clickedNode.key, clickedNode.title);
        // 调用父组件传入的onNodeDoubleClick回调函数
        if (onNodeDoubleClick) {
          onNodeDoubleClick(clickedNode);
          console.log('MYSQL DATABASE TREE - 节点双击事件已传递给父组件');
        }
      }
    } catch (error) {
      console.error('MYSQL DATABASE TREE - 处理节点双击时发生错误:', error);
    }
  };

  // 渲染树节点
  const renderTreeNode = (node: any) => {
    // 安全地获取节点数据
    const nodeData = node?.props?.dataRef || node;
    const { title, type, key } = nodeData;
    const icon = type ? objectTypeIcons[type] || <FolderOutlined /> : <FolderOutlined />;
    
    console.log('MYSQL DATABASE TREE - 渲染节点:', { title, type, key });
    
    // 创建包含图标和标题的自定义内容
    const nodeContent = (
      <span className="mysql-tree-node">
        <span className="mysql-tree-node-icon">{icon}</span>
        <span className="mysql-tree-node-title">{title || 'Unknown'}</span>
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
                { key: 'properties', label: '属性', icon: <MoreOutlined /> }
              ] : []),
              // 表节点菜单
              ...(nodeData.type === 'table' ? [
                { key: 'select', label: '查询数据', icon: <EyeOutlined /> },
                { key: 'insert', label: '插入数据', icon: <PlusOutlined /> },
                { key: 'edit', label: '编辑表', icon: <EditOutlined /> },
                { key: 'copy', label: '复制表', icon: <CopyOutlined /> },
                { key: 'delete', label: '删除表', icon: <DeleteOutlined /> },
                // MySQL特有菜单项
                { key: 'manage-triggers', label: '管理触发器', icon: <CodeOutlined /> }
              ] : []),
              // 其他节点类型的通用菜单
              ...(nodeData.type === 'view' || nodeData.type === 'procedure' || nodeData.type === 'function' ? [
                { key: 'select', label: '查看数据', icon: <EyeOutlined /> },
                { key: 'edit', label: '编辑', icon: <EditOutlined /> },
                { key: 'delete', label: '删除', icon: <DeleteOutlined /> }
              ] : [])
            ]}
            onClick={({ key }: { key: string }) => {
              if (onMenuSelect) {
                console.log('MySQL右键菜单选择:', key, nodeData);
                // 对于新建查询操作，确保传递数据库名称
                if (key === 'new-query' && nodeData.type === 'database') {
                  onMenuSelect(key, nodeData);
                } else {
                  onMenuSelect(key, nodeData);
                }
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
        <Spin tip="加载MySQL数据中..." />
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

export default MySqlDatabaseTree;