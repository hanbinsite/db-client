import React, { useState } from 'react';
import { Modal, Form, Input, Select, Button, message } from 'antd';
import { DatabaseConnection } from '../../types';

type AddDatabaseModalProps = {
  visible: boolean;
  connection: DatabaseConnection | null;
  onCancel: () => void;
  onSuccess: () => void;
};

// MySQL 8支持的主要字符集
const CHARSET_OPTIONS = [
  { label: 'UTF-8 Unicode (utf8mb4)', value: 'utf8mb4' },
  { label: 'UTF-8 (utf8)', value: 'utf8' },
  { label: 'Latin1 (cp1252 West European)', value: 'latin1' },
  { label: 'gbk (GB2312 Simplified Chinese)', value: 'gbk' },
  { label: 'gb2312 (GB2312 Simplified Chinese)', value: 'gb2312' },
  { label: 'utf16 (Unicode UCS-2)', value: 'utf16' },
  { label: 'utf16le (Unicode UCS-2 Little Endian)', value: 'utf16le' },
  { label: 'binary (Binary pseudo charset)', value: 'binary' },
];

// 不同字符集对应的排序规则
const CHARSET_TO_COLLATIONS: Record<string, Array<{label: string, value: string}>> = {
  // utf8mb4字符集的排序规则
  'utf8mb4': [
    { label: 'utf8mb4_0900_ai_ci (默认)', value: 'utf8mb4_0900_ai_ci' },
    { label: 'utf8mb4_general_ci', value: 'utf8mb4_general_ci' },
    { label: 'utf8mb4_unicode_ci', value: 'utf8mb4_unicode_ci' },
    { label: 'utf8mb4_bin', value: 'utf8mb4_bin' },
    { label: 'utf8mb4_0900_bin', value: 'utf8mb4_0900_bin' },
    { label: 'utf8mb4_zh_0900_as_cs', value: 'utf8mb4_zh_0900_as_cs' },
  ],
  
  // utf8字符集的排序规则
  'utf8': [
    { label: 'utf8_general_ci (默认)', value: 'utf8_general_ci' },
    { label: 'utf8_unicode_ci', value: 'utf8_unicode_ci' },
    { label: 'utf8_bin', value: 'utf8_bin' },
    { label: 'utf8_croatian_ci', value: 'utf8_croatian_ci' },
    { label: 'utf8_czech_ci', value: 'utf8_czech_ci' },
  ],
  
  // latin1字符集的排序规则
  'latin1': [
    { label: 'latin1_swedish_ci (默认)', value: 'latin1_swedish_ci' },
    { label: 'latin1_general_ci', value: 'latin1_general_ci' },
    { label: 'latin1_bin', value: 'latin1_bin' },
    { label: 'latin1_german1_ci', value: 'latin1_german1_ci' },
    { label: 'latin1_german2_ci', value: 'latin1_german2_ci' },
  ],
  
  // gbk字符集的排序规则
  'gbk': [
    { label: 'gbk_chinese_ci (默认)', value: 'gbk_chinese_ci' },
    { label: 'gbk_bin', value: 'gbk_bin' },
  ],
  
  // gb2312字符集的排序规则
  'gb2312': [
    { label: 'gb2312_chinese_ci (默认)', value: 'gb2312_chinese_ci' },
    { label: 'gb2312_bin', value: 'gb2312_bin' },
  ],
  
  // utf16字符集的排序规则
  'utf16': [
    { label: 'utf16_general_ci (默认)', value: 'utf16_general_ci' },
    { label: 'utf16_bin', value: 'utf16_bin' },
    { label: 'utf16_unicode_ci', value: 'utf16_unicode_ci' },
  ],
  
  // utf16le字符集的排序规则
  'utf16le': [
    { label: 'utf16le_general_ci (默认)', value: 'utf16le_general_ci' },
    { label: 'utf16le_bin', value: 'utf16le_bin' },
  ],
  
  // binary字符集的排序规则
  'binary': [
    { label: 'binary (默认)', value: 'binary' },
  ],
};

const AddDatabaseModal: React.FC<AddDatabaseModalProps> = ({
  visible,
  connection,
  onCancel,
  onSuccess,
}) => {
  const [form] = Form.useForm();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentCharset, setCurrentCharset] = useState('utf8mb4'); // MySQL 8默认字符集
  
  // 当字符集变化时，更新排序规则
  const handleCharsetChange = (value: string) => {
    setCurrentCharset(value);
    // 获取当前字符集对应的默认排序规则
    const defaultCollation = CHARSET_TO_COLLATIONS[value]?.[0]?.value;
    if (defaultCollation) {
      form.setFieldValue('collation', defaultCollation);
    }
  };

  // 重置表单
  const resetForm = () => {
    form.resetFields();
  };

  // 处理取消
  const handleCancel = () => {
    resetForm();
    onCancel();
  };

  // 处理表单提交
  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setIsSubmitting(true);

      // 这里应该调用API来创建数据库
      // 由于没有实际的API，我们模拟一个异步操作
      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log('创建数据库:', values);
      message.success(`数据库 ${values.databaseName} 创建成功`);
      
      // 重置表单并关闭弹窗
      resetForm();
      onSuccess();
    } catch (error) {
      console.error('创建数据库失败:', error);
      message.error('创建数据库失败，请重试');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      title="新增数据库"
      open={visible}
      onCancel={handleCancel}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          取消
        </Button>,
        <Button
          key="submit"
          type="primary"
          onClick={handleSubmit}
          loading={isSubmitting}
        >
          确定
        </Button>,
      ]}
      width={500}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          charset: 'utf8mb4', // MySQL 8默认字符集
          collation: 'utf8mb4_0900_ai_ci', // MySQL 8默认排序规则
        }}
      >
        <Form.Item
          name="databaseName"
          label="数据库名称"
          rules={[
            { required: true, message: '请输入数据库名称' },
            { pattern: /^[a-zA-Z0-9_]+$/, message: '数据库名称只能包含字母、数字和下划线' },
            { max: 64, message: '数据库名称不能超过64个字符' },
          ]}
        >
          <Input placeholder="请输入数据库名称" />
        </Form.Item>

        <Form.Item
          name="charset"
          label="字符集"
          rules={[{ required: true, message: '请选择字符集' }]}
        >
          <Select placeholder="请选择字符集" onChange={handleCharsetChange}>
            {CHARSET_OPTIONS.map(option => (
              <Select.Option key={option.value} value={option.value}>
                {option.label}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>

        <Form.Item
          name="collation"
          label="排序规则"
          rules={[{ required: true, message: '请选择排序规则' }]}
        >
          <Select placeholder="请选择排序规则">
            {CHARSET_TO_COLLATIONS[currentCharset]?.map(option => (
              <Select.Option key={option.value} value={option.value}>
                {option.label}
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default AddDatabaseModal;