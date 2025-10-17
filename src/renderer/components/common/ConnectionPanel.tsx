import React, { useState, useContext } from 'react';
import { Button, List, Modal, Form, Input, Select, Switch, message, Tooltip, Dropdown, Empty, Row, Col, Card } from 'antd';
import { PlusOutlined, DatabaseOutlined, DatabaseFilled, CheckCircleOutlined, CloseCircleOutlined, EditOutlined, DeleteOutlined, CopyOutlined, MoreOutlined, RestOutlined, ArrowRightOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { DatabaseConnection, DatabaseType } from '../../types';
import { useTheme } from './ThemeContext';
import ConnectionPanelFactory, { getAllDatabaseTypes } from '../connection/ConnectionPanelFactory';
import './ConnectionPanel.css';

const { Option } = Select;

interface ConnectionPanelProps {
  connections: DatabaseConnection[];
  onConnectionCreate: (connection: DatabaseConnection) => void;
  onConnectionSelect: (connection: DatabaseConnection) => void;
  onConnectionEdit: (connection: DatabaseConnection) => void;
  onConnectionDelete: (connectionId: string) => void;
  activeConnection: DatabaseConnection | null;
  darkMode: boolean;
}

const ConnectionPanel: React.FC<ConnectionPanelProps> = ({
  connections,
  onConnectionCreate,
  onConnectionSelect,
  onConnectionEdit,
  onConnectionDelete,
  activeConnection,
  darkMode
}) => {
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(1); // 1: 选择数据库类型, 2: 输入连接信息
  const [form] = Form.useForm();
  const [selectedDbType, setSelectedDbType] = useState<DatabaseType | undefined>(undefined);
  const [urlUpdateLock, setUrlUpdateLock] = useState(false); // 用于防止URL与表单字段更新循环
  const [editingConnection, setEditingConnection] = useState<DatabaseConnection | null>(null); // 存储当前正在编辑的连接

  // 解析连接URL
  const parseConnectionUrl = (url: string) => {
    if (!url || urlUpdateLock) return;

    try {
      const databaseType = selectedDbType || form.getFieldValue('type');
      
      // 更新表单字段，但不触发URL更新
      setUrlUpdateLock(true);
      
      // 根据不同数据库类型选择合适的解析器
      switch (databaseType) {
        case 'sqlite':
          // 处理SQLite特殊情况
          if (url.startsWith('sqlite://')) {
            const filePath = url.replace(/^sqlite:\/\//, '');
            form.setFieldsValue({
              host: filePath,
              port: 0,
              username: '',
              password: '',
              database: ''
            });
          }
          break;
          
        case 'oracle':
          // 处理Oracle连接字符串
          if (url.includes('@')) {
            const [credentials, rest] = url.split('@');
            let username = '';
            let password = '';
            
            if (credentials.includes(':')) {
              [username, password] = credentials.split(':');
              // 去掉可能的oracle://前缀
              username = username.replace(/^oracle:\/\//, '');
            }
            
            let host = '';
            let port = '';
            let sidOrService = '';
            
            // Oracle格式: host:port:SID 或 host:port/service
            if (rest.includes(':')) {
              const parts = rest.split(':');
              host = parts[0];
              if (parts.length > 1) port = parts[1];
              if (parts.length > 2) sidOrService = parts[2];
            }
            
            form.setFieldsValue({
              host,
              port: port ? parseInt(port, 10) : 1521,
              username,
              password,
              database: sidOrService
            });
          }
          break;
          
        case 'redis':
          // 处理Redis连接字符串
          const redisUrl = url.replace(/^redis:\/\//, '');
          let username = '';
          let password = '';
          let hostPortDb = redisUrl;
          
          if (redisUrl.includes('@')) {
            const [auth, rest] = redisUrl.split('@');
            if (auth.startsWith(':')) {
              password = auth.substring(1);
            } else if (auth.includes(':')) {
              [username, password] = auth.split(':');
            }
            hostPortDb = rest;
          }
          
          let host = 'localhost';
          let port = '6379';
          let database = '0';
          
          if (hostPortDb.includes('/')) {
            [hostPortDb, database] = hostPortDb.split('/');
          }
          
          if (hostPortDb.includes(':')) {
            [host, port] = hostPortDb.split(':');
          } else {
            host = hostPortDb;
          }
          
          form.setFieldsValue({
            host,
            port: parseInt(port, 10),
            username,
            password,
            database
          });
          break;
          
        default: // mysql, postgresql, gaussdb
          // 处理标准URL格式
          const protocolEndIndex = url.indexOf('://');
          if (protocolEndIndex !== -1) {
            let rest = url.substring(protocolEndIndex + 3);

            // 提取认证信息
            let username = '';
            let password = '';
            let host = '';
            let port = '';
            let database = '';

            const atIndex = rest.indexOf('@');
            if (atIndex !== -1) {
              const auth = rest.substring(0, atIndex);
              const colonIndex = auth.indexOf(':');
              if (colonIndex !== -1) {
                username = auth.substring(0, colonIndex);
                password = auth.substring(colonIndex + 1);
              } else {
                username = auth;
              }
              rest = rest.substring(atIndex + 1);
            }

            // 提取主机和端口
            const slashIndex = rest.indexOf('/');
            let hostPortPart = rest;
            if (slashIndex !== -1) {
              hostPortPart = rest.substring(0, slashIndex);
              // 提取数据库名称，忽略查询参数
              const questionMarkIndex = rest.indexOf('?');
              if (questionMarkIndex !== -1) {
                database = rest.substring(slashIndex + 1, questionMarkIndex);
              } else {
                database = rest.substring(slashIndex + 1);
              }
            }

            // 处理IPv6地址和标准主机:端口格式
            if (hostPortPart.startsWith('[') && hostPortPart.includes(']:')) {
              // IPv6格式 [host]:port
              const closeBracketIndex = hostPortPart.indexOf(']:');
              host = hostPortPart.substring(1, closeBracketIndex);
              port = hostPortPart.substring(closeBracketIndex + 2);
            } else {
              const colonIndex = hostPortPart.lastIndexOf(':');
              if (colonIndex !== -1 && !hostPortPart.includes('[')) {
                host = hostPortPart.substring(0, colonIndex);
                port = hostPortPart.substring(colonIndex + 1);
              } else {
                host = hostPortPart;
              }
            }

            // 根据数据库类型设置默认端口
            const defaultPorts: Record<string, number> = {
              mysql: 3306,
              postgresql: 5432,
              gaussdb: 5432
            };

            form.setFieldsValue({
              host,
              port: port ? parseInt(port, 10) : defaultPorts[databaseType] || 3306,
              username,
              password,
              database
            });
          }
          break;
      }
      
      // 短暂延迟后解锁，防止UI更新闪烁
      setTimeout(() => {
        setUrlUpdateLock(false);
      }, 100);
      
    } catch (error) {
      console.error('解析连接URL失败:', error);
      message.error('解析连接URL失败，请检查格式是否正确');
      
      // 确保锁被释放
      setTimeout(() => {
        setUrlUpdateLock(false);
      }, 100);
    }
  };

  // 不再需要全局的updateConnectionUrl函数，每个数据库连接面板组件负责自己的URL构建

  // 数据库类型图标映射
  const databaseTypeIcons: Record<DatabaseType, React.ReactNode> = {
    mysql: <DatabaseFilled className="db-icon mysql" />,
    oracle: <DatabaseFilled className="db-icon oracle" />,
    postgresql: <DatabaseFilled className="db-icon postgresql" />,
    gaussdb: <DatabaseFilled className="db-icon gaussdb" />,
    redis: <DatabaseFilled className="db-icon redis" />,
    sqlite: <DatabaseFilled className="db-icon sqlite" />
  };

  // 计算连接分组统计
  const connectionStats = {
    total: connections.length,
    connected: connections.filter(conn => conn.isConnected).length,
    disconnected: connections.filter(conn => !conn.isConnected).length
  };

  // 使用工厂组件提供的数据库类型配置
  const databaseTypes = getAllDatabaseTypes();

  const handleCreateConnection = () => {
    setIsModalVisible(true);
  };

  // 处理连接刷新
  const handleRefreshConnection = async (connection: DatabaseConnection) => {
    message.loading({ content: '正在刷新连接...', key: 'refreshConnection', duration: 0 });
    
    if (window.electronAPI) {
      try {
        const testResult = await (window.electronAPI as any)?.testConnection?.(connection) || { success: false, error: '连接测试失败' };
        message.destroy('refreshConnection');
        
        if (testResult.success) {
          message.success('连接已刷新');
          // 更新连接状态为已连接
          const updatedConnection = { ...connection, isConnected: true };
          // 调用onConnectionSelect重新选择连接，这会触发数据库列表的刷新
          onConnectionSelect(updatedConnection);
        } else {
          message.error(`刷新失败: ${testResult.error}`);
        }
      } catch (error) {
        message.destroy('refreshConnection');
        message.error('刷新连接失败');
      }
    }
  };

  // 处理连接编辑
  const handleEditConnection = (connection: DatabaseConnection) => {
    setEditingConnection(connection);
    form.setFieldsValue({
      name: connection.name,
      type: connection.type,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      password: connection.password,
      database: connection.database,
      ssl: connection.ssl || false,
      timeout: connection.timeout || 30
    });
    setCurrentStep(2); // 直接进入第二步
    setSelectedDbType(connection.type);
    setIsModalVisible(true);
  };

  // 处理连接删除
  const handleDeleteConnection = (connectionId: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除此连接吗？',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        onConnectionDelete(connectionId);
        message.success('连接已删除');
      }
    });
  };

  // 连接项的上下文菜单
  const getConnectionMenu = (connection: DatabaseConnection) => ({
    items: [
      {
        key: 'select',
        label: '选择连接',
        icon: <CheckCircleOutlined />,
        onClick: () => onConnectionSelect(connection)
      },
      {
        key: 'refresh',
        label: '刷新连接',
        icon: <RestOutlined />,
        onClick: () => handleRefreshConnection(connection)
      },
      {
        key: 'edit',
        label: '编辑连接',
        icon: <EditOutlined />,
        onClick: () => handleEditConnection(connection)
      },
      {
        key: 'copy',
        label: '复制连接',
        icon: <CopyOutlined />,
        onClick: () => {
          const newConnection: DatabaseConnection = {
            ...connection,
            id: Date.now().toString(),
            name: `${connection.name} (副本)`,
            isConnected: false
          };
          onConnectionCreate(newConnection);
          message.success('连接已复制');
        }
      },
      {
        key: 'delete',
        label: '删除连接',
        icon: <DeleteOutlined />,
        danger: true,
        onClick: () => handleDeleteConnection(connection.id)
      }
    ]
  });

  // 保存连接（不进行连接测试验证）
  const handleModalOk = async () => {
    try {
      const values = form.getFieldsValue();
      const { type, name, host, port, username, password, database, ssl, timeout, connectionUrl } = values;

      // 验证必填字段
      if (!type || !name || !host) {
        message.error('请填写必要的连接信息');
        return;
      }

      // 根据数据库类型进行特殊验证
      switch (type) {
        case 'mysql':
        case 'postgresql':
        case 'gaussdb':
        case 'oracle':
          if (!username) {
            message.error('请输入用户名');
            return;
          }
          if (!port) {
            message.error('请输入端口号');
            return;
          }
          break;
        case 'sqlite':
          // SQLite只需要文件路径
          if (!host.trim()) {
            message.error('请选择SQLite数据库文件');
            return;
          }
          break;
        case 'redis':
          // Redis低版本不需要用户名，但需要端口
          if (!port) {
            message.error('请输入端口号');
            return;
          }
          break;
      }
      
      let connectionToSave: DatabaseConnection;
      
      if (editingConnection) {
        // 编辑现有连接
        connectionToSave = {
          ...editingConnection,
          name: values.name,
          type: values.type,
          host: values.host,
          port: type === 'sqlite' ? 0 : values.port,
          username: values.username || '',
          password: values.password || '',
          database: values.database || '',
          ssl: values.ssl || false,
          timeout: values.timeout || 30,
          // 注意：DatabaseConnection类型中没有connectionUrl属性，可能需要更新类型定义
        };
        
        onConnectionEdit(connectionToSave);
      } else {
        // 创建新连接
        connectionToSave = {
          id: Date.now().toString(),
          name: values.name,
          type: values.type,
          host: values.host,
          port: type === 'sqlite' ? 0 : values.port,
          username: values.username || '',
          password: values.password || '',
          database: values.database || '',
          ssl: values.ssl || false,
          timeout: values.timeout || 30,
          // 注意：DatabaseConnection类型中没有connectionUrl属性，可能需要更新类型定义,
          isConnected: false
        };
        
        onConnectionCreate(connectionToSave);
      }
      
      // 重置表单和状态
      setIsModalVisible(false);
      form.resetFields();
      setCurrentStep(1);
      setEditingConnection(null);
    } catch (error) {
      console.error('保存连接失败:', error);
      message.error('保存连接时发生错误');
    }
  };

  // 测试连接功能 - 测试完成后关闭连接池
  const handleTestConnection = async () => {
    try {
      const values = form.getFieldsValue();
      const { type, name, host, port, username, password, database, ssl, timeout } = values;

      // 验证必填字段
      if (!type || !name || !host) {
        message.error('请填写必要的连接信息');
        return;
      }

      // 针对不同数据库类型的特殊验证
      if (type !== 'sqlite' && !port) {
        message.error('请输入端口号');
        return;
      }

      // 根据数据库类型进行特殊验证
      switch (type) {
        case 'mysql':
        case 'postgresql':
        case 'gaussdb':
        case 'oracle':
          if (!username) {
            message.error('请输入用户名');
            return;
          }
          break;
        case 'sqlite':
          // SQLite不需要端口和用户名密码
          break;
        case 'redis':
          // Redis低版本不需要用户名，但我们仍然接受空用户名
          break;
      }

      const connection: DatabaseConnection = {
        id: 'test',
        name: name || '测试连接',
        type,
        host,
        port: type === 'sqlite' ? 0 : port,
        username: username || '',
        password: password || '',
        database: database || '',
        ssl: ssl || false,
        timeout: timeout || 30,
        isConnected: false
      };

      message.loading({ content: '正在测试连接...', key: 'testConnection', duration: 0 });
      
      if (window.electronAPI) {
        try {
          // 测试连接
          const testResult = await (window.electronAPI as any)?.testConnection?.(connection) || { success: false, error: '连接测试失败' };
          message.destroy('testConnection');
          
          if (testResult.success) {
            message.success('连接测试成功');
            // 测试成功时保留连接池，不关闭
            console.log('连接测试成功，保留连接池以便后续使用');
          } else {
            // 针对Redis类型，当填写了用户名且连接失败时显示特定提示
            if (connection.type === 'redis' && connection.username && testResult.error?.includes('WRONGPASS')) {
              message.error(`连接测试失败: ${testResult.error}\n提示：Redis低版本默认不需要用户名，请尝试清空用户名后重试`);
            } else {
              message.error(`连接测试失败: ${testResult.error}`);
            }
            
            // 测试失败时关闭连接池
            try {
              await (window.electronAPI as any)?.closeTestConnection?.(connection);
              console.log('测试失败，已关闭连接池');
            } catch (closeError) {
              console.debug('关闭测试连接池失败:', closeError);
              // 静默忽略关闭错误，不影响用户体验
            }
          }
        } catch (error) {
          // 出现异常时也尝试关闭连接池
          try {
            await (window.electronAPI as any)?.closeTestConnection?.(connection);
          } catch (closeError) {
            console.debug('关闭测试连接池失败:', closeError);
          }
          throw error;
        }
      } else {
        // 开发环境模拟连接成功
        message.destroy('testConnection');
        message.success('连接测试成功（模拟）');
      }
    } catch (error) {
      console.error('测试连接失败:', error);
      message.destroy('testConnection');
      message.error('测试连接时发生错误');
    }
  };

  // 处理数据库类型选择和下一步
  const handleNextStep = () => {
    try {
      if (currentStep === 1) {
        const values = form.getFieldsValue();
        if (!values.type) {
          message.error('请选择数据库类型');
          return;
        }
        
        // 确保selectedDbType正确设置
        setSelectedDbType(values.type);
        
        // 根据选择的数据库类型设置更多默认值
        const dbType = databaseTypes.find(type => type.value === values.type);
        form.setFieldsValue({
          type: values.type,
          name: '',
          host: values.type === 'sqlite' ? '' : 'localhost',
          port: dbType?.defaultPort || 3306,
          username: '',
          password: '',
          database: '',
          ssl: false,
          timeout: 30
        });
        
        setCurrentStep(2);
      }
    } catch (error) {
      console.error('进入下一步失败:', error);
    }
  };
  
  // 处理模态框取消或关闭
  const handleModalCancel = () => {
    setIsModalVisible(false);
    form.resetFields();
    setCurrentStep(1);
    setEditingConnection(null);
  };

  // 第二步：返回上一步
  const handlePrevStep = () => {
    if (currentStep === 2) {
      setCurrentStep(1);
      // 保留选中的数据库类型，但清空其他表单值
      const typeValue = form.getFieldValue('type');
      form.resetFields();
      if (typeValue) {
        form.setFieldsValue({ type: typeValue });
        setSelectedDbType(typeValue);
      }
    }
  };

  const handleDatabaseTypeChange = (value: DatabaseType) => {
    const dbType = databaseTypes.find(type => type.value === value);
    if (dbType && dbType.defaultPort > 0) {
      form.setFieldsValue({ port: dbType.defaultPort });
    }
  };

  // 获取数据库类型图标和名称
  const getDatabaseInfo = (type: DatabaseType) => {
    const typeInfo = databaseTypes.find(t => t.value === type);
    return {
      icon: databaseTypeIcons[type],
      label: typeInfo?.label || type
    };
  };

  // 获取连接状态图标
  const getConnectionStatusIcon = (isConnected: boolean) => {
    return isConnected ? (
      <Tooltip title="已连接">
        <CheckCircleOutlined className="connection-status-icon connected" />
      </Tooltip>
    ) : (
      <Tooltip title="未连接">
        <CloseCircleOutlined className="connection-status-icon disconnected" />
      </Tooltip>
    );
  };

  return (
    <div className={`connection-panel ${darkMode ? 'dark' : ''}`}>
      <div className="connection-header">
        <Button 
          type="primary" 
          icon={<PlusOutlined />} 
          onClick={handleCreateConnection} 
          style={{ width: '100%' }} 
          size="small"
        >
          新建连接
        </Button>
      </div>
      <div className="connection-list">
        {connections.length > 0 ? (
          <List
            dataSource={connections}
            renderItem={(connection) => {
              const { icon, label } = getDatabaseInfo(connection.type);
              
              return (
                <Dropdown menu={getConnectionMenu(connection)} trigger={['contextMenu']}>
                  <List.Item
                    className={`connection-item ${activeConnection?.id === connection.id ? 'active' : ''} ${darkMode ? 'dark' : ''}`}
                    onClick={() => onConnectionSelect(connection)}
                  >
                    <div style={{ width: '100%', display: 'flex', alignItems: 'center' }}>
                      <span className="connection-name text-ellipsis">
                        {connection.name}
                      </span>
                      {connection.isConnected && (
                        <Tooltip title="已连接">
                          <span className="connection-success-indicator"></span>
                        </Tooltip>
                      )}
                    </div>
                  </List.Item>
                </Dropdown>
              );
            }}
          />
        ) : (
          <Empty
            className="empty-connections"
            description="暂无连接"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
      </div>

      <Modal
        title={
          editingConnection ? 
          '编辑连接' : 
          (currentStep === 1 ? '选择数据库类型' : '新建数据库连接')
        }
        open={isModalVisible}
        onOk={currentStep === 1 ? handleNextStep : handleModalOk}
        onCancel={handleModalCancel}
        width={currentStep === 1 ? 600 : "70%"}
        okText={currentStep === 1 ? "下一步" : "保存"}
        cancelText="取消"
        centered={true}
        bodyStyle={{
          padding: '24px', 
          height: currentStep === 1 ? 'auto' : '80vh', 
          overflow: currentStep === 1 ? 'visible' : 'auto',
          maxHeight: currentStep === 1 ? '70vh' : '80vh'
        }}
        footer={null}
        className={`connection-modal connection-modal-step-${currentStep} ${darkMode ? 'dark' : ''}`}
      >
        <Form
          form={form}
          layout={currentStep === 1 ? "vertical" : "horizontal"}
          className="connection-form"
          initialValues={{
            port: 3306,
            ssl: false,
            timeout: 30
          }}
          labelCol={currentStep === 1 ? undefined : { span: 6 }}
          wrapperCol={currentStep === 1 ? undefined : { span: 18 }}
        >
          <div>
            {currentStep === 1 ? (
              <>
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <h3 style={{ marginBottom: '30px' }}>请选择数据库类型</h3>
                  <Row gutter={[16, 16]} justify="center">
                    {databaseTypes.map(dbType => (
                      <Col key={dbType.value} xs={24} sm={12} md={8}>
                        <Card 
                          hoverable 
                          onClick={() => {
                            // 清空并重置表单，然后设置类型和默认端口
                            form.resetFields();
                            form.setFieldsValue({
                              type: dbType.value,
                              name: '',
                              host: dbType.value === 'sqlite' ? '' : 'localhost',
                              port: dbType?.defaultPort || 3306,
                              username: '',
                              password: '',
                              database: '',
                              ssl: false,
                              timeout: 30
                            });
                            setSelectedDbType(dbType.value);
                          }} 
                          className={`db-type-card ${selectedDbType === dbType.value ? 'selected' : ''} ${darkMode ? 'dark' : ''}`}
                          style={{
                            cursor: 'pointer',
                            minHeight: '100px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                        >
                          <div style={{ textAlign: 'center', height: '80px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                              {databaseTypeIcons[dbType.value]}
                              <div style={{ marginTop: '10px', fontSize: '16px' }}>{dbType.label}</div>
                              {dbType.defaultPort > 0 ? (
                                <div style={{ marginTop: '5px', fontSize: '12px', color: '#8c8c8c' }}>
                                  默认端口: {dbType.defaultPort}
                                </div>
                              ) : (
                                <div style={{ marginTop: '5px', fontSize: '12px', color: '#8c8c8c' }}>
                                  (无端口配置)
                                </div>
                              )}
                            </div>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                  <Form.Item
                    name="type"
                    hidden={true}
                    rules={[{ required: true, message: '请选择数据库类型' }]}
                  >
                    <Input />
                  </Form.Item>
                </div>
                
                <div className="modal-footer" style={{ marginTop: '32px', textAlign: 'center' }}>
                  <Button onClick={handleModalCancel}>
                    取消
                  </Button>
                  <Button type="primary" disabled={!selectedDbType} onClick={handleNextStep}>
                    下一步
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* 使用连接面板工厂根据数据库类型显示不同的连接表单 */}
                <ConnectionPanelFactory
                  form={form}
                  databaseType={selectedDbType || (form.getFieldValue('type') as DatabaseType)}
                  connection={editingConnection}
                  darkMode={darkMode}
                  onUrlChange={(url) => form.setFieldsValue({ connectionUrl: url })}
                  initialValues={editingConnection ? {
                    ...editingConnection,
                    // 确保表单字段映射正确
                    host: editingConnection.host,
                    port: editingConnection.port,
                    username: editingConnection.username,
                    password: editingConnection.password,
                    database: editingConnection.database,
                    ssl: editingConnection.ssl || false,
                    timeout: editingConnection.timeout || 30
                  } : undefined}
                />
                  
                {/* URL输入框，保持在所有表单类型中统一显示 */}
                <div className="form-section" style={{ marginTop: '24px' }}>
                  <div className="form-section-title">连接URL</div>
                  <Row gutter={[16, 16]}>
                    <Col span={24}>
                      <Form.Item
                        label="URL"
                        name="connectionUrl"
                        labelCol={{ span: 3 }}
                        wrapperCol={{ span: 21 }}
                        tooltip="粘贴连接URL可自动填充其他字段"
                      >
                        <Input 
                          placeholder={`${selectedDbType === 'mysql' ? 'mysql://' : 
                                    selectedDbType === 'postgresql' ? 'postgresql://' : 
                                    selectedDbType === 'oracle' ? 'oracle://' : 
                                    selectedDbType === 'gaussdb' ? 'gaussdb://' : 
                                    selectedDbType === 'redis' ? 'redis://' : 
                                    'sqlite://'}用户名:密码@主机:端口/数据库`} 
                          onChange={(e) => parseConnectionUrl(e.target.value)}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>
                  
                {/* 高级设置部分，在所有数据库类型中统一显示 */}
                <div className="form-section">
                  <div className="form-section-title">高级设置</div>
                  <Row gutter={[16, 16]}>
                    <Col span={12}>
                      <Form.Item 
                        label="SSL连接" 
                        name="ssl" 
                        valuePropName="checked"
                        initialValue={false}
                        labelCol={{ span: 6 }}
                        wrapperCol={{ span: 18 }}
                      >
                        <Switch />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item 
                        label="连接超时(秒)" 
                        name="timeout"
                        initialValue={30}
                        labelCol={{ span: 6 }}
                        wrapperCol={{ span: 18 }}
                      >
                        <Input type="number" min="1" max="300" />
                      </Form.Item>
                    </Col>
                  </Row>
                </div>
                
                {/* 第二步的页脚按钮 */}
                <div className="modal-footer" style={{ marginTop: '32px', textAlign: 'center' }}>
                  <Button onClick={handlePrevStep}>
                    返回
                  </Button>
                  <Button type="link" onClick={handleTestConnection}>
                    测试连接
                  </Button>
                  <Button type="primary" onClick={handleModalOk}>
                    {editingConnection ? '更新' : '保存'}
                  </Button>
                </div>
              </>
            )}
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default ConnectionPanel;