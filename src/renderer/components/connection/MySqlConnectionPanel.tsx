import React, { useEffect } from 'react';
import { Form, Input, Row, Col, Tooltip, Select } from 'antd';
import { BaseConnectionPanelProps, ConnectionPanelComponent } from './types';

const { Option } = Select;

const MySqlConnectionPanel: ConnectionPanelComponent = ({
  form,
  connection,
  darkMode,
  onUrlChange,
  initialValues
}) => {
  // 初始化表单值
  useEffect(() => {
    if (initialValues) {
      form.setFieldsValue(initialValues);
    }
  }, [form, initialValues]);

  // 当表单字段变化时更新URL
  const handleFieldChange = () => {
    if (!onUrlChange) return;
    
    try {
      const values = form.getFieldsValue(['host', 'port', 'username', 'password', 'database', 'ssl']);
      
      if (!values.host || !values.port || !values.username) {
        onUrlChange('');
        return;
      }
      
      let url = `mysql://${values.username}`;
      if (values.password) {
        url += `:${values.password}`;
      }
      
      url += `@${values.host}:${values.port}`;
      
      if (values.database) {
        url += `/${values.database}`;
      }
      
      if (values.ssl) {
        url += '?ssl=true';
      }
      
      onUrlChange(url);
    } catch (error) {
      console.error('生成MySQL连接URL失败:', error);
    }
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
              <Input placeholder="localhost" onChange={handleFieldChange} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="端口"
              name="port"
              initialValue={3306}
              rules={[{ required: true, message: '请输入端口号' }]}
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
            >
              <Input type="number" onChange={handleFieldChange} />
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
              <Input placeholder="请输入用户名" onChange={handleFieldChange} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="密码"
              name="password"
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
            >
              <Input.Password placeholder="请输入密码" onChange={handleFieldChange} />
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
              <Input placeholder="可选，连接后默认使用的数据库" onChange={handleFieldChange} />
            </Form.Item>
          </Col>
        </Row>

        {/* 字符集设置 */}
        <Row gutter={[16, 16]}>
          <Col span={12}>
            <Form.Item
              label="字符集"
              name="charset"
              labelCol={{ span: 6 }}
              wrapperCol={{ span: 18 }}
            >
              <Select placeholder="utf8mb4" onChange={handleFieldChange}>
                <Option value="utf8mb4">utf8mb4 (推荐)</Option>
                <Option value="utf8">utf8</Option>
                <Option value="latin1">latin1</Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>
      </div>
    </div>
  );
};

// 设置组件静态属性
MySqlConnectionPanel.databaseType = 'mysql';
MySqlConnectionPanel.label = 'MySQL';
MySqlConnectionPanel.defaultPort = 3306;

export default MySqlConnectionPanel;