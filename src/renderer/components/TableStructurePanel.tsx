import React, { useState, useEffect } from 'react';
import { Tabs, Card, Button, Table, Space, Input, message, Form, Modal, Typography, Tag, Divider, Select, InputNumber } from 'antd';
import { 
  PlusOutlined, 
  DeleteOutlined, 
  SaveOutlined, 
  CopyOutlined, 
  EditOutlined, 
  CheckOutlined,
  DatabaseOutlined,
  AlignLeftOutlined,
  KeyOutlined,
  LinkOutlined,
  LeftCircleOutlined,
  CodeOutlined
} from '@ant-design/icons';
import { DatabaseConnection } from '../types';
import { 
  TableField, 
  TableIndex, 
  TableForeignKey, 
  TableCheck, 
  TableTrigger, 
  TableOptions, 
  getCompleteTableStructureWithRetry,
  checkTableExists 
} from '../utils/table-structure-utils';

const { Title, Text } = Typography;
const { Option } = Select;
const { TextArea } = Input;

// 表字段、索引、外键等接口已在table-structure-utils.ts中定义并导入
// 此处不再重复定义

interface TableStructurePanelProps {
  connection: DatabaseConnection | null;
  database: string;
  table: string;
}

const TableStructurePanel: React.FC<TableStructurePanelProps> = ({ connection, database, table }) => {
  // 状态管理
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<TableField[]>([]);
  const [indexes, setIndexes] = useState<TableIndex[]>([]);
  const [foreignKeys, setForeignKeys] = useState<TableForeignKey[]>([]);
  const [checks, setChecks] = useState<TableCheck[]>([]);
  const [triggers, setTriggers] = useState<TableTrigger[]>([]);
  const [options, setOptions] = useState<TableOptions>({});
  const [tableComment, setTableComment] = useState('');
  const [sqlPreview, setSqlPreview] = useState('');
  const [activeSubTab, setActiveSubTab] = useState('fields');
  const [isEditMode, setIsEditMode] = useState(false);
  const [isAddFieldModalVisible, setIsAddFieldModalVisible] = useState(false);
  const [isAddIndexModalVisible, setIsAddIndexModalVisible] = useState(false);
  const [isAddForeignKeyModalVisible, setIsAddForeignKeyModalVisible] = useState(false);
  const [isAddCheckModalVisible, setIsAddCheckModalVisible] = useState(false);
  const [isAddTriggerModalVisible, setIsAddTriggerModalVisible] = useState(false);
  const [isCopyModalVisible, setIsCopyModalVisible] = useState(false);
  
  // 表单实例
  const [fieldForm] = Form.useForm();
  const [indexForm] = Form.useForm();
  const [foreignKeyForm] = Form.useForm();
  const [checkForm] = Form.useForm();
  const [triggerForm] = Form.useForm();
  const [optionsForm] = Form.useForm();
  
  // 加载表结构信息
  const loadTableStructure = async () => {
    console.log('尝试加载表结构:', { connection, database, table });
    if (!connection || !database || !table || !connection.isConnected) {
      console.log('连接信息不完整或未连接');
      return;
    }
    
    setLoading(true);
    try {
      // 先检查表格是否存在
      const tableExists = await checkTableExists(connection, database, table);
      if (!tableExists) {
        console.warn('表不存在:', database + '.' + table);
        message.error(`表 ${database}.${table} 不存在`);
        return;
      }
      
      // 使用带重试机制的策略模式获取完整表结构信息
      const tableStructureResult = await getCompleteTableStructureWithRetry(connection, database, table);
      
      if (tableStructureResult.success) {
        const { data: tableStructure } = tableStructureResult;
        
        // 更新所有表结构相关状态
        setFields(tableStructure.fields || []);
        setIndexes(tableStructure.indexes || []);
        setForeignKeys(tableStructure.foreignKeys || []);
        setChecks(tableStructure.checks || []);
        setTriggers(tableStructure.triggers || []);
        setOptions(tableStructure.options || {});
        setTableComment(tableStructure.comment || '');
        
        // 更新表选项表单
        if (tableStructure.options) {
          optionsForm.setFieldsValue(tableStructure.options);
        }
        
        console.log('成功加载表结构数据:', {
          fields: tableStructure.fields.length,
          indexes: tableStructure.indexes.length,
          foreignKeys: tableStructure.foreignKeys.length,
          checks: tableStructure.checks.length,
          triggers: tableStructure.triggers.length
        });
      } else {
        console.error('获取表结构信息失败:', tableStructureResult.error);
        message.error(`获取表结构信息失败: ${tableStructureResult.error || '未知错误'}`);
        
        // 发生错误时保持所有数据为空
        setFields([]);
        setIndexes([]);
        setForeignKeys([]);
        setChecks([]);
        setTriggers([]);
        setOptions({});
        setTableComment('');
      }
      
      // 生成SQL预览
      generateSqlPreview();
    } catch (error) {
      console.error('加载表结构失败:', error);
      message.error('加载表结构失败: ' + (error as Error).message);
      
      // 发生错误时保持所有数据为空
      setFields([]);
      setIndexes([]);
      setForeignKeys([]);
      setChecks([]);
      setTriggers([]);
      setOptions({});
      setTableComment('');
    } finally {
      setLoading(false);
    }
  };
  
  // 获取表字段信息函数已移至 table-structure-utils.ts 中，此处保留注释以便参考
  // 现使用 TableStructureStrategy 策略模式实现不同数据库类型的表结构获取
  
  // 获取表索引信息函数已移至 table-structure-utils.ts 中，此处保留注释以便参考
  // 现使用 TableStructureStrategy 策略模式实现不同数据库类型的表结构获取
  
  // 获取表外键信息函数已移至 table-structure-utils.ts 中，此处保留注释以便参考
  // 现使用 TableStructureStrategy 策略模式实现不同数据库类型的表结构获取
  
  // 获取表检查约束信息函数已移至 table-structure-utils.ts 中，此处保留注释以便参考
  // 现使用 TableStructureStrategy 策略模式实现不同数据库类型的表结构获取
  
  // 获取表触发器信息函数已移至 table-structure-utils.ts 中，此处保留注释以便参考
  // 现使用 TableStructureStrategy 策略模式实现不同数据库类型的表结构获取
  
  // 获取表选项信息函数已移至 table-structure-utils.ts 中，此处保留注释以便参考
  // 现使用 TableStructureStrategy 策略模式实现不同数据库类型的表结构获取
  
  // 获取表注释函数已移至 table-structure-utils.ts 中，此处保留注释以便参考
  // 现使用 TableStructureStrategy 策略模式实现不同数据库类型的表结构获取
  
  // 生成SQL预览
  const generateSqlPreview = () => {
    let sql = `-- 修改表 ${database}.${table} 的SQL预览\n`;
    sql += `-- 生成时间: ${new Date().toLocaleString()}\n\n`;
    
    // 生成字段修改SQL
    fields.forEach(field => {
      let fieldSql = `-- ${field.name}: ${field.type}`;
      if (field.length) fieldSql += `(${field.length}${field.decimal ? `,${field.decimal}` : ''})`;
      if (field.notNull) fieldSql += ' NOT NULL';
      if (field.key) fieldSql += ` ${field.key}`;
      if (field.comment) fieldSql += ` COMMENT '${field.comment}'`;
      sql += fieldSql + '\n';
    });
    
    // 生成索引SQL
    if (indexes.length > 0) {
      sql += '\n-- 索引\n';
      indexes.forEach(index => {
        sql += `-- ${index.name}: ${index.type} (${index.columns.join(', ')})\n`;
      });
    }
    
    // 生成外键SQL
    if (foreignKeys.length > 0) {
      sql += '\n-- 外键\n';
      foreignKeys.forEach(fk => {
        sql += `-- ${fk.name}: ${fk.columns.join(', ')} -> ${fk.referencedTable}(${fk.referencedColumns.join(', ')})\n`;
      });
    }
    
    setSqlPreview(sql);
  };
  
  // 处理字段删除
  const handleDeleteField = (fieldName: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除字段 ${fieldName} 吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        setFields(fields.filter(field => field.name !== fieldName));
        generateSqlPreview();
        message.success(`字段 ${fieldName} 已删除`);
      }
    });
  };
  
  // 处理索引删除
  const handleDeleteIndex = (indexName: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除索引 ${indexName} 吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        setIndexes(indexes.filter(index => index.name !== indexName));
        generateSqlPreview();
        message.success(`索引 ${indexName} 已删除`);
      }
    });
  };
  
  // 处理外键删除
  const handleDeleteForeignKey = (fkName: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除外键 ${fkName} 吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        setForeignKeys(foreignKeys.filter(fk => fk.name !== fkName));
        generateSqlPreview();
        message.success(`外键 ${fkName} 已删除`);
      }
    });
  };
  
  // 处理检查约束删除
  const handleDeleteCheck = (checkName: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除检查约束 ${checkName} 吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        setChecks(checks.filter(check => check.name !== checkName));
        generateSqlPreview();
        message.success(`检查约束 ${checkName} 已删除`);
      }
    });
  };
  
  // 处理触发器删除
  const handleDeleteTrigger = (triggerName: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除触发器 ${triggerName} 吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        setTriggers(triggers.filter(trigger => trigger.name !== triggerName));
        generateSqlPreview();
        message.success(`触发器 ${triggerName} 已删除`);
      }
    });
  };
  
  // 保存表选项
  const handleSaveOptions = async () => {
    try {
      const values = await optionsForm.validateFields();
      setOptions(values);
      message.success('表选项已保存');
      generateSqlPreview();
    } catch (error) {
      message.error('保存失败，请检查输入');
    }
  };
  
  // 保存表注释
  const handleSaveTableComment = () => {
    message.success('表注释已保存');
    generateSqlPreview();
  };
  
  // 复制SQL预览
  const handleCopySqlPreview = () => {
    navigator.clipboard.writeText(sqlPreview).then(() => {
      message.success('SQL已复制到剪贴板');
    });
  };
  
  // 字段列定义
  const fieldColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'type', key: 'type' },
    { title: '长度', dataIndex: 'length', key: 'length', render: (text: any) => text || '-' },
    { title: '小数点', dataIndex: 'decimal', key: 'decimal', render: (text: any) => text || '-' },
    { 
      title: '不是null', 
      dataIndex: 'notNull', 
      key: 'notNull', 
      render: (text: boolean) => text ? <CheckOutlined style={{ color: 'green' }} /> : '-' 
    },
    { 
      title: '虚拟', 
      dataIndex: 'virtual', 
      key: 'virtual', 
      render: (text: boolean) => text ? <CheckOutlined style={{ color: 'green' }} /> : '-' 
    },
    { 
      title: '键', 
      dataIndex: 'key', 
      key: 'key', 
      render: (text: string) => {
        // 只显示主键(PRI)和排序类型的键(UNI, MUL等)
        if (!text) return '-';
        // 主键显示主键图标
        if (text === 'PRI') return <KeyOutlined style={{ color: '#1890ff' }} title="主键" />;
        // 其他键类型也显示相应图标
        return <KeyOutlined style={{ color: '#faad14' }} title={text} />;
      } 
    },
    { title: '注释', dataIndex: 'comment', key: 'comment', render: (text: string) => text || '-' },
    { title: '操作', 
      key: 'action', 
      render: (_: any, record: TableField) => (
        <Space size="middle">
          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteField(record.name)} />
        </Space>
      )
    }
  ];
  
  // 索引列定义
  const indexColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '类型', dataIndex: 'type', key: 'type' },
    { title: '列', dataIndex: 'columns', key: 'columns', render: (columns: string[]) => columns.join(', ') },
    { title: '注释', dataIndex: 'comment', key: 'comment', render: (text: string) => text || '-' },
    { 
      title: '操作', 
      key: 'action', 
      render: (_: any, record: TableIndex) => (
        <Space size="middle">
          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteIndex(record.name)} />
        </Space>
      )
    }
  ];
  
  // 外键列定义
  const foreignKeyColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '列', dataIndex: 'columns', key: 'columns', render: (columns: string[]) => columns.join(', ') },
    { 
      title: '引用表', 
      dataIndex: 'referencedTable', 
      key: 'referencedTable',
      render: (table: string, record: TableForeignKey) => 
        `${table}(${record.referencedColumns.join(', ')})` 
    },
    { title: '删除操作', dataIndex: 'onDelete', key: 'onDelete' },
    { title: '更新操作', dataIndex: 'onUpdate', key: 'onUpdate' },
    { 
      title: '操作', 
      key: 'action', 
      render: (_: any, record: TableForeignKey) => (
        <Space size="middle">
          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteForeignKey(record.name)} />
        </Space>
      )
    }
  ];
  
  // 检查约束列定义
  const checkColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '条件', dataIndex: 'condition', key: 'condition' },
    { title: '注释', dataIndex: 'comment', key: 'comment', render: (text: string) => text || '-' },
    { 
      title: '操作', 
      key: 'action', 
      render: (_: any, record: TableCheck) => (
        <Space size="middle">
          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteCheck(record.name)} />
        </Space>
      )
    }
  ];
  
  // 触发器列定义
  const triggerColumns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '事件', dataIndex: 'event', key: 'event' },
    { title: '时机', dataIndex: 'timing', key: 'timing' },
    { title: '动作', dataIndex: 'action', key: 'action', render: (text: string) => text || '-' },
    { title: '注释', dataIndex: 'comment', key: 'comment', render: (text: string) => text || '-' },
    { 
      title: '操作', 
      key: 'action', 
      render: (_: any, record: TableTrigger) => (
        <Space size="middle">
          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => handleDeleteTrigger(record.name)} />
        </Space>
      )
    }
  ];
  
  // 组件加载时获取表结构信息
  useEffect(() => {
    loadTableStructure();
  }, [connection, database, table]);
  
  return (
    <div className="table-structure-panel">
      <Card 
        title={`表结构: ${database}.${table}`} 
        size="small"
        extra={
          <Space>
            <Button 
              type={isEditMode ? "primary" : "default"} 
              onClick={() => setIsEditMode(!isEditMode)}
              icon={isEditMode ? <SaveOutlined /> : <EditOutlined />}
            >
              {isEditMode ? '保存修改' : '编辑模式'}
            </Button>
            <Button onClick={loadTableStructure} icon={<PlusOutlined />}>
              刷新
            </Button>
          </Space>
        }
      >
        <Tabs 
          activeKey={activeSubTab} 
          onChange={setActiveSubTab} 
          type="card"
          size="small"
        >
          <Tabs.TabPane key="fields" icon={<DatabaseOutlined />} tab="字段">
            <div style={{ marginBottom: 16 }}>
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => setIsAddFieldModalVisible(true)}
                disabled={!isEditMode}
              >
                新增字段
              </Button>
            </div>
            <Table 
              columns={fieldColumns} 
              dataSource={fields} 
              pagination={false} 
              rowKey="name"
              size="small"
              loading={loading}
            />
          </Tabs.TabPane>
          
          <Tabs.TabPane key="indexes" icon={<KeyOutlined />} tab="索引">
            <div style={{ marginBottom: 16 }}>
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => setIsAddIndexModalVisible(true)}
                disabled={!isEditMode}
              >
                新增索引
              </Button>
            </div>
            <Table 
              columns={indexColumns} 
              dataSource={indexes} 
              pagination={false} 
              rowKey="name"
              size="small"
              loading={loading}
            />
          </Tabs.TabPane>
          
          <Tabs.TabPane key="foreignKeys" icon={<LinkOutlined />} tab="外键">
            <div style={{ marginBottom: 16 }}>
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => setIsAddForeignKeyModalVisible(true)}
                disabled={!isEditMode}
              >
                新增外键
              </Button>
            </div>
            <Table 
              columns={foreignKeyColumns} 
              dataSource={foreignKeys} 
              pagination={false} 
              rowKey="name"
              size="small"
              loading={loading}
            />
          </Tabs.TabPane>
          
          <Tabs.TabPane key="checks" icon={<LeftCircleOutlined />} tab="检查">
            <div style={{ marginBottom: 16 }}>
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => setIsAddCheckModalVisible(true)}
                disabled={!isEditMode}
              >
                新增检查约束
              </Button>
            </div>
            <Table 
              columns={checkColumns} 
              dataSource={checks} 
              pagination={false} 
              rowKey="name"
              size="small"
              loading={loading}
            />
          </Tabs.TabPane>
          
          <Tabs.TabPane key="triggers" icon={<CodeOutlined />} tab="触发器">
            <div style={{ marginBottom: 16 }}>
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => setIsAddTriggerModalVisible(true)}
                disabled={!isEditMode}
              >
                新增触发器
              </Button>
            </div>
            <Table 
              columns={triggerColumns} 
              dataSource={triggers} 
              pagination={false} 
              rowKey="name"
              size="small"
              loading={loading}
            />
          </Tabs.TabPane>
          
          <Tabs.TabPane key="options" icon={<DatabaseOutlined />} tab="选项">
            <Form 
              form={optionsForm} 
              layout="vertical"
              disabled={!isEditMode}
            >
              <Form.Item label="引擎" name="engine">
                <Input />
              </Form.Item>
              <Form.Item label="字符集" name="charset">
                <Input />
              </Form.Item>
              <Form.Item label="排序规则" name="collation">
                <Input />
              </Form.Item>
              <Form.Item label="表空间" name="tablespace">
                <Input />
              </Form.Item>
              <Form.Item label="自增起始值" name="autoIncrement">
                <InputNumber style={{ width: '100%' }} />
              </Form.Item>
              <Form.Item>
                <Button 
                  type="primary" 
                  onClick={handleSaveOptions}
                  disabled={!isEditMode}
                >
                  保存选项
                </Button>
              </Form.Item>
            </Form>
          </Tabs.TabPane>
          
          <Tabs.TabPane key="comment" icon={<AlignLeftOutlined />} tab="表注释">
            <Input.TextArea 
              value={tableComment} 
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setTableComment(e.target.value)}
              rows={6}
              placeholder="输入表注释"
              disabled={!isEditMode}
            />
            <div style={{ marginTop: 16 }}>
              <Button 
                type="primary" 
                onClick={handleSaveTableComment}
                disabled={!isEditMode}
              >
                保存注释
              </Button>
            </div>
          </Tabs.TabPane>
          
          <Tabs.TabPane key="sqlPreview" icon={<CodeOutlined />} tab="SQL预览">
            <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <Button 
                icon={<CopyOutlined />}
                onClick={handleCopySqlPreview}
              >
                复制SQL
              </Button>
            </div>
            <Input.TextArea
              value={sqlPreview}
              readOnly
              rows={10}
              style={{ 
                background: '#f5f5f5', 
                padding: '16px', 
                borderRadius: '4px', 
                overflow: 'auto', 
                maxHeight: '400px',
                fontSize: '12px',
                fontFamily: 'monospace'
              }}
            />
          </Tabs.TabPane>
        </Tabs>
      </Card>
      
      {/* 新增字段弹窗 */}
      <Modal
        title="新增字段"
        open={isAddFieldModalVisible}
        onCancel={() => setIsAddFieldModalVisible(false)}
        footer={[
          <Button key="cancel" onClick={() => setIsAddFieldModalVisible(false)}>取消</Button>,
          <Button key="submit" type="primary" onClick={() => {
            // 这里简化处理，实际应该有更完整的表单验证和提交逻辑
            message.success('字段已添加');
            setIsAddFieldModalVisible(false);
            fieldForm.resetFields();
          }}>确定</Button>
        ]}
      >
        <Form form={fieldForm} layout="vertical">
          <Form.Item label="字段名称" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="数据类型" name="type" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="长度" name="length">
            <InputNumber />
          </Form.Item>
          <Form.Item label="小数点" name="decimal">
            <InputNumber />
          </Form.Item>
          <Form.Item label="不为空" name="notNull" valuePropName="checked">
            <Select>
              <Option value={true}>是</Option>
              <Option value={false}>否</Option>
            </Select>
          </Form.Item>
          <Form.Item label="注释" name="comment">
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
      
      {/* 其他新增弹窗类似实现，这里简化处理 */}
    </div>
  );
};

export default TableStructurePanel;