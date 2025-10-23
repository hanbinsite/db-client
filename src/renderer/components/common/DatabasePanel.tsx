import React, { useState, useRef, useEffect } from 'react';
import { DatabaseConnection } from '../../types';
import type { Key } from 'react';
import { useTheme } from './ThemeContext';
// import { DbType } from '../utils/database-utils';
import DatabaseTree from '../database-list/DatabaseTree';
import DatabaseHeader from './DatabaseHeader';
import DatabaseDataLoader from './DatabaseDataLoader';
import DatabaseStatus from './DatabaseStatus';
// import DatabaseContextMenu from './DatabaseContextMenu';
import TreeNodeRenderer from '../database-list/TreeNodeRenderer';
import AddDatabaseModal from './AddDatabaseModal';
import AddSchemaModal from './AddSchemaModal';
import './DatabasePanel.css';

interface TreeNode {
  key: string;
  title: string;
  icon?: React.ReactNode;
  children?: TreeNode[];
  isLeaf?: boolean;
  type?: 'database' | 'table' | 'view' | 'materialized-view' | 'procedure' | 'function' | 'query' | 'backup' | 'schema';
}

interface DatabasePanelProps {
  connection: DatabaseConnection | null;
  onDatabaseSelect: (database: string) => void;
  onTableSelect: (table: string) => void;
  activeDatabase: string;
  activeTable: string;
  darkMode: boolean;
  onDataLoaded?: () => void;
  onNewQuery?: (database?: string) => void;
}

const DatabasePanel: React.FC<DatabasePanelProps> = ({
  connection,
  onDatabaseSelect,
  onTableSelect,
  activeDatabase,
  activeTable,
  onDataLoaded,
  onNewQuery
}) => {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  // 添加一个新的状态来跟踪当前选中的非表对象
  const [activeOtherObject, setActiveOtherObject] = useState<string>('');
  const { darkMode } = useTheme();
  // 控制新增数据库弹窗的显示
  const [isAddDatabaseModalVisible, setIsAddDatabaseModalVisible] = useState(false);
  // 控制新增模式弹窗的显示
  const [isAddSchemaModalVisible, setIsAddSchemaModalVisible] = useState(false);
  // 当前选中的数据库名称，用于新增模式
  const [selectedDatabaseName, setSelectedDatabaseName] = useState<string>('');
  
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

  // 新增：监听 Redis 键数量更新事件，主动同步树中对应数据库节点的 keyCount
  useEffect(() => {
    const onKeyCountUpdate = (ev: any) => {
      try {
        const detail = ev?.detail || {};
        const { connectionId, keyCount } = detail;
        // 兼容两种字段名：dbName 或 database
        const dbName: string = detail.dbName || detail.database || '';
        if (!connection || connection.connectionId !== connectionId || !dbName) return;
        setTreeData(prev => prev.map((node: any) => {
          const title = typeof node?.title === 'string' ? node.title : '';
          if (title === dbName) {
            const next = { ...node } as any;
            next.keyCount = Number(keyCount) || 0;
            return next;
          }
          return node;
        }));
      } catch (e) {
        console.warn('DATABASE PANEL - 处理 redis-keycount-update 事件失败:', e);
      }
    };
    window.addEventListener('redis-keycount-update', onKeyCountUpdate as any);
    return () => {
      window.removeEventListener('redis-keycount-update', onKeyCountUpdate as any);
    };
  }, [connection]);

  // 处理数据加载完成回调
    const handleDataLoaded = (data: TreeNode[], expanded: string[]) => {
      console.log('================================================================================');
      console.log('====================== DATABASE PANEL UPDATE START =============================');
      console.log('================================================================================');
      console.log('DATABASE PANEL - 数据加载完成，更新数据库列表:', { dataLength: data.length, connectionId: connection?.connectionId, databaseType: connection?.type });
      
      // 特别记录Redis数据库的keyCount信息
      if (connection?.type === 'redis') {
        const redisStats = data.map(db => ({
          name: db.title,
          keyCount: (db as any).keyCount || 0,
          key: db.key
        }));
        console.log('Redis数据库键数量统计:', redisStats);
      }
      
      // 检查数据库类型，如果是PostgreSQL则保留完整的树状结构
      let treeDataToSet = data;
      if (connection?.type !== 'postgresql' && connection?.type !== 'gaussdb') {
        // 对于非PostgreSQL数据库，简化树数据，只保留数据库节点，移除子节点
        console.log(`DATABASE PANEL - 简化非${connection?.type?.toUpperCase()}数据库树结构，仅保留数据库节点`);
        treeDataToSet = data.map(dbNode => ({
          ...dbNode,
          children: [] // 清空子节点，只显示数据库列表
        }));
      }
      
      console.log('DATABASE PANEL - 最终树数据:', { treeDataLength: treeDataToSet.length, sample: treeDataToSet.slice(0, 5) });
      setTreeData(treeDataToSet);
      setExpandedKeys([]); // 初始不展开任何节点
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
        console.log('DATABASE PANEL - 通知父组件数据加载完成');
        onDataLoaded();
      }
      console.log('====================== DATABASE PANEL UPDATE END ===============================');
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

    // 处理节点选择 - 区分数据库类型
    const handleNodeSelect = (node: TreeNode) => {
      console.log('DATABASE PANEL - 节点被选择:', node.key, node.title);
      
      // 断开连接时禁止交互
      if (!connection?.isConnected) {
        console.log('DATABASE PANEL - 连接已断开，忽略节点选择');
        return;
      }
      
      if (node.type === 'database') {
        // 对于PostgreSQL数据库，点击数据库名称只展开/折叠节点，不打开数据库详情
        // 对于其他数据库类型，保持原有行为
        if (connection?.type !== 'postgresql' && connection?.type !== 'gaussdb') {
          const dbName = node.title as string;
          console.log('DATABASE PANEL - 选择数据库:', dbName);
          onDatabaseSelect(dbName);
          onTableSelect('');
          setActiveOtherObject('');
        }
      }
    };
    
    // 处理节点双击事件
    const handleNodeDoubleClick = (node: TreeNode) => {
      console.log('DATABASE PANEL - 节点双击:', node.key, node.title, node.type);
      
      // 断开连接时禁止交互
      if (!connection?.isConnected) {
        console.log('DATABASE PANEL - 连接已断开，忽略节点双击');
        return;
      }
      
      // 特别处理schema类型节点
      if (node.type === 'schema') {
        // 对于schema节点，双击时打开详情页面
        const schemaName = node.title?.toString().split(' (')[0] || ''; // 从标题中提取模式名
        console.log('DATABASE PANEL - 双击模式节点:', schemaName);
        // 设置模式名作为数据库名参数，打开详情页面
        onDatabaseSelect(schemaName);
        onTableSelect('');
        setActiveOtherObject('');
        return;
      }
      
      if (node.type === 'database') {
        if (connection?.type === 'postgresql' || connection?.type === 'gaussdb') {
          // 对于PostgreSQL/GaussDB，双击数据库节点时不打开数据浏览标签页，改为展开/折叠
          const key = node.key as string;
          const alreadyExpanded = expandedKeys.includes(key);
          const nextExpanded = alreadyExpanded ? expandedKeys.filter(k => k !== key) : [...expandedKeys, key];
          setExpandedKeys(nextExpanded);
        } else {
          const dbName = node.title as string;
          console.log('DATABASE PANEL - 双击打开数据库详情:', dbName);
          onDatabaseSelect(dbName);
          onTableSelect('');
          setActiveOtherObject('');
        }
      }
    };
    
    // 构建树组件
    return (
      <div className={`database-panel ${darkMode ? 'dark' : 'light'}`}>
        <DatabaseHeader
          loading={loading}
          onRefresh={handleRefresh}
        />
        <DatabaseStatus connection={connection} loading={loading} />
        {/* <DatabaseContextMenu /> */}

        {/* 数据加载服务组件，仅在连接存在时挂载 */}
        {connection && (
          <DatabaseDataLoader
            ref={dataLoaderRef}
            connection={connection}
            refreshTrigger={refreshTrigger}
            onDataLoaded={handleDataLoaded as any}
          />
        )}

        {/* 数据库树组件 */}
        {connection && (
          <DatabaseTree
            treeData={treeData}
            expandedKeys={expandedKeys}
            selectedKeys={activeDatabase ? [`db-${activeDatabase}`] : []}
            onNodeSelect={handleNodeSelect}
            onNodeDoubleClick={handleNodeDoubleClick}
            onExpand={(keys: Key[]) => setExpandedKeys(keys.map(k => String(k)))}
            loading={loading}
            darkMode={darkMode}
            databaseType={connection.type}
          />
        )}

        {/* 新增数据库弹窗 */}
        <AddDatabaseModal
          visible={isAddDatabaseModalVisible}
          connection={connection}
          onCancel={() => setIsAddDatabaseModalVisible(false)}
          onSuccess={() => {
            setIsAddDatabaseModalVisible(false);
            handleRefresh();
          }}
        />

        {/* 新增模式弹窗 */}
        <AddSchemaModal
          visible={isAddSchemaModalVisible}
          connection={connection}
          databaseName={selectedDatabaseName}
          onCancel={() => setIsAddSchemaModalVisible(false)}
          onSuccess={() => {
            setIsAddSchemaModalVisible(false);
            setSelectedDatabaseName('');
            handleRefresh();
          }}
        />
      </div>
    );
};

export default DatabasePanel;