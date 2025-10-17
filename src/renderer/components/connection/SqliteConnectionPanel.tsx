import React, { useEffect } from 'react';
import { Form, Input, Row, Col, Button } from 'antd';
import { BaseConnectionPanelProps, ConnectionPanelComponent } from './types';

const SqliteConnectionPanel: ConnectionPanelComponent = ({
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
      const values = form.getFieldsValue(['host']); // SQLite使用host字段存储文件路径
      
      if (!values.host) {
        onUrlChange('');
        return;
      }
      
      // SQLite URL格式: sqlite:///文件路径
      const url = `sqlite:///${values.host.replace(/\\/g, '/')}`;
      
      onUrlChange(url);
    } catch (error) {
      console.error('生成SQLite连接URL失败:', error);
    }
  };

  // 打开文件选择对话框（在Electron环境中可以通过IPC调用原生对话框）
  const handleSelectFile = () => {
    // 这里简化处理，实际应用中应该通过Electron的ipcRenderer调用dialog.showOpenDialog
    // 这里只是模拟用户选择了文件
    const simulatedFilePath = 'C:/path/to/database.sqlite'; // 模拟路径
    form.setFieldsValue({ host: simulatedFilePath });
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
        <Row gutter={[16, 16]}>
          <Col span={24}>
            <Form.Item
              label="数据库文件路径"
              name="host"
              rules={[{ required: true, message: '请选择SQLite数据库文件' }]}
              labelCol={{ span: 3 }}
              wrapperCol={{ span: 21 }}
            >
              <div style={{ display: 'flex', gap: '8px' }}>
                <Input 
                  placeholder="输入SQLite数据库文件路径"
                  style={{ flex: 1 }}
                  onChange={handleFieldChange}
                />
                <Button type="primary" onClick={handleSelectFile}>
                  浏览...
                </Button>
              </div>
            </Form.Item>
          </Col>
        </Row>

        {/* SQLite特有配置提示 */}
        <Row gutter={[16, 16]}>
          <Col span={24}>
            <div style={{ 
              padding: '12px', 
              backgroundColor: darkMode ? '#1e1e1e' : '#f5f5f5',
              borderRadius: '4px',
              color: darkMode ? '#ccc' : '#666',
              fontSize: '14px'
            }}>
              <strong>SQLite提示：</strong>
              <ul style={{ marginTop: '8px', marginBottom: 0, paddingLeft: '20px' }}>
                <li>SQLite是文件型数据库，无需用户名和密码</li>
                <li>请确保应用程序有文件的读写权限</li>
                <li>如果文件不存在，将自动创建新的数据库文件</li>
              </ul>
            </div>
          </Col>
        </Row>
      </div>
    </div>
  );
};

// 设置组件静态属性
SqliteConnectionPanel.databaseType = 'sqlite';
SqliteConnectionPanel.label = 'SQLite';
SqliteConnectionPanel.defaultPort = 0; // SQLite不需要端口

export default SqliteConnectionPanel;