import React, { useState } from 'react';
import { Modal, Form, Input, message } from 'antd';
import { DatabaseConnection } from '../types';

interface AddSchemaModalProps {
  visible: boolean;
  connection: DatabaseConnection | null;
  databaseName: string;
  onCancel: () => void;
  onSuccess: () => void;
}

const AddSchemaModal: React.FC<AddSchemaModalProps> = ({
  visible,
  connection,
  databaseName,
  onCancel,
  onSuccess
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  // 处理表单提交
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const schemaName = values.schemaName.trim();
      
      if (!window.electronAPI || !connection?.isConnected) {
        message.error('数据库未连接，无法创建新模式');
        return;
      }

      setLoading(true);
      
      // 构建创建模式的SQL语句
      const createSchemaSql = `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`;
      
      // 使用连接池ID
      const poolId = connection.connectionId || connection.id;
      
      // 执行SQL语句创建模式
      const result = await window.electronAPI.executeQuery(poolId, createSchemaSql);
      
      if (result && result.success) {
        message.success(`成功创建模式：${schemaName}`);
        form.resetFields();
        onSuccess();
      } else {
        message.error(`创建模式失败：${result?.error || '未知错误'}`);
      }
    } catch (error) {
      console.error('创建模式异常：', error);
      message.error(`创建模式异常：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      setLoading(false);
    }
  };

  // 当模态框关闭时重置表单
  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  return (
    <Modal
      title="新增模式"
      open={visible}
      onOk={handleSubmit}
      onCancel={handleCancel}
      okText="创建"
      cancelText="取消"
      confirmLoading={loading}
      width={500}
    >
      <Form form={form} layout="vertical" initialValues={{}}>
        <Form.Item
          name="databaseName"
          label="数据库"
          hidden
        >
          <Input value={databaseName} disabled />
        </Form.Item>
        
        <Form.Item
          name="schemaName"
          label="模式名称"
          rules={[
            { required: true, message: '请输入模式名称' },
            { 
              pattern: /^[a-zA-Z_][a-zA-Z0-9_]*$/, 
              message: '模式名称只能包含字母、数字和下划线，且不能以数字开头'
            },
            { max: 63, message: '模式名称长度不能超过63个字符' }
          ]}
        >
          <Input placeholder="请输入新模式的名称" />
        </Form.Item>
        
        <div style={{ marginTop: 16, color: '#8c8c8c' }}>
          <p style={{ fontSize: 12 }}>提示：
            <br />• 模式名称应遵循PostgreSQL命名规范
            <br />• 新模式创建后，可以在数据库对象浏览器中查看和使用
          </p>
        </div>
      </Form>
    </Modal>
  );
};

export default AddSchemaModal;