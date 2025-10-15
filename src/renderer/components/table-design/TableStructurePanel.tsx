import React, { useState, useRef } from 'react';
import { Tabs, Card, Button, Table, Input, InputNumber, Form, Modal, message, Tooltip, Checkbox, Select } from 'antd';
import type { InputRef } from 'antd';
import { 
  PlusOutlined, 
  DeleteOutlined, 
  CopyOutlined, 
  DatabaseOutlined, 
  KeyOutlined, 
  LinkOutlined, 
  LeftCircleOutlined, 
  CodeOutlined, 
  AlignLeftOutlined, 
  ArrowUpOutlined, 
  ArrowDownOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined
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
  getProgressiveTableStructureWithRetry,
  ProgressiveTableStructureResult,
  TableStructureLoadingStatus,
  TableStructureDataType,
  checkTableExists, 
  getDefaultField
} from '../utils/table-structure-utils';

interface TableStructurePanelProps {
  connection: DatabaseConnection | null;
  database: string;
  table: string;
}

const { Option } = Select;
const { TextArea } = Input;

const TableStructurePanel: React.FC<TableStructurePanelProps> = ({ connection, database, table }) => {
  // 状态管理
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<TableField[]>([]);
  const [indexes, setIndexes] = useState<TableIndex[]>([]);
  const [foreignKeys, setForeignKeys] = useState<TableForeignKey[]>([]);
  const [checks, setChecks] = useState<TableCheck[]>([]);
  const [triggers, setTriggers] = useState<TableTrigger[]>([]);
  const [options, setOptions] = useState<TableOptions>({});
  
  // 细化的加载状态（优化体验）
  const [loadingStatus, setLoadingStatus] = useState<TableStructureLoadingStatus>({
    fields: false,
    indexes: false,
    foreignKeys: false,
    checks: false,
    triggers: false,
    options: false,
    comment: false
  });
  
  // 用于跟踪每个数据类型的错误信息
  const [dataTypeErrors, setDataTypeErrors] = useState<Record<TableStructureDataType, string | null>>({
    fields: null,
    indexes: null,
    foreignKeys: null,
    checks: null,
    triggers: null,
    options: null,
    comment: null
  });
  // 表注释状态，使用默认的占位符文本初始化
  const [tableComment, setTableComment] = useState<string>('表注释信息');
  const [sqlPreview, setSqlPreview] = useState('');
  const [isEditMode, setIsEditMode] = useState(false);
  const [isAddFieldModalVisible, setIsAddFieldModalVisible] = useState(false);
  const [isAddIndexModalVisible, setIsAddIndexModalVisible] = useState(false);
  const [isAddForeignKeyModalVisible, setIsAddForeignKeyModalVisible] = useState(false);
  const [isAddCheckModalVisible, setIsAddCheckModalVisible] = useState(false);
  const [isAddTriggerModalVisible, setIsAddTriggerModalVisible] = useState(false);
  const [isCommentModalVisible, setIsCommentModalVisible] = useState(false);
  
  // 行内编辑相关状态
  const [currentEditCell, setCurrentEditCell] = useState<{ field: string; rowIndex: number } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [currentCommentRecord, setCurrentCommentRecord] = useState<TableField | null>(null);
  const [currentComment, setCurrentComment] = useState('');
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null);
  
  const editCellRef = useRef<any>(null);
  
  // 表单实例
  const [fieldForm] = Form.useForm();
  const [indexForm] = Form.useForm();
  const [foreignKeyForm] = Form.useForm();
  const [checkForm] = Form.useForm();
  const [triggerForm] = Form.useForm();
  const [optionsForm] = Form.useForm();
  
  // 数据库类型常用字段类型映射（全部小写）
  const databaseTypeMap: Record<string, string[]> = {
    mysql: [
      'varchar', 'char', 'text', 'longtext', 'mediumtext', 'tinytext',
      'int', 'bigint', 'smallint', 'tinyint', 'mediumint',
      'float', 'double', 'decimal',
      'date', 'datetime', 'timestamp', 'time', 'year',
      'boolean', 'bit', 'blob', 'enum', 'set', 'json'
    ],
    oracle: [
      'varchar2', 'char', 'clob', 'nclob', 'long',
      'number', 'integer', 'pls_integer', 'binary_integer',
      'date', 'timestamp', 'interval day to second', 'interval year to month',
      'blob', 'bfile', 'raw', 'long raw',
      'boolean', 'json', 'xmltype'
    ],
    postgresql: [
      'varchar', 'char', 'text', 'name',
      'integer', 'bigint', 'smallint', 'tinyint',
      'real', 'double precision', 'decimal', 'numeric',
      'date', 'time', 'timestamp', 'interval',
      'boolean', 'bytea', 'json', 'jsonb', 'xml',
      'array', 'enum', 'uuid', 'inet', 'cidr'
    ],
    gaussdb: [
      'varchar', 'char', 'text', 'name',
      'integer', 'bigint', 'smallint', 'tinyint',
      'real', 'double precision', 'decimal', 'numeric',
      'date', 'time', 'timestamp', 'interval',
      'boolean', 'bytea', 'json', 'jsonb', 'xml',
      'array', 'enum', 'uuid', 'inet', 'cidr'
    ],
    sqlite: [
      'text', 'integer', 'real', 'blob', 'numeric'
    ],
    redis: ['string', 'list', 'set', 'zset', 'hash', 'bitmap', 'hyperloglog', 'geo', 'stream']
  };


  
  // 获取当前数据库的常用字段类型
  const getCurrentDatabaseTypes = () => {
    if (!connection) return [];
    return databaseTypeMap[connection.type] || databaseTypeMap.mysql;
  };
  
  // 判断字段类型是否需要长度
  const needLength = (type: string) => {
    // 对于MySQL等数据库，以下类型都可以有长度配置
    const typesWithLength = [
      'varchar', 'char', 'nvarchar', 'nchar', 'varbinary', 'binary',
      'int', 'bigint', 'smallint', 'tinyint', 'mediumint',
      'decimal', 'numeric', 'float', 'double', 'real'
    ];
    return typesWithLength.some(t => 
      type.toLowerCase().startsWith(t) || type.toLowerCase() === t
    );
  };
  
  // 判断字段类型是否需要小数位
  const needDecimal = (type: string) => {
    return ['DECIMAL', 'NUMERIC', 'FLOAT', 'DOUBLE', 'REAL'].some(t => 
      type.toUpperCase().startsWith(t) || type.toUpperCase() === t
    );
  };
  
  // 处理不是null字段变更
  const handleNotNullChange = (checked: boolean, record: TableField) => {
    const updatedFields = fields.map((field, index) => {
      if (field.name === record.name) {
        return { ...field, notNull: checked };
      }
      return field;
    });
    setFields(updatedFields);
    generateSqlPreview(updatedFields);
  };

  // 处理类型编辑开始
  const handleTypeEditStart = (record: TableField, rowIndex: number) => {
    if (!isEditMode) return;
    setCurrentEditCell({ field: 'type', rowIndex });
    setEditValue(record.type);
    setTimeout(() => {
      editCellRef.current?.focus();
    }, 0);
  };
  
  // 处理类型编辑完成
  const handleTypeEditFinish = () => {
    if (currentEditCell) {
      const { rowIndex } = currentEditCell;
      const newFields = [...fields];
      newFields[rowIndex].type = editValue;
      setFields(newFields);
      generateSqlPreview(newFields);
    }
    setCurrentEditCell(null);
  };
  
  // 处理类型编辑取消
  const handleTypeEditCancel = () => {
    setCurrentEditCell(null);
  };
  
  // 处理字段编辑开始
  const handleFieldEditStart = (record: TableField, rowIndex: number, fieldName: string) => {
    if (!isEditMode) return;
    setCurrentEditCell({ field: fieldName, rowIndex });
    setEditValue((record as any)[fieldName]?.toString() || '');
    setTimeout(() => {
      editCellRef.current?.focus();
    }, 0);
  };
  
  // 处理字段编辑完成
  const handleFieldEditFinish = () => {
    if (currentEditCell) {
      const { field, rowIndex } = currentEditCell;
      const newFields = [...fields];
      
      // 类型转换
      if (field === 'length' || field === 'decimal' || field === 'autoIncrement') {
        (newFields[rowIndex] as any)[field] = editValue ? parseInt(editValue, 10) : null;
      } else if (field === 'defaultValue') {
        (newFields[rowIndex] as any)[field] = editValue || null;
      } else {
        (newFields[rowIndex] as any)[field] = editValue;
      }
      
      setFields(newFields);
      generateSqlPreview(newFields);
    }
    setCurrentEditCell(null);
  };
  
  // 处理字段编辑取消
  const handleFieldEditCancel = () => {
    setCurrentEditCell(null);
  };
  
  // 处理注释编辑
  const handleCommentEdit = (record: TableField) => {
    setCurrentCommentRecord(record);
    setCurrentComment(record.comment || '');
    setIsCommentModalVisible(true);
  };
  
  // 处理注释保存
  const handleCommentSave = () => {
    if (currentCommentRecord) {
      const updatedFields = fields.map(field => 
        field.name === currentCommentRecord.name ? { ...field, comment: currentComment } : field
      );
      
      setFields(updatedFields);
      generateSqlPreview(updatedFields);
      message.success('注释已保存');
      setIsCommentModalVisible(false);
      setCurrentCommentRecord(null);
      setCurrentComment('');
    }
  };
  
  // 处理删除字段
  const handleDeleteField = (fieldName: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除字段 ${fieldName} 吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        const newFields = fields.filter(field => field.name !== fieldName);
        setFields(newFields);
        setSelectedRowIndex(null);
        generateSqlPreview(newFields);
        message.success(`字段 ${fieldName} 已删除`);
      }
    });
  };
  
  // 处理删除索引
  const handleDeleteIndex = (indexName: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除索引 ${indexName} 吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        setIndexes(indexes.filter(index => index.name !== indexName));
        message.success(`索引 ${indexName} 已删除`);
      }
    });
  };
  
  // 处理删除外键
  const handleDeleteForeignKey = (fkName: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除外键 ${fkName} 吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        setForeignKeys(foreignKeys.filter(fk => fk.name !== fkName));
        message.success(`外键 ${fkName} 已删除`);
      }
    });
  };
  
  // 处理删除检查约束
  const handleDeleteCheck = (checkName: string) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除检查约束 ${checkName} 吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: () => {
        setChecks(checks.filter(check => check.name !== checkName));
        message.success(`检查约束 ${checkName} 已删除`);
      }
    });
  };
  
  // 处理删除触发器
  const handleDeleteTrigger = (name: string) => {
    setTriggers(triggers.filter(trigger => trigger.name !== name));
    message.success('触发器已删除');
  };
  
  // 处理保存选项
  const handleSaveOptions = () => {
    message.success('表选项已保存');
  };
  
  // 处理复制SQL预览
  const handleCopySqlPreview = () => {
    navigator.clipboard.writeText(sqlPreview).then(() => {
      message.success('SQL已复制到剪贴板');
    });
  };
  
  // 保存表注释
  const handleSaveTableComment = async () => {
    if (!connection || !connection.isConnected || !database || !table) {
      message.warning('未连接到数据库，无法保存表注释');
      return;
    }

    try {
      setLoading(true);
      
      // 这里应该调用API来保存表注释
      console.log('保存表注释:', tableComment);
      
      // 模拟保存成功
      message.success('表注释保存成功');
      generateSqlPreview(fields);
    } catch (error) {
      console.error('保存表注释失败:', error);
      message.error('保存表注释失败: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };
  
  // 处理渐进式加载的部分结果
  const handlePartialResult = (result: ProgressiveTableStructureResult) => {
    if (!result || !result.data) {
      return;
    }

    const { data, loadingStatus: partialLoadingStatus, error: partialError, completedTypes } = result;
    
    // 更新加载状态
    if (partialLoadingStatus) {
      setLoadingStatus(prev => ({ ...prev, ...partialLoadingStatus }));
    }
    
    // 无条件更新数据 - 这是修复索引数据不显示的关键
    if (data.fields !== undefined) {
      setFields(data.fields || []);
    }
    
    if (data.indexes !== undefined) {
      setIndexes(data.indexes || []);
    }
    
    if (data.foreignKeys !== undefined) {
      setForeignKeys(data.foreignKeys || []);
    }
    
    if (data.checks !== undefined) {
      setChecks(data.checks || []);
    }
    
    if (data.triggers !== undefined) {
      setTriggers(data.triggers || []);
    }
    
    if (data.options !== undefined) {
      setOptions(data.options || {});
      // 更新表选项表单
      if (data.options) {
        optionsForm.setFieldsValue(data.options);
      }
    }
    
    if (data.comment !== undefined) {
      console.log(`TableStructurePanel - 处理表注释数据: ${data.comment || '空字符串'}`);
      setTableComment(data.comment || '');
    }
    
    // 只要字段数据加载完成，就生成SQL预览
    if (data.fields !== undefined) {
      generateSqlPreview(data.fields);
    }
    
    // 如果有错误，记录具体的数据类型错误
    if (partialError) {
      // 确定是哪个数据类型的错误
      const errorDataTypeMatch = partialError.match(/处理(\w+)数据时出错/);
      if (errorDataTypeMatch && errorDataTypeMatch[1]) {
        const dataType = errorDataTypeMatch[1].toLowerCase() as TableStructureDataType;
        setDataTypeErrors(prev => ({ ...prev, [dataType]: partialError }));
      } else if (completedTypes && completedTypes.length > 0) {
        // 如果没有明确的错误类型，但有完成的类型，使用最后一个完成的类型
        const lastCompletedType = completedTypes[completedTypes.length - 1];
        setDataTypeErrors(prev => ({ ...prev, [lastCompletedType]: partialError }));
      } else {
        // 显示通用错误消息但不覆盖已加载的数据
        console.error('表结构数据加载错误:', partialError);
      }
    }
  };
  
  // 加载表结构信息（优化版）
  const loadTableStructure = async () => {
    if (!connection || !database || !table || !connection.isConnected) {
      return;
    }
    
    setLoading(true);
    // 重置加载状态和错误信息
    setLoadingStatus({
      fields: true,
      indexes: true,
      foreignKeys: true,
      checks: true,
      triggers: true,
      options: true,
      comment: true
    });
    setDataTypeErrors({
      fields: null,
      indexes: null,
      foreignKeys: null,
      checks: null,
      triggers: null,
      options: null,
      comment: null
    });
    
    try {
      // 先检查表格是否存在
      const tableExists = await checkTableExists(connection, database, table);
      if (!tableExists) {
        message.error(`表 ${database}.${table} 不存在`);
        return;
      }
      
      // 使用新的渐进式加载函数，优先加载字段、索引、外键和表注释
      const tableStructureResult = await getProgressiveTableStructureWithRetry(
        connection, 
        database, 
        table,
        handlePartialResult, // 部分结果回调
        ['fields', 'indexes', 'foreignKeys', 'comment'] // 优先加载的数据类型，添加comment确保表注释优先加载
      );
      
      // 处理最终结果
      if (tableStructureResult.success && tableStructureResult.data) {
        const { data } = tableStructureResult;
        
        // 确保所有数据都被更新
        if (data.fields) setFields(data.fields);
        if (data.indexes) setIndexes(data.indexes);
        if (data.foreignKeys) setForeignKeys(data.foreignKeys);
        if (data.checks) setChecks(data.checks);
        if (data.triggers) setTriggers(data.triggers);
        if (data.options) {
          setOptions(data.options);
          if (optionsForm) {
            optionsForm.setFieldsValue(data.options);
          }
        }
        if (data.comment !== undefined) setTableComment(data.comment);
        
        // 生成SQL预览
        if (data.fields) {
          generateSqlPreview(data.fields);
        }
      }
      
      if (!tableStructureResult.success) {
        message.error(`获取表结构信息失败: ${tableStructureResult.error || '未知错误'}`);
        
        // 保留已加载的部分数据，而不是全部清空
        console.warn('表结构加载不完全，保留已加载的数据');
      }
    } catch (error) {
      message.error('加载表结构失败: ' + (error as Error).message);
      console.error('表结构加载异常:', error);
      // 保留已加载的部分数据
    } finally {
      setLoading(false);
      // 确保所有加载状态都设置为false
      setLoadingStatus({
        fields: false,
        indexes: false,
        foreignKeys: false,
        checks: false,
        triggers: false,
        options: false,
        comment: false
      });
    }
  };
  
  // 生成SQL预览
  const generateSqlPreview = (currentFields: TableField[]) => {
    let sql = `-- 修改表 ${database}.${table} 的SQL预览\n`;
    sql += `-- 生成时间: ${new Date().toLocaleString()}\n\n`;
    
    // 生成字段修改SQL
    currentFields.forEach(field => {
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
  
  // 处理字段上移
  const handleMoveUp = () => {
    if (selectedRowIndex !== null && selectedRowIndex > 0) {
      const newFields = [...fields];
      // 交换位置
      [newFields[selectedRowIndex], newFields[selectedRowIndex - 1]] = [newFields[selectedRowIndex - 1], newFields[selectedRowIndex]];
      setFields(newFields);
      setSelectedRowIndex(selectedRowIndex - 1);
      generateSqlPreview(newFields);
    }
  };
  
  // 处理字段下移
  const handleMoveDown = () => {
    if (selectedRowIndex !== null && selectedRowIndex < fields.length - 1) {
      const newFields = [...fields];
      // 交换位置
      [newFields[selectedRowIndex], newFields[selectedRowIndex + 1]] = [newFields[selectedRowIndex + 1], newFields[selectedRowIndex]];
      setFields(newFields);
      setSelectedRowIndex(selectedRowIndex + 1);
      generateSqlPreview(newFields);
    }
  };
  
  // 直接在列表尾部新增字段
  const handleAddField = () => {
    if (!isEditMode) return;
    
    const newField = getDefaultField();
    const newFields = [...fields, newField];
    setFields(newFields);
    setSelectedRowIndex(newFields.length - 1);
    generateSqlPreview(newFields);
    message.success('字段已添加');
    
    // 延迟触发编辑状态，确保DOM已更新
    setTimeout(() => {
      setCurrentEditCell({ field: 'name', rowIndex: newFields.length - 1 });
      setEditValue('');
      setTimeout(() => {
        editCellRef.current?.focus();
      }, 0);
    }, 0);
  };
  
  // 行选择配置
  const rowSelection = {
    type: 'radio' as const,
    selectedRowKeys: selectedRowIndex !== null ? [selectedRowIndex] : [],
    onChange: (selectedRowKeys: React.Key[]) => {
      setSelectedRowIndex(selectedRowKeys.length > 0 ? Number(selectedRowKeys[0]) : null);
    },
  };
  
  // 字段表格列配置
  const fieldColumns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 150,
      render: (text: string, record: TableField, index: number) => {
        if (currentEditCell && currentEditCell.field === 'name' && currentEditCell.rowIndex === index) {
          return (
            <Input
              ref={editCellRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onPressEnter={handleFieldEditFinish}
              onBlur={handleFieldEditFinish}
              onKeyDown={(e) => e.key === 'Escape' && handleFieldEditCancel()}
              autoFocus
            />
          );
        }
        return (
          <div onClick={() => handleFieldEditStart(record, index, 'name')} style={{ cursor: 'pointer' }}>
            {text}
          </div>
        );
      },
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 120,
      render: (text: string, record: TableField, index: number) => {
        if (currentEditCell && currentEditCell.field === 'type' && currentEditCell.rowIndex === index) {
          return (
            <Input
              ref={editCellRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onPressEnter={handleTypeEditFinish}
              onBlur={handleTypeEditFinish}
              onKeyDown={(e) => e.key === 'Escape' && handleTypeEditCancel()}
              autoFocus
            />
          );
        }
        return (
          <div onClick={() => handleTypeEditStart(record, index)} style={{ cursor: 'pointer' }}>
            {text}
          </div>
        );
      },
    },
    {
      title: '长度',
      dataIndex: 'length',
      key: 'length',
      width: 100,
      render: (text: number | null, record: TableField, index: number) => {
        if (!needLength(record.type)) {
          return null;
        }
        if (currentEditCell && currentEditCell.field === 'length' && currentEditCell.rowIndex === index) {
          return (
            <InputNumber
              ref={editCellRef}
              value={editValue ? parseInt(editValue, 10) : null}
              onChange={(value) => setEditValue(value?.toString() || '')}
              onPressEnter={handleFieldEditFinish}
              onBlur={handleFieldEditFinish}
              onKeyDown={(e) => e.key === 'Escape' && handleFieldEditCancel()}
              min={1}
              style={{ width: '100%' }}
            />
          );
        }
        return (
          <div onClick={() => handleFieldEditStart(record, index, 'length')} style={{ cursor: 'pointer' }}>
            {text || ''}
          </div>
        );
      },
    },
    {
      title: '小数点',
      dataIndex: 'decimal',
      key: 'decimal',
      width: 100,
      render: (text: number | null, record: TableField, index: number) => {
        if (!needDecimal(record.type)) {
          return null;
        }
        if (currentEditCell && currentEditCell.field === 'decimal' && currentEditCell.rowIndex === index) {
          return (
            <InputNumber
              ref={editCellRef}
              value={editValue ? parseInt(editValue, 10) : null}
              onChange={(value) => setEditValue(value?.toString() || '')}
              onPressEnter={handleFieldEditFinish}
              onBlur={handleFieldEditFinish}
              onKeyDown={(e) => e.key === 'Escape' && handleFieldEditCancel()}
              min={0}
              style={{ width: '100%' }}
            />
          );
        }
        return (
          <div onClick={() => handleFieldEditStart(record, index, 'decimal')} style={{ cursor: 'pointer' }}>
            {text || ''}
          </div>
        );
      },
    },
    {
      title: '不是null',
      dataIndex: 'notNull',
      key: 'notNull',
      width: 100,
      render: (text: boolean, record: TableField) => (
        <Checkbox
          checked={text}
          onChange={(e) => handleNotNullChange(e.target.checked, record)}
          disabled={!isEditMode}
        />
      ),
    },
    {
      title: '虚拟',
      dataIndex: 'virtual',
      key: 'virtual',
      width: 100,
      render: (text: boolean | undefined) => (
        <Checkbox
          checked={!!text}
          disabled={!isEditMode}
        />
      ),
    },
    {
      title: '键',
      dataIndex: 'key',
      key: 'key',
      width: 100,
      render: (text: string | null, record: TableField) => {
        if (record.key === 'PRI') {
          return 'PRI';
        } else if (record.key === 'UNI') {
          return 'UNI';
        } else if (record.key === 'MUL') {
          return 'MUL';
        }
        return '';
      },
    },
    {
      title: '注释',
      dataIndex: 'comment',
      key: 'comment',
      width: 200,
      render: (text: string | null, record: TableField) => (
        <Tooltip title="点击编辑注释">
          <div onClick={() => handleCommentEdit(record)} style={{ cursor: 'pointer', color: '#1890ff' }}>
            {text || <span style={{ color: '#d9d9d9' }}>点击添加注释</span>}
          </div>
        </Tooltip>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (text: string, record: TableField) => (
        <Button 
          type="text" 
          danger 
          icon={<DeleteOutlined />} 
          size="small" 
          onClick={() => handleDeleteField(record.name)}
          disabled={!isEditMode || record.key === 'PRI'}
        >
          删除
        </Button>
      ),
    },
  ];
  
  // 索引表格列配置
  const indexColumns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 180,
      render: (text: any, record: TableIndex) => {
        return record.name || '-';
      },
    },
    {
      title: '字段',
      dataIndex: 'columns',
      key: 'columns',
      width: 250,
      render: (columns: string[]) => columns?.map(col => `\`${col}\``).join(', ') || '-',
    },
    {
      title: '索引类型',
      key: 'indexType',
      width: 120,
      render: (text: any, record: TableIndex) => {
        // 直接展示原始索引类型
        return record.type || '-';
      },
    },
    {
      title: '索引方法',
      key: 'indexMethod',
      width: 120,
      render: (text: any, record: TableIndex) => {
        // 优先使用新添加的method字段显示索引方法
        if (record.method) {
          return record.method;
        }
        // 对于MySQL，如果没有method字段，根据索引类型信息提取索引方法
        else if (connection?.type === 'mysql' && record.type) {
          const normalizedType = record.type.toUpperCase();
          // 检查是否包含索引方法关键字
          if (normalizedType.includes('BTREE')) return 'BTREE';
          if (normalizedType.includes('HASH')) return 'HASH';
          // MySQL默认使用BTREE
          return 'BTREE';
        }
        // 对于其他情况，返回'-'
        return '-';
      },
    },
    {
      title: '注释',
      dataIndex: 'comment',
      key: 'comment',
      width: 250,
      render: (comment: string) => comment || '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (text: string, record: TableIndex) => (
        <Button 
          type="text" 
          danger 
          icon={<DeleteOutlined />} 
          size="small" 
          onClick={() => handleDeleteIndex(record.name)}
          disabled={!isEditMode}
        >
          删除
        </Button>
      ),
    },
  ];
  
  // 外键表格列配置
  const foreignKeyColumns = [
    {
      title: '约束名称',
      dataIndex: 'name',
      key: 'name',
      width: 150,
    },
    {
      title: '字段',
      dataIndex: 'columns',
      key: 'columns',
      width: 150,
      render: (columns: string[]) => columns.join(', '),
    },
    {
      title: '引用表',
      dataIndex: 'referencedTable',
      key: 'referencedTable',
      width: 150,
    },
    {
      title: '引用字段',
      dataIndex: 'referencedColumns',
      key: 'referencedColumns',
      width: 150,
      render: (columns: string[]) => columns.join(', '),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (text: string, record: TableForeignKey) => (
        <Button 
          type="text" 
          danger 
          icon={<DeleteOutlined />} 
          size="small" 
          onClick={() => handleDeleteForeignKey(record.name)}
          disabled={!isEditMode}
        >
          删除
        </Button>
      ),
    },
  ];
  
  // 检查约束表格列配置
  const checkColumns = [
    {
      title: '约束名称',
      dataIndex: 'name',
      key: 'name',
      width: 150,
    },
    {
      title: '表达式',
      dataIndex: 'expression',
      key: 'expression',
      width: 300,
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (text: string, record: TableCheck) => (
        <Button 
          type="text" 
          danger 
          icon={<DeleteOutlined />} 
          size="small" 
          onClick={() => handleDeleteCheck(record.name)}
          disabled={!isEditMode}
        >
          删除
        </Button>
      ),
    },
  ];
  
  // 触发器表格列配置
  const triggerColumns = [
    {
      title: '触发器名称',
      dataIndex: 'name',
      key: 'name',
      width: 150,
    },
    {
      title: '事件',
      dataIndex: 'event',
      key: 'event',
      width: 100,
    },
    {
      title: '时机',
      dataIndex: 'timing',
      key: 'timing',
      width: 100,
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (text: string, record: TableTrigger) => (
        <Button 
          type="text" 
          danger 
          icon={<DeleteOutlined />} 
          size="small" 
          onClick={() => handleDeleteTrigger(record.name)}
          disabled={!isEditMode}
        >
          删除
        </Button>
      ),
    },
  ];
  
  // 刷新特定类型的数据
  const refreshDataType = async (dataType: TableStructureDataType) => {
    if (!connection || !database || !table || !connection.isConnected) {
      return;
    }

    // 设置指定类型的加载状态为true
    setLoadingStatus(prev => ({ ...prev, [dataType]: true }));
    // 清除对应类型的错误信息
    setDataTypeErrors(prev => ({ ...prev, [dataType]: null }));

    try {
      // 使用渐进式加载函数，但只请求特定类型的数据
      await getProgressiveTableStructureWithRetry(
        connection,
        database,
        table,
        handlePartialResult,
        [dataType]
      );
    } catch (error) {
      console.error(`刷新${dataType}数据失败:`, error);
      setDataTypeErrors(prev => ({
        ...prev,
        [dataType]: `刷新${dataType}数据失败: ${(error as Error).message}`
      }));
    } finally {
      // 设置指定类型的加载状态为false
      setLoadingStatus(prev => ({ ...prev, [dataType]: false }));
    }
  };

  // 加载表结构数据
  React.useEffect(() => {
    if (connection && database && table && connection.isConnected) {
      loadTableStructure();
    }
  }, [connection, database, table]);
  
  return (
    <div style={{ padding: 24 }}>
      <Card title="表结构设计" extra={<Button type="primary" onClick={() => setIsEditMode(!isEditMode)}>{isEditMode ? '退出编辑' : '编辑表结构'}</Button>}>
        <Tabs defaultActiveKey="fields" type="card">
          <Tabs.TabPane key="fields" icon={<DatabaseOutlined />} tab="字段">
            {dataTypeErrors.fields && (
              <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 4 }}>
                <div style={{ color: '#f5222d', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ExclamationCircleOutlined />
                  <span>{dataTypeErrors.fields}</span>
                </div>
              </div>
            )}
            
            <div style={{ marginTop: 16, marginBottom: 16, display: 'flex', gap: 12, justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <Button 
                  type="primary" 
                  icon={<PlusOutlined />}
                  onClick={handleAddField}
                  disabled={!isEditMode}
                >
                  新增字段
                </Button>
                
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button 
                    icon={<ArrowUpOutlined />}
                    onClick={handleMoveUp}
                    disabled={!isEditMode || selectedRowIndex === null || selectedRowIndex === 0}
                  >
                    上移
                  </Button>
                  <Button 
                    icon={<ArrowDownOutlined />}
                    onClick={handleMoveDown}
                    disabled={!isEditMode || selectedRowIndex === null || selectedRowIndex === fields.length - 1}
                  >
                    下移
                  </Button>
                </div>
              </div>
              
              <Button 
                icon={<ReloadOutlined />}
                onClick={() => refreshDataType('fields')}
                loading={loadingStatus.fields}
              >
                刷新
              </Button>
            </div>
            
            <Table 
              columns={fieldColumns} 
              dataSource={fields} 
              pagination={false} 
              rowKey="name"
              size="small"
              loading={loadingStatus.fields}
              scroll={{ x: 'max-content', y: 'calc(100vh - 430px)' }}
              style={{ border: '1px solid #f0f0f0' }}
              rowSelection={rowSelection}
              onRow={(record, index) => ({
                onClick: () => {
                  setSelectedRowIndex(index !== undefined ? index : null);
                },
              })}
            />
          </Tabs.TabPane>
          
          <Tabs.TabPane key="indexes" icon={<KeyOutlined />} tab="索引">
            {dataTypeErrors.indexes && (
              <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 4 }}>
                <div style={{ color: '#f5222d', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ExclamationCircleOutlined />
                  <span>{dataTypeErrors.indexes}</span>
                </div>
              </div>
            )}
            
            <div style={{ marginTop: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => setIsAddIndexModalVisible(true)}
                disabled={!isEditMode}
              >
                新增索引
              </Button>
              
              <Button 
                icon={<ReloadOutlined />}
                onClick={() => refreshDataType('indexes')}
                loading={loadingStatus.indexes}
              >
                刷新
              </Button>
            </div>
            <Table 
              columns={indexColumns} 
              dataSource={indexes} 
              pagination={false} 
              rowKey="name"
              size="small"
              loading={loadingStatus.indexes}
              scroll={{ x: 'max-content', y: 'calc(100vh - 430px)' }}
              style={{ border: '1px solid #f0f0f0' }}
            />
          </Tabs.TabPane>
          
          <Tabs.TabPane key="foreignKeys" icon={<LinkOutlined />} tab="外键">
            {dataTypeErrors.foreignKeys && (
              <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 4 }}>
                <div style={{ color: '#f5222d', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ExclamationCircleOutlined />
                  <span>{dataTypeErrors.foreignKeys}</span>
                </div>
              </div>
            )}
            
            <div style={{ marginTop: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => setIsAddForeignKeyModalVisible(true)}
                disabled={!isEditMode}
              >
                新增外键
              </Button>
              
              <Button 
                icon={<ReloadOutlined />}
                onClick={() => refreshDataType('foreignKeys')}
                loading={loadingStatus.foreignKeys}
              >
                刷新
              </Button>
            </div>
            <Table 
              columns={foreignKeyColumns} 
              dataSource={foreignKeys} 
              pagination={false} 
              rowKey="name"
              size="small"
              loading={loadingStatus.foreignKeys}
              scroll={{ x: 'max-content', y: 'calc(100vh - 530px)' }}
              style={{ border: '1px solid #f0f0f0' }}
            />
          </Tabs.TabPane>
          
          <Tabs.TabPane key="checks" icon={<LeftCircleOutlined />} tab="检查">
            {dataTypeErrors.checks && (
              <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 4 }}>
                <div style={{ color: '#f5222d', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ExclamationCircleOutlined />
                  <span>{dataTypeErrors.checks}</span>
                </div>
              </div>
            )}
            
            <div style={{ marginTop: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => setIsAddCheckModalVisible(true)}
                disabled={!isEditMode}
              >
                新增检查约束
              </Button>
              
              <Button 
                icon={<ReloadOutlined />}
                onClick={() => refreshDataType('checks')}
                loading={loadingStatus.checks}
              >
                刷新
              </Button>
            </div>
            <Table 
              columns={checkColumns} 
              dataSource={checks} 
              pagination={false} 
              rowKey="name"
              size="small"
              loading={loadingStatus.checks}
              scroll={{ x: 'max-content', y: 'calc(100vh - 530px)' }}
              style={{ border: '1px solid #f0f0f0' }}
            />
          </Tabs.TabPane>
          
          <Tabs.TabPane key="triggers" icon={<CodeOutlined />} tab="触发器">
            {dataTypeErrors.triggers && (
              <div style={{ marginBottom: 16, padding: 12, backgroundColor: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 4 }}>
                <div style={{ color: '#f5222d', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ExclamationCircleOutlined />
                  <span>{dataTypeErrors.triggers}</span>
                </div>
              </div>
            )}
            
            <div style={{ marginTop: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between' }}>
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => setIsAddTriggerModalVisible(true)}
                disabled={!isEditMode}
              >
                新增触发器
              </Button>
              
              <Button 
                icon={<ReloadOutlined />}
                onClick={() => refreshDataType('triggers')}
                loading={loadingStatus.triggers}
              >
                刷新
              </Button>
            </div>
            <Table 
              columns={triggerColumns} 
              dataSource={triggers} 
              pagination={false} 
              rowKey="name"
              size="small"
              loading={loadingStatus.triggers}
              scroll={{ x: 'max-content', y: 'calc(100vh - 530px)' }}
              style={{ border: '1px solid #f0f0f0' }}
            />
          </Tabs.TabPane>
          
          <Tabs.TabPane key="options" icon={<DatabaseOutlined />} tab="选项">
            <div style={{ marginTop: 16, marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <Button 
                icon={<ReloadOutlined />}
                onClick={() => refreshDataType('options')}
                loading={loadingStatus.options}
              >
                刷新
              </Button>
            </div>
            
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
              onChange={(e) => setTableComment(e.target.value)}
              rows={6}
              placeholder="输入表注释"
              disabled={!isEditMode}
              style={{ marginTop: '16px' }} // 增加顶部距离
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
      
      {/* 注释编辑弹窗 */}
      <Modal
        title="编辑注释"
        open={isCommentModalVisible}
        onCancel={() => {
          setIsCommentModalVisible(false);
          setCurrentCommentRecord(null);
          setCurrentComment('');
        }}
        footer={[
          <Button key="cancel" onClick={() => {
            setIsCommentModalVisible(false);
            setCurrentCommentRecord(null);
            setCurrentComment('');
          }}>取消</Button>,
          <Button key="submit" type="primary" onClick={handleCommentSave}>确定</Button>
        ]}
        width={600}
      >
        <TextArea
          value={currentComment}
          onChange={(e) => setCurrentComment(e.target.value)}
          rows={8}
          placeholder="输入字段注释"
        />
      </Modal>
    </div>
  );
};

export default TableStructurePanel;