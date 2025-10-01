import React, { useState, useEffect } from 'react';
import { Layout, Tabs, message, Button, Tooltip, Dropdown, Badge, Menu } from 'antd';
import { 
  PlusOutlined, DatabaseOutlined, UserOutlined,
  FileTextOutlined, BankOutlined, 
  MoonOutlined, SunOutlined, MenuOutlined, SearchOutlined,
  SaveOutlined, RestOutlined, FilterOutlined, SettingOutlined,
  TableOutlined, ScanOutlined, EyeOutlined, ExportOutlined
} from '@ant-design/icons';
import ConnectionPanel from './components/ConnectionPanel';
import DatabasePanel from './components/DatabasePanel';
import QueryPanel from './components/QueryPanel';
import DataPanel from './components/DataPanel';
import DatabaseTabPanel from './components/DatabaseTabPanel';
import { DatabaseConnection, DatabaseType } from './types';
import { ThemeProvider, useTheme } from './components/ThemeContext';
import './App.css';

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

const AppContent: React.FC = () => {
  // 核心状态管理
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
    
  const [activeConnection, setActiveConnection] = useState<DatabaseConnection | null>(null);
  const [activeDatabase, setActiveDatabase] = useState<string>('');
  const [activeTable, setActiveTable] = useState<string>('');
  
  // 标签页管理
  const [databaseTabs, setDatabaseTabs] = useState<DatabaseTab[]>([]);
  const [queryTabs, setQueryTabs] = useState<QueryTab[]>([]);
  const [activeTabKey, setActiveTabKey] = useState<string>('');
  
  // UI状态
  const { darkMode, toggleDarkMode } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [showDatabasePanel, setShowDatabasePanel] = useState<boolean>(true);
  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);

  // 初始化
  useEffect(() => {
    // 从连接存储服务加载连接列表
    const loadConnections = async () => {
      if (window.electronAPI) {
        try {
          const result = await window.electronAPI.getAllConnections();
          if (result.success) {
            setConnections(result.connections);
            // 如果有连接，设置第一个为活动连接
            if (result.connections.length > 0) {
              setActiveConnection(result.connections[0]);
            }
          } else {
            console.error('加载连接列表失败:', result.message);
            message.error('加载连接列表失败');
          }
        } catch (error) {
          console.error('加载连接列表异常:', error);
          message.error('加载连接列表异常');
        }
      }
    };

    loadConnections();

    // 监听菜单事件
    if (window.electronAPI) {
      window.electronAPI.onMenuNewConnection(() => {
        // 触发新建连接逻辑
        createNewConnection();
      });
    }

    return () => {
      if (window.electronAPI) {
        window.electronAPI.removeAllListeners('menu-new-connection');
      }
    };
  }, []);

  // 连接管理
  const handleConnectionCreate = async (connection: DatabaseConnection) => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.saveConnection(connection);
        if (result.success) {
          setConnections(prev => [...prev, connection]);
          setActiveConnection(connection);
          message.success(result.message || '连接创建成功');
        } else {
          console.error('保存连接失败:', result.message);
          message.error(result.message || '保存连接失败');
        }
      } else {
        // 开发环境下的备选方案
        setConnections(prev => [...prev, connection]);
        setActiveConnection(connection);
        message.success('连接创建成功（模拟）');
      }
    } catch (error) {
      console.error('创建连接异常:', error);
      message.error('创建连接异常');
    }
  };

  const handleConnectionSelect = async (connection: DatabaseConnection) => {
    // 先设置基本连接信息，但保持isConnected为false
    setActiveConnection({ ...connection, isConnected: false });
    
    // 尝试连接到数据库并设置连接状态
    try {
      if (window.electronAPI && connection.id) {
        // 测试连接
        const testResult = await window.electronAPI.testConnection(connection);
        
        if (testResult && testResult.success) {
          // 更新连接的状态为已连接
          const updatedConnection = { ...connection, isConnected: true };
          setActiveConnection(updatedConnection);
          
          // 更新连接列表中的状态
          setConnections(prev => 
            prev.map(conn => conn.id === connection.id ? updatedConnection : conn)
          );
          
          console.log('数据库连接成功，现在将尝试获取真实数据');
          
          // 等待DatabasePanel加载数据后，自动选择第一个数据库并创建标签页
          setTimeout(() => {
            handleDatabaseSelect(activeDatabase || 'information_schema');
          }, 1000);
        } else {
          console.warn('连接测试失败:', testResult?.message);
          
          // 连接失败时，保持未连接状态
          setActiveConnection({ ...connection, isConnected: false });
          
          // 更新连接列表中的状态
          setConnections(prev => 
            prev.map(conn => conn.id === connection.id ? { ...conn, isConnected: false } : conn)
          );
          
          message.error('连接测试失败: ' + (testResult?.message || '未知错误'));
        }
      } else {
        // 开发环境或无法使用electronAPI时，设置为未连接状态
        setActiveConnection({ ...connection, isConnected: false });
        console.log('无法使用electronAPI，设置为未连接状态');
      }
    } catch (error) {
      console.error('连接数据库时出错:', error);
      
      // 出错时，设置为未连接状态
      setActiveConnection({ ...connection, isConnected: false });
      
      // 更新连接列表中的状态
      setConnections(prev => 
        prev.map(conn => conn.id === connection.id ? { ...conn, isConnected: false } : conn)
      );
      
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

  // 创建新连接
  const createNewConnection = () => {
    // 触发ConnectionPanel中的新建连接逻辑
    const connectionPanel = document.querySelector('.connection-panel') as HTMLElement;
    if (connectionPanel) {
      const createButton = connectionPanel.querySelector('button') as HTMLElement;
      if (createButton) {
        createButton.click();
      }
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
    setActiveTable(table);
  };

  // 关闭标签页
  const handleTabClose = (targetKey: string | MouseEvent | KeyboardEvent) => {
    // 确保targetKey是字符串类型
    const key = typeof targetKey === 'string' ? targetKey : '';
    // 查找标签类型
    const isDbTab = databaseTabs.some(t => t.key === targetKey);
    
    if (isDbTab) {
      const newTabs = databaseTabs.filter(tab => tab.key !== targetKey);
      setDatabaseTabs(newTabs);
      
      if (targetKey === activeTabKey) {
        if (newTabs.length > 0) {
          setActiveTabKey(newTabs[newTabs.length - 1].key);
        } else if (queryTabs.length > 0) {
          setActiveTabKey(queryTabs[0].key);
        } else {
          setActiveTabKey('');
          setActiveDatabase('');
        }
      }
    } else {
      const newTabs = queryTabs.filter(tab => tab.key !== targetKey);
      setQueryTabs(newTabs);
      
      if (targetKey === activeTabKey) {
        if (newTabs.length > 0) {
          setActiveTabKey(newTabs[newTabs.length - 1].key);
        } else if (databaseTabs.length > 0) {
          setActiveTabKey(databaseTabs[0].key);
        } else {
          setActiveTabKey('');
        }
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
  };

  // 创建新查询标签页
  const handleNewQuery = () => {
    const tabKey = `query-${Date.now()}`;
    const newTab: QueryTab = {
      key: tabKey,
      label: '查询 ' + (queryTabs.length + 1),
      query: '-- 输入SQL查询语句\n-- 例如: SELECT * FROM table_name LIMIT 100;\n\n',
      connection: activeConnection || undefined,
      database: activeDatabase
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
            onClick={handleNewQuery}
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
            connections={connections}
            onConnectionCreate={handleConnectionCreate}
            onConnectionSelect={handleConnectionSelect}
            onConnectionEdit={handleConnectionEdit}
            onConnectionDelete={handleConnectionDelete}
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
              key={activeConnection ? `database-panel-${activeConnection.id}-${activeConnection.isConnected ? 'connected' : 'disconnected'}` : 'database-panel-empty'}
            />
          </Sider>
        )}
        
        <Content className={`main-content ${darkMode ? 'dark' : ''}`}>
          {(databaseTabs.length > 0 || queryTabs.length > 0) ? (
            <Tabs
              activeKey={activeTabKey}
              onChange={(key: string) => handleTabChange(key)}
              onEdit={(e: string | React.MouseEvent | React.KeyboardEvent, action: 'add' | 'remove') => {
                if (action === 'remove') handleTabClose(typeof e === 'string' ? e : '');
              }}
              type="editable-card"
              className="database-tabs"
            >
              {databaseTabs.map(tab => (
                <TabPane 
                  key={tab.key} 
                  tab={<span><Badge status={tab.connection.isConnected ? 'success' : 'error'} offset={[-1, 8]} style={{ zIndex: 1 }} /><span>{tab.label}</span></span>}
                  closable={true}
                >
                  <DatabaseTabPanel
                    connection={tab.connection}
                    database={tab.database}
                    type={tab.type}
                    darkMode={darkMode}
                  />
                </TabPane>
              ))}
              
              {queryTabs.map(tab => (
                <TabPane 
                  key={tab.key} 
                  tab={<span><DatabaseOutlined style={{marginRight: 4}} />{tab.label}</span>}
                  closable={true}
                >
                  <QueryPanel
                    connection={tab.connection || activeConnection}
                    database={tab.database || activeDatabase}
                    darkMode={darkMode}
                  />
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