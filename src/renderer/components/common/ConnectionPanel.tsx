import React, { useState, useContext } from 'react';
import { Button, List, Modal, Form, Input, Select, Switch, message, Tooltip, Dropdown, Empty, Row, Col, Card } from 'antd';
import { PlusOutlined, DatabaseOutlined, DatabaseFilled, CheckCircleOutlined, CloseCircleOutlined, EditOutlined, DeleteOutlined, CopyOutlined, MoreOutlined, RestOutlined, ArrowRightOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { DatabaseConnection, DatabaseType } from '../../types';
import { useTheme } from './ThemeContext';
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

  // 解析数据库连接URL并填充到表单字段
  const parseConnectionUrl = (url: string) => {
    if (!url || urlUpdateLock) return;
    
    try {
      // 尝试解析不同类型的数据库连接URL
      let protocol = '';
      let host = '';
      let port = '';
      let username = '';
      let password = '';
      let database = '';
      
      // MySQL格式: mysql://username:password@host:port/database
      // PostgreSQL格式: postgresql://username:password@host:port/database
      // Oracle格式: oracle://username:password@host:port/database
      // Redis格式: redis://username:password@host:port/database
      // SQLite格式: sqlite:///path/to/database
      
      const match = url.match(/^(\w+):\/\/(?:([^:]+)(?::([^@]+))?@)?([^:/]+)(?::(\d+))?\/?([^?#]*)/);
      
      if (match) {
        protocol = match[1];
        username = match[2] || '';
        password = match[3] || '';
        host = match[4] || '';
        port = match[5] || '';
        database = match[6] || '';
        
        // 特殊处理SQLite路径
        if (protocol === 'sqlite' && host === '' && port === '' && database) {
          if (database.startsWith('/')) {
            // 绝对路径
            host = database;
          } else {
            // 相对路径
            host = database;
          }
          database = '';
        }
        
        // 更新表单字段，但不触发URL更新
        setUrlUpdateLock(true);
        
        const updates: any = {};
        if (host) updates.host = host;
        if (port) updates.port = parseInt(port);
        if (username) updates.username = username;
        if (password) updates.password = password;
        if (database) updates.database = database;
        
        form.setFieldsValue(updates);
        
        // 短暂延迟后解锁，防止UI更新闪烁
        setTimeout(() => {
          setUrlUpdateLock(false);
        }, 100);
      }
    } catch (error) {
      console.error('解析连接URL失败:', error);
    }
  };

  // 根据表单字段更新连接URL
  const updateConnectionUrl = () => {
    if (urlUpdateLock) return;
    
    try {
      const values = form.getFieldsValue(['host', 'port', 'username', 'password', 'database', 'ssl']);
      
      if (!values.host || !values.port || !values.username) {
        // 必要字段不完整，不生成URL
        form.setFieldsValue({ connectionUrl: '' });
        return;
      }
      
      let url = '';
      const dbType = selectedDbType || form.getFieldValue('type');
      
      switch (dbType) {
        case 'mysql':
          url = `mysql://`;
          break;
        case 'postgresql':
          url = `postgresql://`;
          break;
        case 'oracle':
          url = `oracle://`;
          break;
        case 'gaussdb':
          url = `gaussdb://`;
          break;
        case 'redis':
          url = `redis://`;
          break;
        case 'sqlite':
          url = `sqlite://`;
          break;
        default:
          url = `database://`;
      }
      
      // 添加用户名和密码
      url += values.username;
      if (values.password) {
        url += `:${values.password}`;
      }
      
      // 添加主机和端口
      url += `@${values.host}:${values.port}`;
      
      // 添加数据库
      if (values.database) {
        url += `/${values.database}`;
      }
      
      // 添加SSL参数
      if (values.ssl) {
        url += '?ssl=true';
      }
      
      setUrlUpdateLock(true);
      form.setFieldsValue({ connectionUrl: url });
      
      // 短暂延迟后解锁
      setTimeout(() => {
        setUrlUpdateLock(false);
      }, 100);
    } catch (error) {
      console.error('更新连接URL失败:', error);
    }
  };

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

  const databaseTypes: { value: DatabaseType; label: string; defaultPort: number }[] = [
    { value: 'mysql', label: 'MySQL', defaultPort: 3306 },
    { value: 'oracle', label: 'Oracle', defaultPort: 1521 },
    { value: 'postgresql', label: 'PostgreSQL', defaultPort: 5432 },
    { value: 'gaussdb', label: 'GaussDB', defaultPort: 5432 },
    { value: 'redis', label: 'Redis', defaultPort: 6379 },
    { value: 'sqlite', label: 'SQLite', defaultPort: 0 }
  ];

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
      const values = await form.validateFields();
      
      let connectionToSave: DatabaseConnection;
      
      if (editingConnection) {
        // 编辑现有连接
        connectionToSave = {
          ...editingConnection,
          name: values.name,
          type: values.type,
          host: values.host,
          port: values.port,
          username: values.username,
          password: values.password,
          database: values.database,
          ssl: values.ssl || false,
          timeout: values.timeout || 30
        };
        
        onConnectionEdit(connectionToSave);
      } else {
        // 创建新连接
        connectionToSave = {
          id: Date.now().toString(),
          name: values.name,
          type: values.type,
          host: values.host,
          port: values.port,
          username: values.username,
          password: values.password,
          database: values.database,
          ssl: values.ssl || false,
          timeout: values.timeout || 30,
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
      console.error('表单验证失败:', error);
    }
  };

  // 测试连接功能 - 测试完成后关闭连接池
  const handleTestConnection = async () => {
    try {
      const values = await form.validateFields();
      
      const connection: DatabaseConnection = {
        id: 'test',
        name: values.name,
        type: values.type,
        host: values.host,
        port: values.port,
        username: values.username,
        password: values.password,
        database: values.database,
        ssl: values.ssl || false,
        timeout: values.timeout || 30,
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
          } else {
            message.error(`连接测试失败: ${testResult.error}`);
          }
        } finally {
          // 无论测试成功与否，都尝试关闭连接池
          try {
            await (window.electronAPI as any)?.closeTestConnection?.(connection);
          } catch (closeError) {
            console.debug('关闭测试连接池失败:', closeError);
            // 静默忽略关闭错误，不影响用户体验
          }
        }
      } else {
        // 开发环境模拟连接成功
        message.destroy('testConnection');
        message.success('连接测试成功（模拟）');
      }
    } catch (error) {
      console.error('表单验证失败:', error);
      message.destroy('testConnection');
    }
  };

  // 第一步：进入下一步
  const handleNextStep = () => {
    try {
      if (currentStep === 1) {
        const values = form.getFieldsValue();
        if (!values.type) {
          message.error('请选择数据库类型');
          return;
        }
        setCurrentStep(2);
        // 设置默认端口
        const dbType = databaseTypes.find(type => type.value === values.type);
        if (dbType && dbType.defaultPort > 0) {
          form.setFieldsValue({ port: dbType.defaultPort });
          // 初始化连接URL的占位符信息
          setTimeout(() => {
            updateConnectionUrl();
          }, 100);
        }
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
        footer={[
          currentStep === 2 && (
            <Button key="prev" onClick={handlePrevStep} icon={<ArrowLeftOutlined />}>
              上一步
            </Button>
          ),
          <Button key="cancel" onClick={handleModalCancel}>
            取消
          </Button>,
          currentStep === 2 && (
            <Button key="test" onClick={handleTestConnection} type="default">
              测试连接
            </Button>
          ),
          <Button 
            key="nextOrSave" 
            type="primary" 
            onClick={currentStep === 1 ? handleNextStep : handleModalOk}
            icon={currentStep === 1 ? <ArrowRightOutlined /> : undefined}
          >
            {currentStep === 1 ? "下一步" : "保存"}
          </Button>
        ].filter(Boolean)}
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
          {currentStep === 1 ? (
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <h3 style={{ marginBottom: '30px' }}>请选择数据库类型</h3>
              <Row gutter={[16, 16]} justify="center">
                {databaseTypes.map(dbType => (
                  <Col key={dbType.value} xs={24} sm={12} md={8}>
                    <Card 
                      hoverable 
                      onClick={() => {
                        form.setFieldsValue({ type: dbType.value });
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
                      <div style={{ textAlign: 'center' }}>
                        {databaseTypeIcons[dbType.value]}
                        <div style={{ marginTop: '10px', fontSize: '16px' }}>{dbType.label}</div>
                        {dbType.defaultPort > 0 && (
                          <div style={{ marginTop: '5px', fontSize: '12px', color: '#8c8c8c' }}>
                            默认端口: {dbType.defaultPort}
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
          ) : (
            <div className="connection-form-content">
              {/* 基本信息部分 */}
              <div className="form-section">
                <div className="form-section-title">基本信息</div>
                <Row gutter={[16, 16]}>
                  <Col span={24}>
                    <Form.Item
                      label="连接名称"
                      name="name"
                      rules={[{ required: true, message: '请输入连接名称' }]}
                      labelCol={{ span: 3 }}
                      wrapperCol={{ span: 21 }}
                    >
                      <Input placeholder="请输入连接名称" />
                    </Form.Item>
                  </Col>
                  <Col span={24}>
                    <Form.Item
                      label="数据库类型"
                      name="type"
                      labelCol={{ span: 3 }}
                      wrapperCol={{ span: 21 }}
                    >
                      <Select disabled>
                        {databaseTypes.map(dbType => (
                          <Option key={dbType.value} value={dbType.value}>
                            {dbType.label}
                          </Option>
                        ))}
                      </Select>
                    </Form.Item>
                  </Col>
                </Row>
              </div>

              {/* 连接设置部分 */}
              <div className="form-section">
                <div className="form-section-title">连接设置</div>
                {/* 第一行：主机地址、端口 */}
                <Row gutter={[16, 16]}>
                  <Col span={12}>
                    <Form.Item
                      label="主机地址"
                      name="host"
                      rules={[{ required: true, message: '请输入主机地址' }]}
                      labelCol={{ span: 6 }}
                      wrapperCol={{ span: 18 }}
                    >
                      <Input placeholder="localhost" onChange={() => updateConnectionUrl()} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item
                      label="端口"
                      name="port"
                      rules={[{ required: true, message: '请输入端口号' }]}
                      labelCol={{ span: 6 }}
                      wrapperCol={{ span: 18 }}
                    >
                      <Input type="number" onChange={() => updateConnectionUrl()} />
                    </Form.Item>
                  </Col>
                </Row>

                {/* 第二行：用户名、密码 */}
                <Row gutter={[16, 16]}>
                  <Col span={12}>
                    <Form.Item
                      label="用户名"
                      name="username"
                      rules={[{ required: true, message: '请输入用户名' }]}
                      labelCol={{ span: 6 }}
                      wrapperCol={{ span: 18 }}
                    >
                      <Input placeholder="请输入用户名" onChange={() => updateConnectionUrl()} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item
                      label="密码"
                      name="password"
                      labelCol={{ span: 6 }}
                      wrapperCol={{ span: 18 }}
                    >
                      <Input.Password placeholder="请输入密码" onChange={() => updateConnectionUrl()} />
                    </Form.Item>
                  </Col>
                </Row>

                {/* 第三行：默认数据库 */}
                <Row gutter={[16, 16]}>
                  <Col span={24}>
                    <Form.Item
                      label="默认数据库"
                      name="database"
                      labelCol={{ span: 3 }}
                      wrapperCol={{ span: 21 }}
                    >
                      <Input placeholder="可选，连接后默认使用的数据库" onChange={() => updateConnectionUrl()} />
                    </Form.Item>
                  </Col>
                </Row>

                {/* 第四行：URL */}
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

              {/* 高级设置部分 */}
              <div className="form-section">
                <div className="form-section-title">高级设置</div>
                <Row gutter={[16, 16]}>
                  <Col span={12}>
                    <Form.Item 
                      label="SSL连接" 
                      name="ssl" 
                      valuePropName="checked"
                      labelCol={{ span: 6 }}
                      wrapperCol={{ span: 18 }}
                    >
                      <Switch onChange={() => updateConnectionUrl()} />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item 
                      label="连接超时(秒)" 
                      name="timeout"
                      labelCol={{ span: 6 }}
                      wrapperCol={{ span: 18 }}
                    >
                      <Input type="number" min={5} max={300} />
                    </Form.Item>
                  </Col>
                  <Col span={24}>
                    <div style={{ padding: '20px 0', textAlign: 'center', color: '#8c8c8c' }}>
                      填写完所有必要信息后，点击"测试连接"验证配置是否正确
                    </div>
                  </Col>
                </Row>
              </div>
            </div>
          )}
        </Form>
      </Modal>
    </div>
  );
};

export default ConnectionPanel;