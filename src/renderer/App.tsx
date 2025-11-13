import React, { useState, useEffect, useRef } from 'react';
import { Layout, Tabs, message, Button, Tooltip, Dropdown, Badge, Menu } from 'antd';
import RedisQueryPage from './components/redis/RedisQueryPage';
import {
  PlusOutlined, DatabaseOutlined, UserOutlined,
  FileTextOutlined, BankOutlined, 
  MoonOutlined, SunOutlined, MenuOutlined, SearchOutlined,
  SaveOutlined, RestOutlined, FilterOutlined, SettingOutlined,
  TableOutlined, ScanOutlined, EyeOutlined, ExportOutlined,
  AlignLeftOutlined
} from '@ant-design/icons';
import { ConnectionPanel, DatabasePanel, useTheme, AddDatabaseModal, AddSchemaModal } from './components/common';
import { ThemeProvider } from './components/common/ThemeContext';
import { QueryPanel } from './components/sql-query';
import { DatabaseTabPanel, MySqlDatabaseTabPanel, PostgreSqlDatabaseTabPanel } from './components/database-detail';
import { TableDataPanel, MySqlDataPanel, PostgreSqlDataPanel } from './components/data-view';
import { TableStructurePanel } from './components/table-design';
import { DatabaseTree, TreeNodeRenderer } from './components/database-list';
import { DatabaseConnection, DatabaseType } from './types';
import './App.css';
import RedisDataBrowser from './components/data-view/RedisDataBrowser';
import RedisActions from './components/redis/RedisActions';
import RedisServiceInfoPage from './components/redis/RedisServiceInfoPage';
import RedisSlowlogPage from './components/redis/RedisSlowlogPage';
import RedisCliPage from './components/redis/RedisCliPage';
import RedisPubSubPage from './components/redis/RedisPubSubPage';
import MySqlActions from './components/mysql/MySqlActions';
import MySqlServiceInfoPage from './components/mysql/MySqlServiceInfoPage';
import MySqlUsersPage from './components/mysql/MySqlUsersPage';
import MySqlCliPage from './components/mysql/MySqlCliPage';
import MySqlSlowlogPage from './components/mysql/MySqlSlowlogPage';

const { Sider, Content, Header, Footer } = Layout;
const { TabPane } = Tabs;

// 标签页类型定义
interface DatabaseTab {
  key: string;
  label: string;
  connection: DatabaseConnection;
  database: string;
  type: DatabaseType;
}

interface QueryTab {
  key: string;
  label: string;
  query: string;
  connection?: DatabaseConnection;
  database?: string;
}

interface TableDataTab {
  key: string;
  label: string;
  connection: DatabaseConnection;
  database: string;
  tableName: string;
  type: DatabaseType;
}

interface TableDesignTab {
  key: string;
  label: string;
  connection: DatabaseConnection;
  database: string;
  tableName: string;
  type: DatabaseType;
}

const AppContent: React.FC = () => {
  // 核心状态管理
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
    
  const [activeConnection, setActiveConnection] = useState<DatabaseConnection | null>(null);
  const [activeDatabase, setActiveDatabase] = useState<string>('');
  const [activeTable, setActiveTable] = useState<string>('');
  
  // 标签页管理
  const [databaseTabs, setDatabaseTabs] = useState<DatabaseTab[]>([]);
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([]);
  const [tableDataTabs, setTableDataTabs] = useState<TableDataTab[]>([]);
  const [tableDesignTabs, setTableDesignTabs] = useState<TableDesignTab[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string>('');
  
  // UI状态
  const { darkMode, toggleDarkMode } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [showDatabasePanel, setShowDatabasePanel] = useState<boolean>(true);
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);


  // 初始化
  useEffect(() => {
    console.log('[APP INIT] 开始初始化应用');
    
    // 从连接存储服务加载连接列表
    const loadConnections = async () => {
      console.log('[APP INIT] 开始加载连接列表');
      if (window.electronAPI) {
        try {
          const result = await window.electronAPI.getAllConnections();
          if (result.success) {
            // 只加载连接列表，但不自动设置活动连接
            setConnections(result.connections);
            console.log('[APP INIT] 连接列表加载成功，共加载', result.connections.length, '个连接');
            // 初始化时不自动选择任何连接，保持activeConnection为null
            
            // 添加Redis数据库加载相关的全局日志点
            const redisConnections = result.connections.filter(conn => conn.type === 'redis');
            if (redisConnections.length > 0) {
              console.log('[APP INIT] 发现Redis连接，共', redisConnections.length, '个');
            }
          } else {
            console.error('加载连接列表失败:', result.message);
            message.error('加载连接列表失败');
          }
        } catch (error) {
          console.error('加载连接列表异常:', error);
          message.error('加载连接列表异常');
        }
      } else {
        console.log('[APP INIT] electronAPI不可用，无法加载连接列表');
      }
    };

    loadConnections();

    // 监听菜单事件
    if (window.electronAPI) {
      console.log('[APP INIT] 设置菜单事件监听器');
      window.electronAPI.onMenuNewConnection(() => {
        // 触发新建连接逻辑
        createNewConnection();
      });
    }

    // 检查是否有Redis连接相关的工具可用
    try {
      if (typeof window !== 'undefined') {
        console.log('[APP INIT] Window对象可用，准备Redis连接');
        // 确保localStorage可用
        if (typeof localStorage !== 'undefined') {
          console.log('[APP INIT] localStorage可用，可以用于缓存管理');
        }
      }
    } catch (error) {
      console.error('[APP INIT] 检查环境时出错:', error);
    }

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeAllListeners('menu-new-connection');
      }
      console.log('[APP INIT] 清理资源');
    };
  }, []);

  // 连接管理
  const handleConnectionCreate = async (connection: DatabaseConnection) => {
    try {
      // 确保connection是一个完整的DatabaseConnection实例
      const newConnection: DatabaseConnection = {
        ...connection,
        isConnected: false
      };
      if (window.electronAPI) {
        const result = await window.electronAPI.saveConnection(newConnection);
        if (result.success) {
          setConnections(prev => [...prev, newConnection]);
          setActiveConnection(newConnection);
          message.success(result.message || '连接创建成功');
        } else {
          console.error('保存连接失败:', result.message);
          message.error(result.message || '保存连接失败');
        }
      } else {
        // 开发环境下的备选方案
        setConnections(prev => [...prev, newConnection]);
        setActiveConnection(newConnection);
        message.success('连接创建成功（模拟）');
      }
    } catch (error) {
      console.error('创建连接异常:', error);
      message.error('创建连接异常');
    }
  };

  const handleConnectionSelect = async (connection: DatabaseConnection) => {
    // 从连接列表中获取完整的连接对象（包含connectionId）
    const fullConnection = connections.find(conn => conn.id === connection.id);
    
    // 如果连接已经处于连接状态，仍然需要确保重新加载数据库列表
    if (connection.isConnected && fullConnection) {
      // 创建一个新的连接对象引用，确保状态更新能被检测到
      const updatedConnection = {
        ...fullConnection,
        lastAccessed: Date.now() // 添加时间戳确保对象引用变化
      };
      setActiveConnection(updatedConnection);
      console.log('连接已存在，更新连接信息以触发数据库列表重新加载');
      
      // 更新连接列表中的状态
      setConnections(prev => 
        prev.map(conn => conn.id === connection.id ? updatedConnection : conn)
      );
      
      // 让DatabasePanel组件的自动选择逻辑工作，不手动选择数据库
      return;
    }
    
    // 先设置基本连接信息，但保持isConnected为false
    setActiveConnection({ ...connection, isConnected: false });
    
    // 用户第一次点击连接时，尝试连接到数据库并设置连接状态
    try {
      if (window.electronAPI && connection.id) {
        // 先测试连接并尝试复用/保留测试创建的连接池
        const generatedId = `${connection.type}_${connection.host}_${connection.port}_${connection.database || ''}`;
        const testResult = await window.electronAPI.testConnection(connection);
        if (testResult && testResult.success) {
          // 测试成功后检查是否已存在连接池配置（复用测试创建的池）
          const cfgRes = await window.electronAPI.getConnectionPoolConfig(generatedId);
          if (cfgRes) {
            const updatedConnection = {
              ...connection,
              isConnected: true,
              connectionId: generatedId
            };
            setActiveConnection(updatedConnection);
            setConnections(prev => prev.map(conn => conn.id === connection.id ? updatedConnection : conn));
            console.log('测试连接成功并复用/保留连接池，设置poolId:', generatedId);
          } else {
            // 未检测到连接池配置，回退到创建持久连接
            const connectResult = await window.electronAPI.connectDatabase(connection);
            if (connectResult && connectResult.success) {
              const updatedConnection = {
                ...connection,
                isConnected: true,
                connectionId: connectResult.connectionId
              };
              setActiveConnection(updatedConnection);
              setConnections(prev => prev.map(conn => conn.id === connection.id ? updatedConnection : conn));
              console.log('连接池未检测到，创建持久连接成功，poolId:', connectResult.connectionId);
            } else {
              console.warn('连接数据库失败:', connectResult?.message);
              setActiveConnection({ ...connection, isConnected: false });
              setConnections(prev => prev.map(conn => conn.id === connection.id ? { ...conn, isConnected: false } : conn));
              message.error('连接数据库失败: ' + (connectResult?.message || '未知错误'));
            }
          }
        } else {
          // 测试失败，保持未连接状态并提示
          console.warn('测试连接失败:', (testResult && testResult.error) || '未知错误');
          setActiveConnection({ ...connection, isConnected: false });
          setConnections(prev => prev.map(conn => conn.id === connection.id ? { ...conn, isConnected: false } : conn));
          message.error('连接测试失败: ' + ((testResult && testResult.error) || '未知错误'));
        }
      } else {
        // 开发环境或无法使用electronAPI时，设置为未连接状态
        setActiveConnection({ ...connection, isConnected: false });
        console.log('无法使用electronAPI，设置为未连接状态');
      }
    } catch (error) {
      console.error('连接数据库时出错:', error);
      setActiveConnection({ ...connection, isConnected: false });
      setConnections(prev => prev.map(conn => conn.id === connection.id ? { ...conn, isConnected: false } : conn));
      message.error('连接数据库时发生错误');
    }
  };

  const handleConnectionEdit = async (connection: DatabaseConnection) => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.saveConnection(connection);
        if (result.success) {
          setConnections(prev => 
            prev.map(conn => conn.id === connection.id ? connection : conn)
          );
          setActiveConnection(connection);
          message.success(result.message || '连接更新成功');
        } else {
          console.error('更新连接失败:', result.message);
          message.error(result.message || '更新连接失败');
        }
      } else {
        // 开发环境下的备选方案
        setConnections(prev => 
          prev.map(conn => conn.id === connection.id ? connection : conn)
        );
        setActiveConnection(connection);
        message.success('连接更新成功（模拟）');
      }
    } catch (error) {
      console.error('更新连接异常:', error);
      message.error('更新连接异常');
    }
  };

  const handleConnectionDelete = async (connectionId: string) => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.deleteConnection(connectionId);
        if (result.success) {
          setConnections(prev => prev.filter(conn => conn.id !== connectionId));
          if (activeConnection && activeConnection.id === connectionId) {
            setActiveConnection(null);
            setActiveDatabase('');
            setActiveTable('');
          }
          message.success(result.message || '连接删除成功');
        } else {
          console.error('删除连接失败:', result.message);
          message.error(result.message || '删除连接失败');
        }
      } else {
        // 开发环境下的备选方案
        setConnections(prev => prev.filter(conn => conn.id !== connectionId));
        if (activeConnection && activeConnection.id === connectionId) {
          setActiveConnection(null);
          setActiveDatabase('');
          setActiveTable('');
        }
        message.success('连接删除成功（模拟）');
      }
    } catch (error) {
      console.error('删除连接异常:', error);
      message.error('删除连接异常');
    }
  };

  // 新增：断开连接并清理相关页面与状态
  const handleConnectionDisconnect = async (connection: DatabaseConnection) => {
    try {
      const poolId = connection.connectionId || `${connection.type}_${connection.host}_${connection.port}_${connection.database || ''}`;
      if (window.electronAPI && connection.isConnected && poolId) {
        await window.electronAPI.disconnectDatabase(poolId);
      }

      // 先计算新标签页集合，移除该连接的所有相关页面
      const newDbTabs = databaseTabs.filter(t => t.connection.id !== connection.id);
      const newQueryTabs = queryTabs.filter(t => (t.connection?.id || '') !== connection.id);
      const newTableDataTabs = tableDataTabs.filter(t => t.connection.id !== connection.id);
      const newTableDesignTabs = tableDesignTabs.filter(t => t.connection.id !== connection.id);

      setDatabaseTabs(newDbTabs);
      setQueryTabs(newQueryTabs);
      setTableDataTabs(newTableDataTabs);
      setTableDesignTabs(newTableDesignTabs);

      // 更新连接状态为未连接并清除连接池ID
      setConnections(prev => prev.map(conn => conn.id === connection.id ? { ...conn, isConnected: false, connectionId: undefined } : conn));

      // 如当前活动连接为该连接，则清空右侧上下文并重置活动标签
      if (activeConnection && activeConnection.id === connection.id) {
        const updatedActive = { ...connection, isConnected: false, connectionId: undefined };
        setActiveConnection(updatedActive);
        setActiveDatabase('');
        setActiveTable('');

        const nextTabsOrder = [
          ...newDbTabs,
          ...newQueryTabs,
          ...newTableDataTabs,
          ...newTableDesignTabs
        ];
        setActiveTabKey(nextTabsOrder.length > 0 ? nextTabsOrder[0].key : '');
      }

      message.success('连接已断开，已关闭相关页面并清理数据');
    } catch (error) {
      console.error('断开连接异常:', error);
      message.error('断开连接时发生错误');
    }
  };

  // ConnectionPanel ref用于直接调用新建连接方法
  const connectionPanelRef = useRef<{ handleCreateConnection: () => void }>(null);

  // 创建新连接
  const createNewConnection = () => {
    // 使用ref直接调用ConnectionPanel的方法打开新建连接模态框
    if (connectionPanelRef.current) {
      connectionPanelRef.current.handleCreateConnection();
    }
  };

  // 数据库标签页管理
  const handleDatabaseSelect = (database: string) => {
    if (!activeConnection) return;
    
    const tabKey = `db-${activeConnection.id}-${database}`;
    const existingTab = databaseTabs.find(tab => tab.key === tabKey);
    
    if (!existingTab) {
      const newTab: DatabaseTab = {
        key: tabKey,
        label: `${activeConnection.name} - ${database}`,
        connection: activeConnection || undefined,
        database: database,
        type: activeConnection.type
      };
      
      setDatabaseTabs(prev => [...prev, newTab]);
      setActiveTabKey(tabKey);
    } else {
      setActiveTabKey(tabKey);
    }
    
    setActiveDatabase(database);
  };

  // 表选择处理
  const handleTableSelect = (table: string) => {
    if (!activeConnection || !activeDatabase || !table) return;
    
    // 设置当前活动表
    setActiveTable(table);
    
    // 创建表数据标签页
    const tabKey = `table-${activeConnection.id}-${activeDatabase}-${table}`;
    const existingTab = tableDataTabs.find(tab => tab.key === tabKey);
    
    if (!existingTab) {
      const newTab: TableDataTab = {
        key: tabKey,
        label: `${activeDatabase}.${table}`,
        connection: activeConnection,
        database: activeDatabase,
        tableName: table,
        type: activeConnection.type
      };
      
      setTableDataTabs(prev => [...prev, newTab]);
      setActiveTabKey(tabKey);
    } else {
      setActiveTabKey(tabKey);
    }
  };

  // 关闭标签页
  const handleTabClose = (targetKey: string | MouseEvent | KeyboardEvent) => {
    // 确保targetKey是字符串类型
    const key = typeof targetKey === 'string' ? targetKey : '';
    // 查找标签类型
    const isDbTab = databaseTabs.some(t => t.key === targetKey);
    const isQueryTab = queryTabs.some(t => t.key === targetKey);
    const isTableTab = tableDataTabs.some(t => t.key === targetKey);
    const isTableDesignTab = tableDesignTabs.some(t => t.key === targetKey);
    
    if (isDbTab) {
      const newTabs = databaseTabs.filter(tab => tab.key !== targetKey);
      setDatabaseTabs(newTabs);
    } else if (isQueryTab) {
      const newTabs = queryTabs.filter(tab => tab.key !== targetKey);
      setQueryTabs(newTabs);
    } else if (isTableTab) {
      const newTabs = tableDataTabs.filter(tab => tab.key !== targetKey);
      setTableDataTabs(newTabs);
    } else if (isTableDesignTab) {
      const newTabs = tableDesignTabs.filter(tab => tab.key !== targetKey);
      setTableDesignTabs(newTabs);
    }
    
    // 如果关闭的是当前活跃标签，切换到下一个合适的标签
    if (activeTabKey === key) {
      if (databaseTabs.length > 0) {
        setActiveTabKey(databaseTabs[0].key);
      } else if (queryTabs.length > 0) {
        setActiveTabKey(queryTabs[0].key);
      } else if (tableDataTabs.length > 0) {
        setActiveTabKey(tableDataTabs[0].key);
      } else if (tableDesignTabs.length > 0) {
        setActiveTabKey(tableDesignTabs[0].key);
      } else {
        setActiveTabKey('');
      }
    }
  };

  // 标签页切换
  const handleTabChange = (key: string) => {
    setActiveTabKey(key);
    
    const dbTab = databaseTabs.find(t => t.key === key);
    if (dbTab) {
      setActiveConnection(dbTab.connection);
      setActiveDatabase(dbTab.database);
    }
    
    const tableDesignTab = tableDesignTabs.find(t => t.key === key);
    if (tableDesignTab) {
      setActiveConnection(tableDesignTab.connection);
      setActiveDatabase(tableDesignTab.database);
      setActiveTable(tableDesignTab.tableName);
    }
  };
  
  // 创建新的表设计标签页
  const handleTableDesign = (connection: DatabaseConnection, database: string, tableName: string) => {
    const tabKey = `design-${connection.id}-${database}-${tableName}`;
    const existingTab = tableDesignTabs.find(tab => tab.key === tabKey);
    
    if (!existingTab) {
      const newTab: TableDesignTab = {
        key: tabKey,
        label: `${database}.${tableName} (设计)`,
        connection: connection,
        database: database,
        tableName: tableName,
        type: connection.type
      };
      
      setTableDesignTabs(prev => [...prev, newTab]);
      setActiveTabKey(tabKey);
    } else {
      setActiveTabKey(tabKey);
    }
    
    setActiveConnection(connection);
    setActiveDatabase(database);
    setActiveTable(tableName);
  };

  // 创建新查询标签页
  const handleNewQuery = (databaseName?: string) => {
    const tabKey = `query-${Date.now()}`;
    // 使用传入的数据库名称或当前活动数据库
    const targetDatabase = databaseName || activeDatabase;
    
    // 根据连接类型生成不同的默认查询内容
    let defaultQuery = '';
    if (activeConnection?.type === 'redis') {
      // Redis连接的默认内容
      defaultQuery = '# Redis命令示例\n# 输入命令执行，例如:\n# KEYS * - 列出所有键\n# GET key_name - 获取键值\n# SET key_name value - 设置键值\n\n';
    } else {
      // SQL数据库的默认内容
      defaultQuery = '-- 输入SQL查询语句\n-- 例如: SELECT * FROM table_name LIMIT 100;\n\n';
      if (targetDatabase) {
        defaultQuery = `-- 输入SQL查询语句\n-- 例如: SELECT * FROM \`${targetDatabase}\`\`.table_name LIMIT 100;\n\n`;
      }
    }
    
    const newTab: QueryTab = {
      key: tabKey,
      label: '查询 ' + (queryTabs.length + 1),
      query: defaultQuery,
      connection: activeConnection || undefined,
      database: targetDatabase
    };
    
    setQueryTabs(prev => [...prev, newTab]);
    setActiveTabKey(tabKey);
  };

  // 渲染文件菜单
  const renderFileMenu = () => {
    const items = [
      { key: 'new-connection', label: '新建连接', icon: <PlusOutlined /> },
      { key: 'new-query', label: '新建查询', icon: <DatabaseOutlined /> },
      { key: 'save', label: '保存', icon: <SaveOutlined /> },
      { type: 'divider' },
      { key: 'import', label: '导入', icon: <FileTextOutlined /> },
      { key: 'export', label: '导出', icon: <ExportOutlined /> },
      { type: 'divider' },
      { key: 'exit', label: '退出' }
    ];
    
    const handleClick = (e: any) => {
      switch (e.key) {
        case 'new-connection':
          createNewConnection();
          break;
        case 'new-query':
          handleNewQuery();
          break;
        case 'save':
          message.info('保存功能待实现');
          break;
        case 'import':
        case 'export':
          message.info(`${e.key}功能待实现`);
          break;
        case 'exit':
          message.info('退出应用功能待实现');
          break;
      }
    };
    
    return (
      <Menu onClick={handleClick} mode="horizontal" selectedKeys={[]}>
        <Menu.SubMenu key="file" title="文件">
          {items.map(item => (
            item.type === 'divider' ? (
              <Menu.Divider key={`divider-${Math.random()}`} />
            ) : (
              <Menu.Item key={item.key} icon={item.icon}>
                {item.label}
              </Menu.Item>
            )
          ))}
        </Menu.SubMenu>
        
        <Menu.SubMenu key="edit" title="编辑">
          <Menu.Item key="copy">复制</Menu.Item>
          <Menu.Item key="paste">粘贴</Menu.Item>
          <Menu.Item key="delete">删除</Menu.Item>
        </Menu.SubMenu>
        
        <Menu.SubMenu key="view" title="视图">
          <Menu.Item key="toggle-database-panel" onClick={() => setShowDatabasePanel(!showDatabasePanel)}>
            显示数据库面板
          </Menu.Item>
          <Menu.Item key="toggle-dark-mode" onClick={toggleDarkMode}>
            {darkMode ? '切换为亮色模式' : '切换为暗色模式'}
          </Menu.Item>
        </Menu.SubMenu>
        
        <Menu.SubMenu key="tools" title="工具">
          <Menu.Item key="data-transfer">数据传输</Menu.Item>
          <Menu.Item key="backup">备份</Menu.Item>
          <Menu.Item key="query-builder">查询构建器</Menu.Item>
        </Menu.SubMenu>
        
        <Menu.SubMenu key="help" title="帮助">
          <Menu.Item key="documentation">文档</Menu.Item>
          <Menu.Item key="about">关于</Menu.Item>
        </Menu.SubMenu>
      </Menu>
    );
  };



  // 渲染主工具栏
  const renderToolbar = () => {
    return (
      <div className={`app-toolbar ${darkMode ? 'dark' : ''}`}>
        <div className="toolbar-section">
          <Button 
            type="primary" 
            icon={<PlusOutlined />}
            onClick={createNewConnection}
            style={{ marginRight: 8 }}
          >
            新建连接
          </Button>
          
          <Button 
            icon={<DatabaseOutlined />}
            onClick={() => handleNewQuery()}
            style={{ marginRight: 8 }}
          >
            新建查询
          </Button>
          
          <Dropdown menu={{
            items: [
              { key: 'import', label: '导入', icon: <FileTextOutlined /> },
              { key: 'export', label: '导出', icon: <ExportOutlined /> }
            ],
            onClick: ({ key }) => message.info(`${key}功能待实现`) 
          }}>
            <Button icon={<FileTextOutlined />}>
              数据传输
            </Button>
          </Dropdown>
        </div>
        
        <div className="toolbar-section">
          <Button icon={<RestOutlined />} onClick={() => message.info('刷新成功')} />
        </div>
        
        <div className="toolbar-section">
          <div className={`search-box ${isSearchFocused ? 'focused' : ''}`}>
            <SearchOutlined className="search-icon" />
            <input 
              type="text" 
              placeholder="搜索..." 
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
            />
          </div>
        </div>
        
        {/* 按数据库类型扩展的自定义功能区域 */}
        {activeConnection?.type === 'redis' && (
          <RedisActions 
            connection={activeConnection}
            activeDatabase={activeDatabase}
            darkMode={darkMode}
            onOpenServiceInfo={handleOpenRedisServiceInfo}
            onOpenSlowlog={handleOpenRedisSlowlog}
            onOpenCli={handleOpenRedisCli}
            onOpenPubSub={handleOpenRedisPubSub}
          />
        )}
        {activeConnection?.type === 'mysql' && (
          <MySqlActions
            connection={activeConnection}
            activeDatabase={activeDatabase}
            darkMode={darkMode}
            onOpenServiceInfo={handleOpenMySqlServiceInfo}
            onOpenUsers={handleOpenMySqlUsers}
            onOpenCli={handleOpenMySqlCli}
            onOpenSlowlog={handleOpenMySqlSlowlog}
          />
        )}

        <div className="toolbar-section" style={{ marginLeft: 'auto' }}>
          <Tooltip title={darkMode ? '切换为亮色模式' : '切换为暗色模式'}>
            <Button 
              icon={darkMode ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggleDarkMode}
              type="text"
            />
          </Tooltip>
          
          <Button 
            icon={<MenuOutlined />}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            type="text"
          />
        </div>
      </div>
    );
  };

  // 打开 Redis 服务信息标签页
  const handleOpenRedisServiceInfo = () => {
    if (!activeConnection) {
      message.warning('请先选择一个Redis连接');
      return;
    }
    const dbName = activeDatabase || 'db0';
    const key = `redis-service-info-${activeConnection.id}-${dbName}`;
    const exists = databaseTabs.find(t => t.key === key);
    if (!exists) {
      const newTab: DatabaseTab = {
        key,
        label: 'Redis 服务信息',
        connection: activeConnection,
        database: dbName,
        type: 'redis' as DatabaseType
      };
      setDatabaseTabs(prev => [...prev, newTab]);
    }
    setActiveTabKey(key);
  };

  // 打开 Redis 慢日志标签页
  const handleOpenRedisSlowlog = () => {
    if (!activeConnection) {
      message.warning('请先选择一个Redis连接');
      return;
    }
    const dbName = activeDatabase || 'db0';
    const key = `redis-slowlog-${activeConnection.id}-${dbName}`;
    const exists = databaseTabs.find(t => t.key === key);
    if (!exists) {
      const newTab: DatabaseTab = {
        key,
        label: 'Redis 慢日志',
        connection: activeConnection,
        database: dbName,
        type: 'redis' as DatabaseType
      };
      setDatabaseTabs(prev => [...prev, newTab]);
    }
    setActiveTabKey(key);
  };

  // 打开 Redis 命令行标签页
  const handleOpenRedisCli = () => {
    if (!activeConnection) {
      message.warning('请先选择一个Redis连接');
      return;
    }
    const dbName = activeDatabase || 'db0';
    const key = `redis-cli-${activeConnection.id}-${dbName}`;
    const exists = databaseTabs.find(t => t.key === key);
    if (!exists) {
      const newTab: DatabaseTab = {
        key,
        label: 'Redis 命令行',
        connection: activeConnection,
        database: dbName,
        type: 'redis' as DatabaseType
      };
      setDatabaseTabs(prev => [...prev, newTab]);
    }
    setActiveTabKey(key);
  };

  // 打开 Redis 发布/订阅标签页
  const handleOpenRedisPubSub = () => {
    if (!activeConnection) {
      message.warning('请先选择一个Redis连接');
      return;
    }
    const dbName = activeDatabase || 'db0';
    const key = `redis-pubsub-${activeConnection.id}-${dbName}`;
    const exists = databaseTabs.find(t => t.key === key);
    if (!exists) {
      const newTab: DatabaseTab = {
        key,
        label: 'Redis 发布/订阅',
        connection: activeConnection,
        database: dbName,
        type: 'redis' as DatabaseType
      };
      setDatabaseTabs(prev => [...prev, newTab]);
    }
    setActiveTabKey(key);
  };

  // MySQL: 服务信息
  const handleOpenMySqlServiceInfo = () => {
    if (!activeConnection) {
      message.warning('请先选择一个MySQL连接');
      return;
    }
    const dbName = activeDatabase || 'information_schema';
    const key = `mysql-service-info-${activeConnection.id}-${dbName}`;
    const exists = databaseTabs.find(t => t.key === key);
    if (!exists) {
      const newTab: DatabaseTab = {
        key,
        label: 'MySQL 服务信息',
        connection: activeConnection,
        database: dbName,
        type: 'mysql' as DatabaseType
      };
      setDatabaseTabs(prev => [...prev, newTab]);
    }
    setActiveTabKey(key);
  };

  // MySQL: 用户信息
  const handleOpenMySqlUsers = () => {
    if (!activeConnection) {
      message.warning('请先选择一个MySQL连接');
      return;
    }
    const dbName = activeDatabase || 'mysql';
    const key = `mysql-users-${activeConnection.id}-${dbName}`;
    const exists = databaseTabs.find(t => t.key === key);
    if (!exists) {
      const newTab: DatabaseTab = {
        key,
        label: 'MySQL 用户信息',
        connection: activeConnection,
        database: dbName,
        type: 'mysql' as DatabaseType
      };
      setDatabaseTabs(prev => [...prev, newTab]);
    }
    setActiveTabKey(key);
  };

  // MySQL: 命令行
  const handleOpenMySqlCli = () => {
    if (!activeConnection) {
      message.warning('请先选择一个MySQL连接');
      return;
    }
    const dbName = activeDatabase || 'mysql';
    const key = `mysql-cli-${activeConnection.id}-${dbName}`;
    const exists = databaseTabs.find(t => t.key === key);
    if (!exists) {
      const newTab: DatabaseTab = {
        key,
        label: 'MySQL 命令行',
        connection: activeConnection,
        database: dbName,
        type: 'mysql' as DatabaseType
      };
      setDatabaseTabs(prev => [...prev, newTab]);
    }
    setActiveTabKey(key);
  };

  // MySQL: 慢日志
  const handleOpenMySqlSlowlog = () => {
    if (!activeConnection) {
      message.warning('请先选择一个MySQL连接');
      return;
    }
    const dbName = activeDatabase || 'mysql';
    const key = `mysql-slowlog-${activeConnection.id}-${dbName}`;
    const exists = databaseTabs.find(t => t.key === key);
    if (!exists) {
      const newTab: DatabaseTab = {
        key,
        label: 'MySQL 慢日志',
        connection: activeConnection,
        database: dbName,
        type: 'mysql' as DatabaseType
      };
      setDatabaseTabs(prev => [...prev, newTab]);
    }
    setActiveTabKey(key);
  };

  // 全局函数：从服务信息页等位置打开指定Redis数据库的键浏览器标签
  useEffect(() => {
    (window as any).__openRedisDbTab = (dbName: string) => {
      if (!activeConnection) {
        message.warning('请先选择一个Redis连接');
        return;
      }
      const tabKey = `db-${activeConnection.id}-${dbName}`;
      const exists = databaseTabs.find(t => t.key === tabKey);
      if (!exists) {
        const newTab: DatabaseTab = {
          key: tabKey,
          label: `${activeConnection.name} - ${dbName}`,
          connection: activeConnection,
          database: dbName,
          type: 'redis' as DatabaseType
        };
        setDatabaseTabs(prev => [...prev, newTab]);
      }
      setActiveTabKey(tabKey);
    };
    (window as any).__locateRedisDbInSidebar = (dbName: string) => {
      if (!activeConnection) {
        message.warning('请先选择一个Redis连接');
        return;
      }
      setActiveDatabase(dbName);
      message.success(`定位到侧边栏数据库: ${dbName}`);
    };
    (window as any).__exportCmdStatsCsv = (rows: any[]) => {
      try {
        const header = ['cmd','calls','usec','usecPerCall','windowCalls','windowUsecPerCall','windowRate'];
        const lines = [header.join(',')].concat((rows||[]).map(r => header.map(h => r[h] ?? '').join(',')));
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `redis-command-stats-${Date.now()}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        console.error('导出CSV失败', e);
        message.error('导出失败');
      }
    };
    return () => { 
      try { delete (window as any).__openRedisDbTab; } catch {}
      try { delete (window as any).__locateRedisDbInSidebar; } catch {}
      try { delete (window as any).__exportCmdStatsCsv; } catch {}
    };
  }, [activeConnection, databaseTabs]);

  // 渲染底部状态栏
  const renderStatusBar = () => {
    const connectedCount = connections.filter(c => c.isConnected).length;
    
    return (
      <div className={`status-bar ${darkMode ? 'dark' : ''}`}>
        <div className="status-item">
          <span className="status-label">已连接: </span>
          <span className="status-value">{connectedCount}/{connections.length}</span>
        </div>
        <div className="status-item">
          <span className="status-label">活动连接: </span>
          <span className="status-value">{activeConnection?.name || '-'}</span>
        </div>
        <div className="status-item">
          <span className="status-label">数据库: </span>
          <span className="status-value">{activeDatabase || '-'}</span>
        </div>
        <div className="status-item">
          <span className="status-label">表: </span>
          <span className="status-value">{activeTable || '-'}</span>
        </div>
        <div style={{ flex: 1 }}></div>
        <div className="status-item">
          <span className="status-value">DB-CLIENT v1.0</span>
        </div>
      </div>
    );
  };

  return (
    <Layout className={`app-layout ${darkMode ? 'dark' : 'light'}`} style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 顶部菜单栏 */}
      <Header className={`app-header ${darkMode ? 'dark' : ''}`}>
        <div className="header-content">
          <div className="header-left">
            <DatabaseOutlined style={{ fontSize: 20, color: '#1890ff', marginRight: 10 }} />
            <span className="app-title">DB-CLIENT</span>
          </div>
          <div className="header-center">
            {renderFileMenu()}
          </div>
          <div className="header-right">
            <Tooltip title="用户信息">
              <Dropdown menu={{
                items: [
                  { key: 'profile', label: '个人资料' },
                  { key: 'settings', label: '设置' },
                  { key: 'logout', label: '退出' }
                ]
              }}>
                <UserOutlined style={{ fontSize: 20, cursor: 'pointer' }} />
              </Dropdown>
            </Tooltip>
          </div>
        </div>
      </Header>
      
      {/* 主工具栏 */}
      <div className="app-toolbar-container">
        {renderToolbar()}
      </div>
      
      {/* 主内容区域 */}
      <Layout className="app-main-layout" style={{ flex: 1, display: 'flex' }}>
        <Sider 
          width={sidebarCollapsed ? 64 : 280} 
          theme={darkMode ? "dark" : "light"} 
          className="connection-sider"
          collapsed={sidebarCollapsed}
          collapsedWidth={64}
        >
          <ConnectionPanel
            ref={connectionPanelRef}
            connections={connections}
            onConnectionCreate={handleConnectionCreate}
            onConnectionSelect={handleConnectionSelect}
            onConnectionEdit={handleConnectionEdit}
            onConnectionDelete={handleConnectionDelete}
            onConnectionDisconnect={handleConnectionDisconnect}
            activeConnection={activeConnection}
            darkMode={darkMode}
          />
        </Sider>
        
        {!sidebarCollapsed && showDatabasePanel && (
          <Sider 
            width={260} 
            theme={darkMode ? "dark" : "light"} 
            className="database-sider"
            key={activeConnection ? `database-sider-${activeConnection.id}` : 'database-sider-empty'}
          >
            <DatabasePanel
              connection={activeConnection}
              onDatabaseSelect={handleDatabaseSelect}
              onTableSelect={handleTableSelect}
              activeDatabase={activeDatabase}
              activeTable={activeTable}
              darkMode={darkMode}
              onDataLoaded={() => {
                console.log('数据库结构已加载完成，准备自动选择第一个数据库');
                // 无需额外操作，DatabasePanel内部已经处理了自动选择第一个数据库
              }}
              onNewQuery={handleNewQuery}
              key={activeConnection ? `database-panel-${activeConnection.id}-${activeConnection.isConnected ? 'connected' : 'disconnected'}` : 'database-panel-empty'}
            />
          </Sider>
        )}
        
        <Content className={`main-content ${darkMode ? 'dark' : ''}`} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
          {(databaseTabs.length > 0 || queryTabs.length > 0) ? (
            <Tabs
              activeKey={activeTabKey}
              onChange={(key: string) => handleTabChange(key)}
              onEdit={(e: string | React.MouseEvent | React.KeyboardEvent, action: 'add' | 'remove') => {
                if (action === 'remove') handleTabClose(typeof e === 'string' ? e : '');
              }}
              type="editable-card"
              className="database-tabs navicat-tabs"
              style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
            >
              {databaseTabs.map(tab => (
                <TabPane 
                  key={tab.key} 
                  tab={<span><Badge status={tab.connection.isConnected ? 'success' : 'error'} offset={[-1, 8]} style={{ zIndex: 1 }} /><span>{tab.label}</span></span>}
                  closable={true}
                >
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {/* 根据数据库类型渲染不同的面板组件 */}
                    {tab.type === 'mysql' ? (
                      tab.key?.startsWith('mysql-service-info-') ? (
                        <MySqlServiceInfoPage
                          connection={connections.find(c => c.id === tab.connection.id) || tab.connection}
                          database={tab.database}
                          darkMode={darkMode}
                        />
                      ) : tab.key?.startsWith('mysql-users-') ? (
                        <MySqlUsersPage
                          connection={connections.find(c => c.id === tab.connection.id) || tab.connection}
                          database={tab.database}
                          darkMode={darkMode}
                        />
                      ) : tab.key?.startsWith('mysql-cli-') ? (
                        <MySqlCliPage
                          connection={connections.find(c => c.id === tab.connection.id) || tab.connection}
                          database={tab.database}
                          darkMode={darkMode}
                          onDatabaseChange={(newDatabase) => {
                            // 更新标签页的数据库信息
                            setDatabaseTabs(prev => prev.map(t => 
                              t.key === tab.key ? { ...t, database: newDatabase } : t
                            ));
                            // 更新全局活动数据库状态
                            if (tab.connection.id === activeConnection?.id) {
                              setActiveDatabase(newDatabase);
                            }
                          }}
                        />
                      ) : tab.key?.startsWith('mysql-slowlog-') ? (
                        <MySqlSlowlogPage
                          connection={connections.find(c => c.id === tab.connection.id) || tab.connection}
                          database={tab.database}
                          darkMode={darkMode}
                        />
                      ) : (
                      <MySqlDatabaseTabPanel
                        connection={tab.connection}
                        database={tab.database}
                        type={tab.type}
                        darkMode={darkMode}
                        onTableSelect={handleTableSelect}
                        onTableDesign={handleTableDesign}
                      />
                      )
                    ) : tab.type === 'postgresql' || tab.type === 'gaussdb' ? (
                      <PostgreSqlDatabaseTabPanel
                        connection={tab.connection}
                        database={tab.database}
                        type={tab.type}
                        darkMode={darkMode}
                        onTableSelect={handleTableSelect}
                        onTableDesign={handleTableDesign}
                      />
                    ) : tab.type === 'redis' ? (
                      tab.key?.startsWith('redis-service-info-') ? (
                        <RedisServiceInfoPage
                          connection={tab.connection}
                          database={tab.database}
                          darkMode={darkMode}
                        />
                      ) : tab.key?.startsWith('redis-slowlog-') ? (
                        <RedisSlowlogPage
                          connection={tab.connection}
                          database={tab.database}
                          darkMode={darkMode}
                        />
                      ) : tab.key?.startsWith('redis-cli-') ? (
                        <RedisCliPage
                          connection={tab.connection}
                          database={tab.database}
                          darkMode={darkMode}
                        />
                      ) : tab.key?.startsWith('redis-pubsub-') ? (
                        <RedisPubSubPage
                          connection={tab.connection}
                          database={tab.database}
                          darkMode={darkMode}
                        />
                      ) : (
                        <RedisDataBrowser
                          connection={tab.connection}
                          database={tab.database}
                          darkMode={darkMode}
                        />
                      )
                    ) : (
                      <DatabaseTabPanel
                        connection={tab.connection}
                        database={tab.database}
                        type={tab.type}
                        darkMode={darkMode}
                        onTableSelect={handleTableSelect}
                        onTableDesign={handleTableDesign}
                      />
                    )}
                  </div>
                </TabPane>
              ))}
              
              {queryTabs.map(tab => {
                const tabConnection = tab.connection || activeConnection;
                return (
                <TabPane 
                  key={tab.key} 
                  tab={<span><DatabaseOutlined style={{marginRight: 4}} />{tab.label}</span>}
                  closable={true}
                >
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <QueryPanel
                      connection={tabConnection}
                      database={tab.database || activeDatabase}
                      darkMode={darkMode}
                    />
                  </div>
                </TabPane>
                );
              })}
              
              {tableDataTabs.map(tab => (
                <TabPane 
                  key={tab.key} 
                  tab={<span><TableOutlined style={{marginRight: 4}} />{tab.label}</span>}
                  closable={true}
                >
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {/* 根据数据库类型渲染不同的数据面板组件 */}
                    {tab.type === 'mysql' ? (
                      <MySqlDataPanel
                        connection={tab.connection}
                        database={tab.database}
                        tableName={tab.tableName}
                        darkMode={darkMode}
                      />
                    ) : tab.type === 'postgresql' || tab.type === 'gaussdb' ? (
                      <PostgreSqlDataPanel
                        connection={tab.connection}
                        database={tab.database}
                        tableName={tab.tableName}
                        darkMode={darkMode}
                      />
                    ) : (
                      <TableDataPanel
                        connection={tab.connection}
                        database={tab.database}
                        tableName={tab.tableName}
                        darkMode={darkMode}
                      />
                    )}
                  </div>
                </TabPane>
              ))}
              
              {tableDesignTabs.map(tab => (
                <TabPane 
                  key={tab.key} 
                  tab={<span><DatabaseOutlined style={{marginRight: 4}} />{tab.label}</span>}
                  closable={true}
                >
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <TableStructurePanel
                      connection={tab.connection}
                      database={tab.database}
                      table={tab.tableName}
                    />
                  </div>
                </TabPane>
              ))}
          </Tabs>
          ) : (
            <div className="welcome-panel">
              <div className="welcome-content">
                <DatabaseOutlined style={{ fontSize: 64, color: '#1890ff', marginBottom: 20 }} />
                <h1>欢迎使用DB-CLIENT</h1>
                <p>请从左侧面板创建或选择一个数据库连接</p>
                <div className="welcome-features">
                  <div className="feature-item">
                    <span className="feature-icon">🔗</span>
                    <span>支持多种数据库类型</span>
                  </div>
                  <div className="feature-item">
                    <span className="feature-icon">⚡</span>
                    <span>高效的连接池管理</span>
                  </div>
                  <div className="feature-item">
                    <span className="feature-icon">📊</span>
                    <span>直观的数据展示</span>
                  </div>
                </div>
                <div style={{ marginTop: 30 }}>
                  <Button 
                    type="primary" 
                    size="large"
                    icon={<PlusOutlined />}
                    onClick={createNewConnection}
                  >
                    新建连接
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Content>
      </Layout>
      

    </Layout>
  );
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
};

export default App;