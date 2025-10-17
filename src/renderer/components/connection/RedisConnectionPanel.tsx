import React, { useEffect } from 'react';
import { Form, Input, Row, Col, Switch, Select } from 'antd';
import { BaseConnectionPanelProps, ConnectionPanelComponent } from './types';

const { Option } = Select;

const RedisConnectionPanel: ConnectionPanelComponent = ({
  form,
  connection,
  darkMode,
  onUrlChange,
  initialValues
}) => {
  // 初始化表单值
  // 添加状态跟踪以确保表单字段正确响应authType变化
  const [authType, setAuthType] = React.useState<string>('none');

  useEffect(() => {
    if (initialValues) {
      form.setFieldsValue(initialValues);
      // 初始化authType状态
      if (initialValues.authType) {
        setAuthType(initialValues.authType);
      }
    }
  }, [form, initialValues]);

  // 监听authType字段变化，更新状态
  useEffect(() => {
    const currentAuthType = form.getFieldValue('authType');
    if (currentAuthType !== authType) {
      setAuthType(currentAuthType || 'none');
    }
  }, [form, authType]);

  // 当表单字段变化时更新URL
  const handleFieldChange = () => {
    if (!onUrlChange) return;
    
    try {
      const values = form.getFieldsValue(['host', 'port', 'username', 'password', 'database', 'redisType', 'authType']);
      
      if (!values.host || !values.port) {
        onUrlChange('');
        return;
      }
      
      let url = 'redis://';
      
      // 根据验证方式添加认证信息
      if (values.authType === 'password') {
        // 只有密码
        if (values.password) {
          url += `:${values.password}@`;
        }
      } else if (values.authType === 'username_password') {
        // 用户名和密码
        if (values.username) {
          url += values.username;
          if (values.password) {
            url += `:${values.password}`;
          }
          url += '@';
        }
      }
      // None类型不添加认证信息
      
      url += `${values.host}:${values.port}`;
      
      // Redis数据库编号
      if (values.database) {
        url += `/${values.database}`;
      } else {
        url += '/0'; // 默认数据库0
      }
      
      // 添加SSL和Redis类型信息
      const queryParams = [];
      if (values.ssl) {
        queryParams.push('ssl=true');
      }
      if (values.redisType !== 'standalone') {
        queryParams.push(`type=${values.redisType}`);
      }
      
      if (queryParams.length > 0) {
        url += `?${queryParams.join('&')}`;
      }
      
      onUrlChange(url);
    } catch (error) {
      console.error('生成Redis连接URL失败:', error);
    }
  };
  
  // 当验证方式改变时，清除之前的认证信息并重新计算URL
  const handleAuthTypeChange = (value: string) => {
    // 先更新状态，然后设置表单值
    setAuthType(value);
    form.setFieldsValue({ authType: value });
    
    // 清除相关字段值
    if (value === 'none') {
      form.setFieldsValue({ username: '', password: '' });
    } else if (value === 'password') {
      form.setFieldsValue({ username: '' });
    }
    
    handleFieldChange();
  };

  return (
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
        </Row>
      </div>

      {/* 连接设置部分 */}
      <div className="form-section">
        <div className="form-section-title">连接设置</div>
        {/* 第一行：Redis类型、验证方式 */}
        <Row gutter={[16, 16]}>
          <Col span={12}>
            <Form.Item
              label="Redis类型"
              name="redisType"
              initialValue="standalone"
              rules={[{ required: true, message: '请选择Redis类型' }]}
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
            >
              <Select onChange={handleFieldChange}>
                <Option value="standalone">单机</Option>
                <Option value="cluster">集群</Option>
                <Option value="sentinel">哨兵</Option>
              </Select>
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="验证方式"
              name="authType"
              initialValue="none"
              rules={[{ required: true, message: '请选择验证方式' }]}
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
            >
              <Select onChange={handleAuthTypeChange}>
                <Option value="none">None</Option>
                <Option value="password">Password</Option>
                <Option value="username_password">Username & Password</Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        {/* 第二行：主机地址、端口 */}
        <Row gutter={[16, 16]}>
          <Col span={12}>
            <Form.Item
              label="主机地址"
              name="host"
              rules={[{ required: true, message: '请输入主机地址' }]}
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
            >
              <Input placeholder="localhost" onChange={handleFieldChange} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="端口"
              name="port"
              initialValue={6379}
              rules={[{ required: true, message: '请输入端口号' }]}
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
            >
              <Input type="number" onChange={handleFieldChange} />
            </Form.Item>
          </Col>
        </Row>

        {/* 第三行：用户名、密码 - 根据验证方式动态显示 */}
        <Row gutter={[16, 16]}>
          {authType === 'username_password' && (
            <Col span={12}>
              <Form.Item
                label="用户名"
                name="username"
                rules={[{ required: true, message: '请输入用户名' }]}
                labelCol={{ span: 6 }}
                wrapperCol={{ span: 18 }}
              >
                <Input 
                  placeholder="请输入用户名" 
                  onChange={handleFieldChange} 
                />
              </Form.Item>
            </Col>
          )}
          {(authType === 'password' || authType === 'username_password') && (
            <Col span={authType === 'username_password' ? 12 : 24}>
              <Form.Item
                label="密码"
                name="password"
                rules={[{ required: true, message: '请输入密码' }]}
                labelCol={{ span: authType === 'username_password' ? 6 : 3 }}
                wrapperCol={{ span: authType === 'username_password' ? 18 : 21 }}
              >
                <Input.Password 
                  placeholder="请输入密码" 
                  onChange={handleFieldChange} 
                />
              </Form.Item>
            </Col>
          )}
        </Row>

        {/* 第三行：数据库编号 */}
        <Row gutter={[16, 16]}>
          <Col span={12}>
            <Form.Item
              label="数据库编号"
              name="database"
              initialValue={0}
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
            >
              <Input 
                type="number" 
                placeholder="默认0" 
                min={0} 
                max={15} 
                onChange={handleFieldChange} 
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            {/* SSL连接选项已移至通用高级设置中 */}
          </Col>
        </Row>
      </div>
    </div>
  );
};

// 设置组件静态属性
RedisConnectionPanel.databaseType = 'redis';
RedisConnectionPanel.label = 'Redis';
RedisConnectionPanel.defaultPort = 6379;

export default RedisConnectionPanel;