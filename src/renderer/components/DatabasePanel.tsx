import React, { useState, useEffect, useContext } from 'react';
import { Tree, Spin, Empty, Tooltip, Dropdown, Button } from 'antd';
import { DatabaseOutlined, TableOutlined, FolderOutlined, CodeOutlined, FunctionOutlined, RestOutlined, MoreOutlined, IeOutlined } from '@ant-design/icons';
import { DatabaseConnection } from '../types';
import { useTheme } from './ThemeContext';
import { getDatabaseList, getDefaultDatabases } from '../utils/database-utils';
import './DatabasePanel.css';

const { DirectoryTree } = Tree;

interface DatabasePanelProps {
  connection: DatabaseConnection | null;
  onDatabaseSelect: (database: string) => void;
  onTableSelect: (table: string) => void;
  activeDatabase: string;
  activeTable: string;
  darkMode: boolean;
}

interface TreeNode {
  key: string;
  title: string;
  icon?: React.ReactNode;
  children?: TreeNode[];
  isLeaf?: boolean;
  type?: 'database' | 'table' | 'view' | 'procedure' | 'function' | 'query' | 'backup';
}

const DatabasePanel: React.FC<DatabasePanelProps> = ({
  connection,
  onDatabaseSelect,
  onTableSelect,
  activeDatabase,
  activeTable
}) => {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const { darkMode } = useTheme();

  // 数据库对象类型图标映射
  const objectTypeIcons: Record<string, React.ReactNode> = {
    database: <DatabaseOutlined />,
    table: <TableOutlined />,
    view: <IeOutlined />,
    procedure: <CodeOutlined />,
    function: <FunctionOutlined />,
    query: <CodeOutlined />,
    backup: <FolderOutlined />
  };

  // 模拟查询列表
  const mockQueries = [
    "最近查询 1",
    "最近查询 2",
    "最近查询 3"
  ];

  // 模拟备份列表
  const mockBackups = [
    "备份 2023-09-30",
    "备份 2023-09-25",
    "备份 2023-09-20"
  ];

  // 展开所有数据库节点
  const expandAllDatabases = () => {
    const databaseKeys = treeData.map(db => db.key);
    setExpandedKeys([...expandedKeys, ...databaseKeys]);
  };

  // 折叠所有数据库节点
  const collapseAllDatabases = () => {
    setExpandedKeys([]);
  };

  useEffect(() => {
    console.log('connection状态变化:', connection);
    if (connection && connection.isConnected) {
      loadDatabaseStructure();
    } else if (connection) {
      console.log('连接存在但未连接，仍尝试加载数据库结构（用于展示模拟数据）');
      loadDatabaseStructure();
    } else {
      setTreeData([]);
    }
  }, [connection]);

  const loadDatabaseStructure = async () => {
    if (!connection) return;

    setLoading(true);
    try {
      console.log('开始加载数据库列表，连接ID:', connection.id, '连接状态:', connection.isConnected, '数据库类型:', connection.type);
      
      // 使用工厂方法根据数据库类型获取数据库列表
      let databases = [];
      try {
        databases = await getDatabaseList(connection);
        console.log('成功获取数据库列表:', databases);
      } catch (error) {
        console.warn('获取数据库列表失败，使用默认数据:', error);
        databases = getDefaultDatabases();
      }

      // 确保databases至少有默认数据
      const displayDatabases = databases && databases.length > 0 ? databases : getDefaultDatabases();
      console.log('最终显示的数据库列表:', displayDatabases);

      // 对于每个数据库，尝试获取表、视图等信息
      const dataPromises = displayDatabases.map(async (dbInfo: string | { name: string; tables?: string[]; views?: string[]; procedures?: string[]; functions?: string[] }) => {
        const dbName = typeof dbInfo === 'string' ? dbInfo : dbInfo.name;
        let tables = [];
        let views = [];
        let procedures = [];
        let functions = [];
        
        // 尝试从真实数据库获取表信息
        if (window.electronAPI && connection.id && connection.isConnected) {
          try {
            // 先切换到当前数据库
            await window.electronAPI.executeQuery(connection.id, `USE \`${dbName}\``);
            
            // 获取表列表
            const tablesResult = await window.electronAPI.listTables(connection.id);
            if (tablesResult && tablesResult.success && Array.isArray(tablesResult.data)) {
              tables = tablesResult.data;
            }
            
            // 获取视图列表（这里简化处理，实际可能需要不同的查询）
            const viewsResult = await window.electronAPI.executeQuery(connection.id, 
              "SHOW FULL TABLES WHERE table_type LIKE 'VIEW'" 
            );
            if (viewsResult && viewsResult.success && Array.isArray(viewsResult.data)) {
              views = viewsResult.data.map((view: any) => view[`Tables_in_${dbName}`]);
            }
            
            // 获取存储过程列表
            const proceduresResult = await window.electronAPI.executeQuery(connection.id, 
              "SHOW PROCEDURE STATUS WHERE db = ?", [dbName] 
            );
            if (proceduresResult && proceduresResult.success && Array.isArray(proceduresResult.data)) {
              procedures = proceduresResult.data.map((proc: any) => proc.Name);
            }
            
            // 获取函数列表
            const functionsResult = await window.electronAPI.executeQuery(connection.id, 
              "SHOW FUNCTION STATUS WHERE db = ?", [dbName] 
            );
            if (functionsResult && functionsResult.success && Array.isArray(functionsResult.data)) {
              functions = functionsResult.data.map((func: any) => func.Name);
            }
          } catch (error) {
            console.warn(`获取数据库${dbName}的对象信息失败`, error);
            // 使用默认值继续
            if (typeof dbInfo === 'object' && dbInfo.tables) {
              tables = dbInfo.tables || [];
              views = dbInfo.views || [];
              procedures = dbInfo.procedures || [];
              functions = dbInfo.functions || [];
            }
          }
        } else if (typeof dbInfo === 'object') {
          // 如果使用的是模拟数据对象
          tables = dbInfo.tables || [];
          views = dbInfo.views || [];
          procedures = dbInfo.procedures || [];
          functions = dbInfo.functions || [];
        }
        
        return {
          key: `db-${dbName}`,
          title: dbName,
          icon: objectTypeIcons.database,
          type: 'database' as const,
          children: [
            // 第二层固定展示表、视图、函数、查询、备份等分类
            tables.length > 0 ? {
              key: `tables-${dbName}`,
              title: `表 (${tables.length})`,
              icon: <FolderOutlined />,
              children: tables.map((table: string) => ({
                key: `table-${dbName}-${table}`,
                title: table,
                icon: objectTypeIcons.table,
                isLeaf: true,
                type: 'table' as const
              }))
            } : {
              key: `tables-${dbName}`,
              title: `表 (0)`,
              icon: <FolderOutlined />,
              children: [],
              disabled: true
            },
            views.length > 0 ? {
              key: `views-${dbName}`,
              title: `视图 (${views.length})`,
              icon: <FolderOutlined />,
              children: views.map((view: string) => ({
                key: `view-${dbName}-${view}`,
                title: view,
                icon: objectTypeIcons.view,
                isLeaf: true,
                type: 'view' as const
              }))
            } : {
              key: `views-${dbName}`,
              title: `视图 (0)`,
              icon: <FolderOutlined />,
              children: [],
              disabled: true
            },
            procedures.length > 0 ? {
              key: `procedures-${dbName}`,
              title: `存储过程 (${procedures.length})`,
              icon: <FolderOutlined />,
              children: procedures.map((procedure: string) => ({
                key: `procedure-${dbName}-${procedure}`,
                title: procedure,
                icon: objectTypeIcons.procedure,
                isLeaf: true,
                type: 'procedure' as const
              }))
            } : {
              key: `procedures-${dbName}`,
              title: `存储过程 (0)`,
              icon: <FolderOutlined />,
              children: [],
              disabled: true
            },
            functions.length > 0 ? {
              key: `functions-${dbName}`,
              title: `函数 (${functions.length})`,
              icon: <FolderOutlined />,
              children: functions.map((func: string) => ({
                key: `function-${dbName}-${func}`,
                title: func,
                icon: objectTypeIcons.function,
                isLeaf: true,
                type: 'function' as const
              }))
            } : {
              key: `functions-${dbName}`,
              title: `函数 (0)`,
              icon: <FolderOutlined />,
              children: [],
              disabled: true
            },
            {
              key: `queries-${dbName}`,
              title: `查询 (${mockQueries.length})`,
              icon: <FolderOutlined />,
              children: mockQueries.map((query, index) => ({
                key: `query-${dbName}-${index}`,
                title: query,
                icon: objectTypeIcons.query,
                isLeaf: true,
                type: 'query' as const
              }))
            },
            {
              key: `backups-${dbName}`,
              title: `备份 (${mockBackups.length})`,
              icon: <FolderOutlined />,
              children: mockBackups.map((backup, index) => ({
                key: `backup-${dbName}-${index}`,
                title: backup,
                icon: objectTypeIcons.backup,
                isLeaf: true,
                type: 'backup' as const
              }))
            }
          ].filter(Boolean) as TreeNode[]
        };
      });
      
      const data: TreeNode[] = await Promise.all(dataPromises);

      setTreeData(data);
      console.log('数据库结构加载完成，树节点数量:', data.length);
      
      // 自动展开第一个数据库
      if (data.length > 0) {
        setExpandedKeys([data[0].key]);
        onDatabaseSelect(data[0].title);
        console.log('自动选择第一个数据库:', data[0].title);
      } else {
        console.warn('未生成任何树节点数据，将使用默认的数据库结构');
        // 如果没有生成任何树节点，使用默认的数据库结构
        const defaultData: TreeNode[] = [
          {
            key: 'default-db',
            title: '默认数据库',
            icon: <DatabaseOutlined />,
            children: [
              {
                key: 'tables-default-db',
                title: '表 (1)',
                icon: <FolderOutlined />,
                children: [
                  {
                    key: 'table-default-db-example',
                    title: '示例表',
                    icon: <TableOutlined />,
                    isLeaf: true,
                    type: 'table' as const
                  }
                ]
              }
            ]
          }
        ];
        setTreeData(defaultData);
        setExpandedKeys(['default-db', 'tables-default-db']);
        onDatabaseSelect('默认数据库');
      }
    } catch (error) {
      console.error('加载数据库结构失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 刷新数据库结构
  const handleRefresh = () => {
    if (connection && connection.isConnected) {
      loadDatabaseStructure();
    }
  };

  // 获取数据库对象的右键菜单
  const getObjectMenu = (node: any) => {
    const menuItems = [];
    
    // 根据节点类型添加不同的操作
    if (node.type === 'database') {
      menuItems.push(
        {
          key: 'refresh',
          label: '刷新',
          icon: <RestOutlined />,
          onClick: () => {
            // 这里可以实现单独刷新某个数据库
            loadDatabaseStructure();
          }
        },
        {
          key: 'new-query',
          label: '新建查询',
          onClick: () => {
            // 这里可以实现新建查询功能
            console.log('新建查询:', node.title);
          }
        }
      );
    } else if (node.type === 'table') {
      menuItems.push(
        {
          key: 'view-data',
          label: '查看数据',
          onClick: () => {
            const dbName = node.parent?.parent?.title;
            if (dbName) {
              onDatabaseSelect(dbName);
              onTableSelect(node.title);
            }
          }
        },
        {
          key: 'design-table',
          label: '设计表',
          onClick: () => {
            console.log('设计表:', node.title);
          }
        },
        {
          key: 'new-query',
          label: '新建查询',
          onClick: () => {
            console.log('针对表新建查询:', node.title);
          }
        }
      );
    } else if (node.type === 'view' || node.type === 'procedure' || node.type === 'function') {
      menuItems.push(
        {
          key: 'edit',
          label: '编辑',
          onClick: () => {
            console.log('编辑对象:', node.title);
          }
        },
        {
          key: 'execute',
          label: '执行',
          onClick: () => {
            console.log('执行对象:', node.title);
          }
        }
      );
    }
    
    return { items: menuItems };
  };

  // 自定义树节点渲染
  const renderTreeNode = (props: any) => {
    const { className, style, title, key, isLeaf, isSelected } = props;
    
    return (
      <Dropdown menu={getObjectMenu(props)} trigger={['contextMenu']}>
        <span 
          className={`${className} custom-tree-node ${darkMode ? 'dark' : ''} ${isSelected ? 'selected' : ''}`}
          style={{ ...style, whiteSpace: 'nowrap' }}
        >
          {props.icon}
          <span className="node-title">{title}</span>
        </span>
      </Dropdown>
    );
  };

  const handleSelect = (selectedKeys: React.Key[], info: any) => {
    const node = info.node;
    
    console.log('节点被选择:', node.key, node.title);
    
    if (node.key.startsWith('db-')) {
      // 选择数据库
      const dbName = node.title as string;
      console.log('选择数据库:', dbName);
      onDatabaseSelect(dbName);
      onTableSelect('');
    } else if (node.key.startsWith('table-')) {
      // 选择表
      const tableName = node.title as string;
      // 现在表位于表分类下，需要从祖父节点获取数据库名称
      if (node.parent && node.parent.parent) {
        const dbKey = node.parent.parent.key as string;
        const dbName = dbKey.replace('db-', '');
        
        console.log('选择表:', tableName, '数据库:', dbName);
        onDatabaseSelect(dbName);
        onTableSelect(tableName);
      }
    } else if (node.key.startsWith('view-') || node.key.startsWith('procedure-') || node.key.startsWith('function-')) {
      // 选择视图、存储过程或函数
      const objectName = node.title as string;
      // 从祖父节点获取数据库名称
      if (node.parent && node.parent.parent) {
        const dbKey = node.parent.parent.key as string;
        const dbName = dbKey.replace('db-', '');
        
        onDatabaseSelect(dbName);
        onTableSelect(''); // 清除选中的表
      }
    } else if (node.key.startsWith('query-')) {
      // 选择查询
      const queryName = node.title as string;
      // 从祖父节点获取数据库名称
      if (node.parent && node.parent.parent) {
        const dbKey = node.parent.parent.key as string;
        const dbName = dbKey.replace('db-', '');
        
        onDatabaseSelect(dbName);
        onTableSelect(''); // 清除选中的表
      }
    } else if (node.key.startsWith('backup-')) {
      // 选择备份
      const backupName = node.title as string;
      // 从祖父节点获取数据库名称
      if (node.parent && node.parent.parent) {
        const dbKey = node.parent.parent.key as string;
        const dbName = dbKey.replace('db-', '');
        
        onDatabaseSelect(dbName);
        onTableSelect(''); // 清除选中的表
      }
    }
    // 对于分类节点（表、视图等文件夹），不需要特殊处理，让树组件默认展开即可
  };

  const handleExpand = (expandedKeys: React.Key[]) => {
    setExpandedKeys(expandedKeys as string[]);
  };

  if (!connection) {
    return (
      <div className={`database-panel ${darkMode ? 'dark' : ''}`}>
        <div className="database-header">
          <div className="header-content">
            <span className="header-title">数据库</span>
            <div className="header-actions">
              <Tooltip title="刷新">
                <Button 
                  type="text" 
                  icon={<RestOutlined />} 
                  onClick={handleRefresh}
                  size="small"
                  className="refresh-btn"
                />
              </Tooltip>
              <Dropdown 
                menu={{
                  items: [
                    {
                      key: 'expand-all',
                      label: '全部展开',
                      onClick: expandAllDatabases
                    },
                    {
                      key: 'collapse-all',
                      label: '全部折叠',
                      onClick: collapseAllDatabases
                    }
                  ]
                }}
              >
                <Button 
                  type="text" 
                  icon={<MoreOutlined />}
                  size="small"
                  className="more-btn"
                />
              </Dropdown>
            </div>
          </div>
        </div>
        <div className="empty-state">
          <Empty 
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="请先选择或创建连接"
          />
        </div>
      </div>
    );
  }

  if (!connection.isConnected) {
    return (
      <div className={`database-panel ${darkMode ? 'dark' : ''}`}>
        <div className="database-header">
          <div className="header-content">
            <span className="header-title">数据库</span>
            <div className="header-actions">
              <Tooltip title="刷新">
                <Button 
                  type="text" 
                  icon={<RestOutlined />} 
                  onClick={handleRefresh}
                  size="small"
                  className="refresh-btn"
                />
              </Tooltip>
              <Dropdown 
                menu={{
                  items: [
                    {
                      key: 'expand-all',
                      label: '全部展开',
                      onClick: expandAllDatabases
                    },
                    {
                      key: 'collapse-all',
                      label: '全部折叠',
                      onClick: collapseAllDatabases
                    }
                  ]
                }}
              >
                <Button 
                  type="text" 
                  icon={<MoreOutlined />}
                  size="small"
                  className="more-btn"
                />
              </Dropdown>
            </div>
          </div>
        </div>
        <div className="empty-state">
          <Empty 
            description="连接未建立"
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`database-panel ${darkMode ? 'dark' : ''}`}>
      <div className="database-header">
        <div className="header-content">
          <span className="header-title">数据库</span>
          <div className="header-actions">
            <Tooltip title="刷新">
              <Button 
                type="text" 
                icon={<RestOutlined />} 
                onClick={handleRefresh}
                size="small"
                className="refresh-btn"
              />
            </Tooltip>
            <Dropdown 
              menu={{
                items: [
                  {
                    key: 'expand-all',
                    label: '全部展开',
                    onClick: expandAllDatabases
                  },
                  {
                    key: 'collapse-all',
                    label: '全部折叠',
                    onClick: collapseAllDatabases
                  }
                ]
              }}
            >
              <Button 
                type="text" 
                icon={<MoreOutlined />}
                size="small"
                className="more-btn"
              />
            </Dropdown>
          </div>
        </div>
      </div>
      
      <div className="database-tree">
        {loading ? (
          <div className="loading-container">
            <Spin tip="加载中..." />
          </div>
        ) : treeData.length > 0 ? (
          <DirectoryTree
            treeData={treeData}
            expandedKeys={expandedKeys}
            selectedKeys={[
              ...(activeDatabase ? [`db-${activeDatabase}`] : []),
              ...(activeTable ? [`table-${activeDatabase}-${activeTable}`] : [])
            ]}
            onSelect={handleSelect}
            onExpand={handleExpand}
            showIcon={false}
            defaultExpandAll={false}
            titleRender={renderTreeNode}
          />
        ) : (
          <div className="empty-state">
            <Empty 
              description="暂无数据库"
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default DatabasePanel;