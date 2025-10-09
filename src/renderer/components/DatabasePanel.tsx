import React, { useState, useRef, useEffect } from 'react';
import { DatabaseConnection } from '../types';
import type { Key } from 'react';
import { useTheme } from './ThemeContext';
import { DbType } from '../utils/database-utils';
import DatabaseTree from './DatabaseTree';
import DatabaseHeader from './DatabaseHeader';
import DatabaseDataLoader from './DatabaseDataLoader';
import DatabaseStatus from './DatabaseStatus';
import DatabaseContextMenu from './DatabaseContextMenu';
import TreeNodeRenderer from './TreeNodeRenderer';
import './DatabasePanel.css';

interface TreeNode {
  key: string;
  title: string;
  icon?: React.ReactNode;
  children?: TreeNode[];
  isLeaf?: boolean;
  type?: 'database' | 'table' | 'view' | 'procedure' | 'function' | 'query' | 'backup';
}

interface DatabasePanelProps {
  connection: DatabaseConnection | null;
  onDatabaseSelect: (database: string) => void;
  onTableSelect: (table: string) => void;
  activeDatabase: string;
  activeTable: string;
  darkMode: boolean;
  onDataLoaded?: () => void;
}

const DatabasePanel: React.FC<DatabasePanelProps> = ({
  connection,
  onDatabaseSelect,
  onTableSelect,
  activeDatabase,
  activeTable,
  onDataLoaded
}) => {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  // 添加一个新的状态来跟踪当前选中的非表对象
  const [activeOtherObject, setActiveOtherObject] = useState<string>('');
  const { darkMode } = useTheme();
  
  // 创建对DatabaseDataLoader组件的引用
  const dataLoaderRef = useRef<any>(null);

  // 检查是否在Electron渲染进程环境
  useEffect(() => {
    console.log('DATABASE PANEL - 检查渲染环境:', {
      isElectron: !!window.electronAPI,
      platform: window.navigator.platform,
      userAgent: window.navigator.userAgent
    });
    
    // 当darkMode变化时，在控制台显示日志
    console.log('DATABASE PANEL - 主题模式变化:', darkMode ? '暗色' : '亮色');
  }, [darkMode]);

  // 处理数据加载完成回调
  const handleDataLoaded = (data: TreeNode[], expanded: string[]) => {
    console.log('DATABASE PANEL - 数据加载完成，更新数据库列表:', data.length, '个数据库');
    // 简化树数据，只保留数据库节点，移除子节点
    const simplifiedData = data.map(dbNode => ({
      ...dbNode,
      children: [] // 清空子节点，只显示数据库列表
    }));
    setTreeData(simplifiedData);
    setExpandedKeys([]); // 不需要展开任何节点
    setLoading(false);
    
    // 注释掉自动选择第一个数据库的逻辑，避免自动打开数据浏览tab
    // if (data.length > 0 && onDatabaseSelect) {
    //   const firstDbName = typeof data[0].title === 'string' ? data[0].title : '';
    //   if (firstDbName) {
    //     onDatabaseSelect(firstDbName);
    //     console.log('DATABASE PANEL - 自动选择第一个数据库:', firstDbName);
    //   }
    // }
    
    // 通知父组件数据已加载完成
    if (onDataLoaded) {
      onDataLoaded();
    }
  };

  // 处理刷新操作
  const handleRefresh = () => {
    console.log('DATABASE PANEL - 手动触发刷新数据库结构');
    setLoading(true);
    
    // 清除缓存
    if (dataLoaderRef.current && dataLoaderRef.current.clearCache) {
      console.log('DATABASE PANEL - 清除数据库列表缓存');
      dataLoaderRef.current.clearCache();
    }
    
    // 更新刷新触发器，强制重新加载数据
    setRefreshTrigger(prev => prev + 1);
  };

  // 处理节点选择 - 简化版，只处理数据库选择
  const handleNodeSelect = (node: TreeNode) => {
    console.log('DATABASE PANEL - 数据库被选择:', node.key, node.title);
    
    if (node.type === 'database') {
      // 选择数据库
      const dbName = node.title as string;
      console.log('DATABASE PANEL - 选择数据库:', dbName);
      onDatabaseSelect(dbName);
      onTableSelect('');
      setActiveOtherObject('');
    }
  };

  // 辅助函数：查找具有特定前缀的父节点
  const findParentNodeWithPrefix = (nodes: TreeNode[], prefix: string, targetKey: string): TreeNode | null => {
    for (const node of nodes) {
      if (node.key.includes(targetKey)) {
        // 找到了包含目标key的节点，检查是否有符合前缀的父节点
        const parentNode = findNodeByPrefix(nodes, prefix);
        if (parentNode) return parentNode;
      }
      if (node.children && node.children.length > 0) {
        const result = findParentNodeWithPrefix(node.children, prefix, targetKey);
        if (result) return result;
      }
    }
    return null;
  };

  // 辅助函数：通过前缀查找节点
  const findNodeByPrefix = (nodes: TreeNode[], prefix: string): TreeNode | null => {
    for (const node of nodes) {
      if (node.key.startsWith(prefix)) {
        return node;
      }
      if (node.children && node.children.length > 0) {
        const result = findNodeByPrefix(node.children, prefix);
        if (result) return result;
      }
    }
    return null;
  };

  // 辅助函数：从节点提取数据库名称
  const extractDatabaseNameFromNode = (node: TreeNode, allNodes: TreeNode[]): string => {
    // 尝试从节点key中提取
    const dbMatch = node.key.match(/db-([^-]+)/);
    if (dbMatch && dbMatch[1]) {
      return dbMatch[1];
    }
    
    // 尝试查找包含该节点的数据库节点
    const dbNode = findParentNodeWithPrefix(allNodes, 'db-', node.key);
    if (dbNode) {
      return dbNode.title as string;
    }
    
    return activeDatabase || '';
  };

  // 处理菜单操作
  const handleMenuSelect = (action: string, node: TreeNode) => {
    console.log('DATABASE PANEL - 菜单操作:', action, '节点:', node);
    
    // 根据不同的操作和节点类型执行相应的逻辑
    switch (action) {
      case 'refresh':
        handleRefresh();
        break;
      case 'view-data':
        if (node.type === 'table' || node.type === 'view') {
          handleNodeSelect(node);
        }
        break;
      case 'new-query':
        console.log('DATABASE PANEL - 创建新查询');
        break;
      case 'export':
        console.log('DATABASE PANEL - 导出数据库:', node.title);
        break;
      case 'backup':
        console.log('DATABASE PANEL - 备份数据库:', node.title);
        break;
      case 'edit':
        console.log('DATABASE PANEL - 编辑对象:', node.title);
        break;
      case 'execute':
        console.log('DATABASE PANEL - 执行对象:', node.title);
        break;
      default:
        console.log('DATABASE PANEL - 执行未知操作:', action);
    }
  };

  // 不再需要展开/折叠功能，因为我们只显示数据库列表

  return (
    <div className={`database-panel ${darkMode ? 'dark' : ''}`}>
      {/* 数据库面板头部 */}
      <DatabaseHeader 
        loading={loading}
        onRefresh={handleRefresh}
      />

      {/* 数据库状态显示已移除 */}

      {/* 数据库数据加载器 - 不渲染UI，只处理数据加载逻辑 */}
      <DatabaseDataLoader 
        ref={dataLoaderRef}
        connection={connection}
        refreshTrigger={refreshTrigger}
        onDataLoaded={handleDataLoaded}
      />

      {/* 数据库树 */}
      <div className="database-tree-container">
        {!connection ? (
          <div className="empty-state">
            <p>请先连接数据库</p>
          </div>
        ) : (
          <DatabaseTree
            treeData={treeData}
            expandedKeys={[]} // 固定为空，不展开任何节点
            selectedKeys={activeDatabase ? [`db-${activeDatabase}`] : []}
            onNodeSelect={handleNodeSelect}
            onMenuSelect={handleMenuSelect}
            loading={loading}
            darkMode={darkMode}
          />
        )}
      </div>

      {/* 活动对象信息显示已移除 */}
    </div>
  );
};

export default DatabasePanel;