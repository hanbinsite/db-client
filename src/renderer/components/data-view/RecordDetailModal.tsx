import React from 'react';
import { Modal, Form, Input, InputNumber, Checkbox, DatePicker, message, Button } from 'antd';
import { TableColumn, DataEditOperation } from '../types';

interface RecordDetailModalProps {
  visible: boolean;
  record: any;
  tableStructure: TableColumn[];
  editOperations: DataEditOperation[];
  onClose: () => void;
  onSave: (operations: DataEditOperation[]) => void;
  tableName: string;
}

const RecordDetailModal: React.FC<RecordDetailModalProps> = ({
  visible,
  record,
  tableStructure,
  editOperations,
  onClose,
  onSave,
  tableName
}) => {
  const [editingRecord, setEditingRecord] = React.useState<any>(null);
  const [form] = Form.useForm();

  React.useEffect(() => {
    if (visible && record) {
      // 创建可编辑的记录副本
      setEditingRecord({ ...record });
      form.resetFields();
      // 为每个字段设置初始值
      Object.entries(record).forEach(([key, value]) => {
        if (key !== 'key') {
          form.setFieldValue(key, value === null ? '' : value);
        }
      });
    }
  }, [visible, record, form]);

  const handleSave = () => {
    form.validateFields()
      .then(values => {
        try {
          // 判断是新增记录还是更新记录
          // 通过检查record.key是否以'new_'开头来判断
          const isNewRecord = record && record.key && record.key.startsWith('new_');

          if (isNewRecord) {
            // 创建新增操作
            const insertOperation: DataEditOperation = {
              type: 'insert',
              table: tableName || 'unknown',
              data: editingRecord
            };

            // 添加到编辑操作列表
            onSave([...editOperations, insertOperation]);
            message.success('记录已添加，请提交变更以应用更新');
            onClose();
          } else {
            // 查找主键列
            const primaryKeyColumn = tableStructure.find(col => col.primaryKey);
            if (!primaryKeyColumn) {
              message.error('找不到主键列，无法更新数据');
              return;
            }

            // 创建更新操作
            const updateOperation: DataEditOperation = {
              type: 'update',
              table: tableName || 'unknown',
              data: editingRecord,
              where: { [primaryKeyColumn.name]: record[primaryKeyColumn.name] }
            };

            // 添加到编辑操作列表
            onSave([...editOperations, updateOperation]);
            message.success('记录已更新，请提交变更以应用更新');
            onClose();
          }
        } catch (err) {
          message.error(`操作失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      })
      .catch(info => {
        message.error('表单验证失败，请检查输入');
      });
  };

  const renderFieldControl = (key: string, value: any) => {
    const column = tableStructure.find(col => col.name === key);
    const type = column?.type.toLowerCase() || 'string';

    // 文本类型 - 使用文本域
    if (type.includes('text') || type.includes('varchar') || type.includes('char')) {
      return (
        <Input.TextArea
          value={value === null || typeof value === 'object' ? '' : String(value)}
          onChange={(e) => setEditingRecord((prev: any) => ({ ...prev, [key]: e.target.value }))}
          style={{
            minHeight: '80px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
          }}
        />
      );
    }

    // 数值类型
    if (type.includes('int') || type.includes('float') || type.includes('double') || type.includes('decimal')) {
      return (
        <InputNumber
          style={{ width: '100%' }}
          value={value === null ? undefined : Number(value)}
          onChange={(newValue) => setEditingRecord((prev: any) => ({ ...prev, [key]: newValue === undefined ? null : newValue }))}
        />
      );
    }

    // 日期类型
    if (type.includes('date') && !type.includes('time') && !type.includes('datetime')) {
      return (
        <DatePicker
          style={{ width: '100%' }}
          value={value && typeof value === 'string' ? new Date(value) : null}
          onChange={(date) => setEditingRecord((prev: any) => ({ ...prev, [key]: date ? date.toISOString().split('T')[0] : null }))}
        />
      );
    }

    // 日期时间类型
    if (type.includes('datetime') || (type.includes('date') && type.includes('time'))) {
      return (
        <DatePicker
          style={{ width: '100%' }}
          showTime
          value={value && typeof value === 'string' ? new Date(value) : null}
          onChange={(date) => setEditingRecord((prev: any) => ({ ...prev, [key]: date ? date.toISOString() : null }))}
        />
      );
    }

    // 布尔类型
    if (type.includes('boolean')) {
      return (
        <Checkbox
          checked={value === true || value === 'true' || value === 1}
          onChange={(e) => setEditingRecord((prev: any) => ({ ...prev, [key]: e.target.checked }))}
        />
      );
    }

    // 其他类型
    return (
      <Input
        value={value === null || typeof value === 'object' ? '' : String(value)}
        onChange={(e) => setEditingRecord((prev: any) => ({ ...prev, [key]: e.target.value }))}
        style={{
          minHeight: '40px',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }}
      />
    );
  };

  return (
    <Modal
      title={record && record.key && record.key.startsWith('new_') ? "新增记录" : "记录详情"}
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
        <Button key="save" type="primary" onClick={handleSave}>
          保存
        </Button>
      ]}
      width={700}
    >
      {editingRecord && (
        <Form layout="vertical" form={form}>
          {Object.entries(editingRecord).map(([key, value]) => {
            // 跳过key属性
            if (key === 'key') return null;
            
            const column = tableStructure.find(col => col.name === key);
            
            return (
              <Form.Item
                key={key}
                label={`${key}${column ? ` (${column.type})` : ''}`}
              >
                {renderFieldControl(key, value)}
              </Form.Item>
            );
          })}
        </Form>
      )}
    </Modal>
  );
};

export default RecordDetailModal;