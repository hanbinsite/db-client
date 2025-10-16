import React from 'react';
import { Form, Input, InputNumber, Select, Switch, DatePicker, TimePicker } from 'antd';
import type { Dayjs } from 'dayjs';
import type { Rule } from 'antd/es/form';

interface DbFieldFormItemProps {
  column: {
    title: string;
    dataIndex: string;
    key: string;
    type?: string;
    dbType: string;
    editable?: boolean;
  };
  databaseType: 'mysql' | 'postgresql' | 'sqlite' | 'oracle' | 'mssql';
}

/**
 * 根据数据库类型和字段类型渲染不同的表单控件组件
 */
const DbFieldFormItem: React.FC<DbFieldFormItemProps> = ({ column, databaseType }) => {
  const { title, dataIndex, dbType } = column;
  
  // 根据数据库类型和字段类型获取合适的表单控件和验证规则
  const getFormControl = () => {
    let inputComponent = <Input />;
    let rules: Rule[] = [];
    
    // 根据数据库类型和字段类型选择合适的输入控件
    // 通用类型处理
    // 数字类型
    if (dbType.includes('int') || dbType.includes('decimal') || 
        dbType.includes('float') || dbType.includes('double') || 
        dbType.includes('numeric') || dbType.includes('real')) {
      inputComponent = <InputNumber style={{ width: '100%' }} placeholder="请输入数字" />;
      rules = [{ required: false, message: `请输入有效的数字` }];
    }
    // 文本类型 (长文本)
    else if (dbType.includes('text') || dbType.includes('blob') || 
             dbType.includes('clob') || dbType.includes('ntext')) {
      inputComponent = <Input.TextArea rows={4} placeholder="请输入文本内容" />;
      rules = [{ required: false, message: `请输入${title}` }];
    }
    // 日期类型
    else if (dbType.includes('date')) {
      inputComponent = <DatePicker style={{ width: '100%' }} placeholder="请选择日期" />;
      rules = [{ required: false, message: `请选择日期` }];
    }
    // 日期时间类型
    else if (dbType.includes('datetime') || dbType.includes('timestamp') || 
             dbType.includes('smalldatetime')) {
      inputComponent = <DatePicker showTime style={{ width: '100%' }} placeholder="请选择日期时间" />;
      rules = [{ required: false, message: `请选择日期时间` }];
    }
    // 布尔类型
    else if (dbType.includes('bool') || dbType.includes('boolean')) {
      inputComponent = <Switch checkedChildren="是" unCheckedChildren="否" />;
      rules = [];
    }
    // 时间类型
    else if (dbType.includes('time')) {
      inputComponent = <TimePicker style={{ width: '100%' }} placeholder="请选择时间" />;
      rules = [{ required: false, message: `请选择时间` }];
    }
    // 邮箱类型（特殊处理）
    else if (dataIndex?.toLowerCase() === 'email') {
      inputComponent = <Input type="email" placeholder="请输入邮箱地址" />;
      rules = [{ required: false, type: 'email', message: `请输入有效的邮箱地址` }];
    }
    // 枚举类型处理 (MySQL和PostgreSQL有不同的枚举语法)
    else if (dbType.includes('enum') || dbType.includes('"enum"') || 
             (databaseType === 'postgresql' && dbType.includes('enum_'))) {
      // 尝试从dbType中提取枚举值
      let enumValues: string[] = [];
      
      if (databaseType === 'mysql') {
        const enumValuesMatch = dbType.match(/enum\(([^)]+)\)/);
        if (enumValuesMatch && enumValuesMatch[1]) {
          enumValues = enumValuesMatch[1].split(',').map(v => v.trim().replace(/'/g, ''));
        }
      } else if (databaseType === 'postgresql') {
        // PostgreSQL枚举通常是自定义类型，这里我们假设有一个简单的方式获取枚举值
        // 实际应用中可能需要通过查询系统表获取枚举值
        enumValues = []; // 这里应该从数据库中查询枚举值
      }
      
      if (enumValues.length > 0) {
        inputComponent = (
          <Select placeholder={`请选择${title}`}>
            {enumValues.map(value => (
              <Select.Option key={value} value={value}>{value}</Select.Option>
            ))}
          </Select>
        );
      } else {
        // 如果无法提取枚举值，使用普通文本框
        inputComponent = <Input placeholder={`请输入${title}`} />;
      }
      rules = [{ required: false, message: `请选择${title}` }];
    }
    // 默认文本框（如varchar, char等）
    else {
      inputComponent = <Input placeholder={`请输入${title}`} />;
      rules = [{ required: false, message: `请输入${title}` }];
    }
    
    return { inputComponent, rules };
  };
  
  const { inputComponent, rules } = getFormControl();
  
  return (
    <Form.Item
      key={dataIndex}
      label={title}
      name={dataIndex}
      rules={rules}
      tooltip={`类型: ${dbType}`}
    >
      {inputComponent}
    </Form.Item>
  );
};

export default DbFieldFormItem;