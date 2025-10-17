import React, { useState, useEffect } from 'react';
import { Button, Table, Space, Modal, Form, Input, InputNumber, Select, message, Card, Pagination, Spin, Tooltip, Empty, Badge, Radio, Switch, DatePicker, TimePicker, Checkbox } from 'antd';
import type { Dayjs } from 'dayjs';
import DbFieldFormItem from './DbFieldFormItem';
import {
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  SearchOutlined,
  ReloadOutlined,
  DownloadOutlined,
  CopyOutlined,
  EyeOutlined,
  FilterOutlined,
  ColumnWidthOutlined,
    RestOutlined,
    ClearOutlined,
    CloseOutlined
} from '@ant-design/icons';
import { DatabaseConnection } from '../../types';
// ThemeContext导入已移除，因为该模块不存在
import './DataPanel.css';

const { Option } = Select;

interface DataPanelProps {
  connection: DatabaseConnection | null;
  database: string;
  tableName: string;
  darkMode?: boolean;
}

interface TableData {
  key: string;
  [key: string]: any;
}

const MySqlDataPanel: React.FC<DataPanelProps> = ({ connection, database, tableName, darkMode }) => {
  // 优先使用传入的darkMode属性，否则使用useTheme钩子获取
  const [data, setData] = useState<TableData[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(200);
  // 移除total状态，因为不再需要获取总行数
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<TableData | null>(null);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);

  const [form] = Form.useForm();
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set());
  const [isColumnMenuVisible, setIsColumnMenuVisible] = useState(false);
  const [isFilterMenuVisible, setIsFilterMenuVisible] = useState(false);
  const [fullTextModalVisible, setFullTextModalVisible] = useState(false);
  const [fullTextContent, setFullTextContent] = useState('');
  const [fullTextTitle, setFullTextTitle] = useState('');
  const [filterMode, setFilterMode] = useState<'builder' | 'text'>('builder'); // 'builder'创建工具模式，'text'文本模式
  const [customWhereClause, setCustomWhereClause] = useState(''); // 文本模式的自定义WHERE子句
  const [isViewMode, setIsViewMode] = useState(false);
  const [filterConfig, setFilterConfig] = useState<{
    [key: string]: { operator: string; value: string; value2?: string }
  }>({}); // 过滤条件配置

  
  // 打开显示完整内容的弹窗
  const openFullTextModal = (content: string, title: string) => {
    setFullTextContent(content);
    setFullTextTitle(title);
    setFullTextModalVisible(true);
  };
  
  // 根据字段类型获取可用的操作符
  const getAvailableOperators = (dbType?: string) => {
    const operators = [
      { label: '=', value: '=' },
      { label: '≠', value: '<>' },
      { label: '>', value: '>' },
      { label: '<', value: '<' },
      { label: '≥', value: '>=' },
      { label: '≤', value: '<=' },
      { label: 'LIKE', value: 'LIKE' },
      { label: 'NOT LIKE', value: 'NOT LIKE' },
      { label: 'IS NULL', value: 'IS NULL' },
      { label: 'IS NOT NULL', value: 'IS NOT NULL' }
    ];
    
    // 对于字符串类型，添加额外操作符
    if (dbType && (dbType.includes('char') || dbType.includes('text'))) {
      operators.push(
        { label: 'STARTS WITH', value: 'STARTS WITH' },
        { label: 'ENDS WITH', value: 'ENDS WITH' }
      );
    }
    
    // 对于所有类型，添加BETWEEN操作符
    operators.push(
      { label: 'BETWEEN', value: 'BETWEEN' }
    );
    
    return operators;
  };
  
  // 更新单个过滤条件
  const updateFilterCondition = (column: string, field: 'operator' | 'value' | 'value2', value: string) => {
    setFilterConfig(prev => ({
      ...prev,
      [column]: {
        ...(prev[column] || { operator: '=', value: '', value2: '' }),
        [field]: value
      }
    }));
  };
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [sortConfig, setSortConfig] = useState<{column: string; direction: 'asc' | 'desc'} | null>(null);
  const [tableInfo, setTableInfo] = useState<{engine?: string; charset?: string; collation?: string}>({});

  // 加载表格信息
  const loadTableInfo = async () => {
    if (!connection || !database || !tableName) return;

    try {
      const poolId = connection.connectionId || connection.id;
      if (!poolId) return;

      // 获取表引擎和字符集信息
      const infoQuery = `SELECT engine, table_collation FROM information_schema.tables 
                        WHERE table_schema = ? AND table_name = ?`;
      const infoResult = await window.electronAPI.executeQuery(poolId, infoQuery, [database, tableName]);
      
      if (infoResult && infoResult.success && infoResult.data.length > 0) {
        const charset = infoResult.data[0].table_collation.split('_')[0];
        setTableInfo({
          engine: infoResult.data[0].engine,
          charset: charset
        });
      }

      // 获取表结构信息
      const schemaQuery = `SHOW COLUMNS FROM \`${database}\`\.\`${tableName}\``;
      const schemaResult = await window.electronAPI.executeQuery(poolId, schemaQuery);
      
      if (schemaResult && schemaResult.success && Array.isArray(schemaResult.data)) {
        // 构建schemaColumns，添加dbType字段存储原始数据库类型
        const schemaColumns = schemaResult.data.map((col: any) => ({
          title: col.Field,
          dataIndex: col.Field,
          key: col.Field,
          type: col.Type.includes('int') || col.Type.includes('decimal') || col.Type.includes('float') || col.Type.includes('double') ? 'number' : 'string',
          dbType: col.Type, // 存储原始数据库字段类型
          editable: col.Key !== 'PRI' && col.Extra !== 'auto_increment'
        }));

        // 初始化可见列
        if (schemaColumns.length && visibleColumns.size === 0) {
          setVisibleColumns(new Set(schemaColumns.map((col: {key: string}) => col.key)));
        }

        // 设置列配置，确保包含dbType字段
        setColumns(schemaColumns);
      }
    } catch (error) {
      console.error('获取表信息失败:', error);
    }
  };

  // 获取表结构
  const getTableSchema = async (poolId: string) => {
    try {
      // 使用SHOW COLUMNS获取更完整的表结构信息
      const schemaQuery = `SHOW COLUMNS FROM \`${database}\`\.\`${tableName}\``;
      const schemaResult = await window.electronAPI.executeQuery(poolId, schemaQuery);
      
      if (schemaResult && schemaResult.success && Array.isArray(schemaResult.data)) {
        // 构建schemaColumns，确保保存完整的数据库类型信息
        const schemaColumns = schemaResult.data.map((col: any) => ({
          title: col.Field,
          dataIndex: col.Field,
          key: col.Field,
          type: col.Type.includes('int') || col.Type.includes('decimal') || 
               col.Type.includes('float') || col.Type.includes('double') ? 'number' : 'string',
          dbType: col.Type, // 存储原始数据库字段类型
          editable: col.Key !== 'PRI' && col.Extra !== 'auto_increment' && 
                   col.Field.toLowerCase().indexOf('created_at') === -1
        }));

        // 初始化可见列
        if (schemaColumns.length && visibleColumns.size === 0) {
          setVisibleColumns(new Set(schemaColumns.map((col: {key: string}) => col.key)));
        }

        // 总是设置列配置，确保使用完整的表结构信息
        setColumns(schemaColumns);
      }
    } catch (error) {
      console.error('获取表结构失败:', error);
    }
  };

  // 表格统计信息
  const getColumnStats = (columnName: string) => {
    if (!data.length) return null;
    
    const values = data.map(row => row[columnName]).filter(val => val !== undefined && val !== null);
    if (!values.length) return null;
    
    if (typeof values[0] === 'number') {
      const numbers = values as number[];
      return {
        min: Math.min(...numbers),
        max: Math.max(...numbers),
        avg: numbers.reduce((sum, num) => sum + num, 0) / numbers.length,
        count: numbers.length
      };
    }
    
    // 文本类型统计
    const uniqueValues = new Set(values);
    return {
      unique: uniqueValues.size,
      count: values.length,
      sample: values.slice(0, 5).join(', ')
    };
  };

  // 导出数据
  const handleExport = () => {
    if (!data.length && !connection?.isConnected) {
      message.warning('没有可导出的数据');
      return;
    }
    
    // 第一步：选择导出范围
    Modal.confirm({
      title: '导出数据',
      content: (
        <div style={{ padding: '16px 0', lineHeight: '1.8' }}>
          <p style={{ margin: '0 0 16px 0', fontSize: '14px' }}>请选择导出范围：</p>
        </div>
      ),
      maskClosable: false,
      footer: (
        <div style={{ display: 'flex', gap: '12px' }}>
          <Button type="primary" onClick={() => {
            Modal.destroyAll();
            exportData('all');
          }} style={{ minWidth: '100px' }}>
            全部记录
          </Button>
          <Button onClick={() => {
            Modal.destroyAll();
            exportData('current');
          }} style={{ minWidth: '120px' }}>
            当前{data.length}条记录
          </Button>
          <Button onClick={() => {
            Modal.destroyAll();
          }} style={{ minWidth: '80px' }}>
            取消
          </Button>
        </div>
      )
    });
  };
  
  // 导出数据的核心函数
  const exportData = async (scope: 'all' | 'current') => {
    try {
      let exportDataList;
      
      // 根据选择的范围获取数据
      if (scope === 'all') {
        // 获取所有记录
        message.loading('正在获取所有记录，请稍候...', 0);
        const poolId = connection?.connectionId || connection?.id;
        if (!poolId) {
          message.error('连接池ID不存在');
          return;
        }
        
        // 构建查询条件（如果有）
        let whereClause = '';
        let params: any[] = [];
        
        if (filterMode === 'text' && customWhereClause.trim()) {
          whereClause = ` WHERE ${customWhereClause.trim()}`;
        } else if (filterMode === 'builder' && Object.keys(filterConfig).length > 0) {
          // 构建过滤条件
          const filterConditions = Object.entries(filterConfig)
            .map(([key, config]) => {
              if (!config.operator || (config.operator !== 'IS NULL' && config.operator !== 'IS NOT NULL' && !config.value)) {
                return null;
              }
              
              switch (config.operator) {
                case '=':
                case '<>':
                case '>':
                case '<':
                case '>=':
                case '<=':
                  params.push(config.value);
                  return `\`${key}\` ${config.operator} ?`;
                  
                case 'LIKE':
                case 'NOT LIKE':
                  params.push(`%${config.value}%`);
                  return `\`${key}\` ${config.operator} ?`;
                  
                case 'STARTS WITH':
                  params.push(`${config.value}%`);
                  return `\`${key}\` LIKE ?`;
                  
                case 'ENDS WITH':
                  params.push(`%${config.value}`);
                  return `\`${key}\` LIKE ?`;
                  
                case 'IS NULL':
                  return `\`${key}\` IS NULL`;
                  
                case 'IS NOT NULL':
                  return `\`${key}\` IS NOT NULL`;
                  
                case 'BETWEEN':
                  if (config.value && config.value2) {
                    params.push(config.value, config.value2);
                    return `\`${key}\` BETWEEN ? AND ?`;
                  }
                  return null;
                  
                default:
                  return null;
              }
            })
            .filter(Boolean) as string[];
          
          if (filterConditions.length > 0) {
            whereClause = ' WHERE ' + filterConditions.join(' AND ');
          }
        }
        
        // 添加排序（如果有）
        let orderClause = '';
        if (sortConfig) {
          orderClause = ` ORDER BY \`${sortConfig.column}\` ${sortConfig.direction.toUpperCase()}`;
        }
        
        // 查询所有记录（不使用LIMIT）
        const query = `SELECT * FROM \`${database}\`\.\`${tableName}\` ${whereClause} ${orderClause}`;
        const result = await window.electronAPI.executeQuery(poolId, query, params);
        
        message.destroy();
        
        if (result && result.success && Array.isArray(result.data)) {
          exportDataList = result.data.map((row: any, index: number) => ({
            key: index.toString(),
            ...row
          }));
        } else {
          message.error('获取全部记录失败');
          return;
        }
      } else {
        // 使用当前显示的记录
        exportDataList = data;
      }
      
      // 第二步：选择导出格式
      // 使用局部变量而不是React Hook，因为这在函数内部
      let selectedFormat = 'csv';
      
      Modal.confirm({
        title: '选择导出格式',
        content: (
          <div style={{ padding: '16px 0', lineHeight: '1.8' }}>
            <p style={{ margin: '0 0 16px 0', fontSize: '14px' }}>请选择导出文件格式：</p>
            <Select 
              defaultValue="csv" 
              style={{ width: '100%', marginTop: '8px' }}
              onChange={(value) => {
                selectedFormat = value;
                console.log('选择的格式:', value);
              }}
              showSearch
              placeholder="请选择或搜索文件格式"
              optionFilterProp="children"
            >
              <Select.Option value="txt">文本文件(*.txt)</Select.Option>
              <Select.Option value="csv">CSV文件(*.csv)</Select.Option>
              <Select.Option value="json">JSON文件(*.json)</Select.Option>
              <Select.Option value="xml">XML文件(*.xml)</Select.Option>
              <Select.Option value="sql">SQL脚本文件(*.sql)</Select.Option>
              <Select.Option value="xls">Excel数据表(*.xls)</Select.Option>
              <Select.Option value="xlsx">Excel文件（2007或更高版本）(*.xlsx)</Select.Option>
            </Select>
          </div>
        ),
        okText: '确定',
        cancelText: '取消',
        footer: (
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginRight: '10px' }}>
            <Button type="primary" onClick={() => {
              console.log('确认导出格式:', selectedFormat);
              Modal.destroyAll();
              // 对XLSX格式进行特殊处理，使用专门的导出函数
              if (selectedFormat === 'xlsx') {
                exportToXlsx(exportDataList);
              } else {
                generateExportFile(exportDataList, selectedFormat);
              }
            }} style={{ minWidth: '80px' }}>确定</Button>
            <Button onClick={() => Modal.destroyAll()} style={{ minWidth: '80px' }}>取消</Button>
          </div>
        ),
        maskClosable: false
      });
    } catch (error) {
      console.error('导出数据失败:', error);
      message.error('导出数据失败');
    }
  };
  
  // 生成并保存导出文件
  const generateExportFile = async (exportData: any[], format: string) => {
    try {
      console.log('开始导出，数据量:', exportData.length, '格式:', format);
      
      // 检查必要数据
      if (!Array.isArray(exportData)) {
        console.error('导出数据格式错误:', exportData);
        message.error('导出数据格式错误');
        return;
      }
      
      if (!Array.isArray(columns)) {
        console.error('列配置错误:', columns);
        message.error('列配置错误');
        return;
      }
      
      // 定义文件格式配置
      const formatConfig: {[key: string]: {extension: string, mimeType: string, generator: (data: any[], cols: any[]) => string}} = {
        txt: {
          extension: 'txt',
          mimeType: 'text/plain;charset=utf-8;',
          generator: generateTxtContent
        },
        csv: {
          extension: 'csv',
          mimeType: 'text/csv;charset=utf-8;',
          generator: generateCsvContent
        },
        json: {
          extension: 'json',
          mimeType: 'application/json;charset=utf-8;',
          generator: generateJsonContent
        },
        xml: {
          extension: 'xml',
          mimeType: 'application/xml;charset=utf-8;',
          generator: generateXmlContent
        },
        sql: {
          extension: 'sql',
          mimeType: 'text/plain;charset=utf-8;',
          generator: generateSqlContent
        },
        // 修复XLS和XLSX格式的实现
        xls: {
          extension: 'xls',
          mimeType: 'application/vnd.ms-excel;charset=utf-8;',
          generator: generateXlsContent // 使用专门的XLS生成器
        },
        xlsx: {
          extension: 'xlsx',
          mimeType: 'application/vnd.ms-excel;charset=utf-8;',
          generator: generateXlsxContent // 使用专门的XLSX生成器
        }
      };
      
      const config = formatConfig[format];
      if (!config) {
        console.error('不支持的导出格式:', format);
        message.error('不支持的导出格式');
        return;
      }
      
      // 生成文件内容
      try {
        console.log('开始生成文件内容...');
        const content = config.generator(exportData, columns);
        console.log('文件内容生成成功，长度:', content.length);
        
        // 生成文件名
        const timestamp = Date.now();
        const fileName = `${tableName || 'export'}_data_${timestamp}.${config.extension}`;
        
        // 使用原生方式下载文件
        console.log('开始创建下载链接...');
        
        // 直接将内容作为字符串传递给Blob构造函数
        // 不再混合使用Uint8Array和字符串，这会导致文件格式错误
        const blob = new Blob([content], { type: config.mimeType });
        
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        
        // 触发下载
        link.click();
        
        // 清理
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
          console.log('下载链接清理完成');
        }, 100);
        
        message.success(`文件已导出为${config.extension.toUpperCase()}格式`);
      } catch (contentError) {
        console.error('生成文件内容失败:', contentError);
        message.error('生成文件内容失败: ' + (contentError as Error).message);
      }
    } catch (error) {
      console.error('导出过程整体失败:', error);
      message.error('导出记录失败: ' + (error as Error).message);
    }
  };
  
  // 生成不同格式的文件内容
  const generateTxtContent = (data: any[], cols: any[]) => {
    const headers = cols.map(col => col.title).join('\t');
    const rows = data.map(row => 
      cols.map(col => row[col.dataIndex] || '').join('\t')
    ).join('\n');
    return `${headers}\n${rows}`;
  };
  
  const generateCsvContent = (data: any[], cols: any[]) => {
    // 生成CSV头部
    const headers = cols.map(col => {
      const title = col.title || '';
      return needsQuoting(title) ? `"${title.replace(/"/g, '""')}"` : title;
    }).join(',');
    
    // 生成CSV行数据
    const rows = data.map(row => 
      cols.map(col => {
        let value = row[col.dataIndex];
        // 处理null/undefined
        if (value === null || value === undefined) {
          return '';
        }
        
        // 处理对象/数组（JSON格式）
        if (typeof value === 'object') {
          value = JSON.stringify(value);
        }
        
        // 转换为字符串
        const strValue = String(value);
        
        // 判断是否需要引号包裹
        return needsQuoting(strValue) ? `"${strValue.replace(/"/g, '""')}"` : strValue;
      }).join(',')
    ).join('\n');
    
    return `${headers}\n${rows}`;
  };
  
  // 辅助函数：判断字符串是否需要引号包裹
  const needsQuoting = (str: string): boolean => {
    return str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r') || str.startsWith(' ') || str.endsWith(' ');
  };
  
  // 生成XLS格式内容 - 使用HTML表格，Excel能更好地支持
  const generateXlsContent = (data: any[], cols: any[]) => {
    // HTML表格是Excel能很好识别的格式，比TSV更可靠
    let html = '<!DOCTYPE html>\n<html>\n<head>\n';
    html += '<meta charset="UTF-8">\n';
    html += '</head>\n<body>\n';
    html += '<table border="1">\n';
    
    // 添加表头
    html += '<tr>\n';
    cols.forEach(col => {
      html += `<th>${escapeXml(col.title || '')}</th>\n`;
    });
    html += '</tr>\n';
    
    // 添加数据行
    data.forEach(row => {
      html += '<tr>\n';
      cols.forEach(col => {
        let value = row[col.dataIndex];
        if (value === null || value === undefined) {
          value = '';
        } else if (typeof value === 'object') {
          value = JSON.stringify(value);
        } else {
          value = String(value);
        }
        html += `<td>${escapeXml(value)}</td>\n`;
      });
      html += '</tr>\n';
    });
    
    html += '</table>\n</body>\n</html>';
    return html;
  };
  
  // 专门的XLSX导出函数 - 使用Excel兼容的HTML表格格式
  const exportToXlsx = (data: any[]) => {
    try {
      console.log('开始导出XLSX，数据量:', data.length);
      
      // 检查必要数据
      if (!Array.isArray(data)) {
        console.error('导出数据格式错误:', data);
        message.error('导出数据格式错误');
        return;
      }
      
      if (!Array.isArray(columns)) {
        console.error('列配置错误:', columns);
        message.error('列配置错误');
        return;
      }
      
      // 使用完整的HTML表格格式，这是Excel能很好识别的格式
      let html = '<!DOCTYPE html>\n<html>\n<head>\n';
      html += '<meta charset="UTF-8">\n';
      html += '<style>\ntable { border-collapse: collapse; font-family: Arial, sans-serif; }\nth, td { border: 1px solid #ddd; padding: 8px; }\nth { background-color: #f2f2f2; }\n</style>\n';
      html += '</head>\n<body>\n';
      html += '<table>\n';
      
      // 添加表头
      html += '<tr>\n';
      columns.forEach(col => {
        html += `<th>${escapeXml(col.title || '')}</th>\n`;
      });
      html += '</tr>\n';
      
      // 添加数据行
      data.forEach(row => {
        html += '<tr>\n';
        columns.forEach(col => {
          let value = row[col.dataIndex];
          if (value === null || value === undefined) {
            value = '';
          } else if (typeof value === 'object') {
            value = JSON.stringify(value);
          } else {
            value = String(value);
          }
          html += `<td>${escapeXml(value)}</td>\n`;
        });
        html += '</tr>\n';
      });
      
      html += '</table>\n</body>\n</html>';
      
      // 生成文件名 - 使用.xlsx扩展名
      const timestamp = Date.now();
      const fileName = `${tableName || 'export'}_data_${timestamp}.xlsx`;
      
      // 创建Blob时添加UTF-8 BOM并使用正确的MIME类型
      // 注意：即使内容是HTML，Excel也能很好地打开它
      const blob = new Blob(['\uFEFF' + html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      
      // 创建下载链接
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = fileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      
      // 触发下载
      link.click();
      
      // 清理
      setTimeout(() => {
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        console.log('XLSX下载链接清理完成');
      }, 100);
      
      message.success('文件已导出为Excel格式');
    } catch (error) {
      console.error('XLSX导出失败:', error);
      message.error('导出Excel文件失败: ' + (error as Error).message);
    }
  };
  
  // 标准Excel导出函数 - 提供统一的Excel导出接口
  // 这是一个更清晰的API，便于其他组件调用，统一处理Excel格式导出
  const exportToExcel = async (exportData?: any[], format: 'xlsx' | 'xls' = 'xlsx') => {
    try {
      console.log(`开始标准Excel导出，格式: ${format}`);
      
      // 使用提供的数据或当前数据
      const dataToExport = exportData || data;
      
      if (!dataToExport.length) {
        message.warning('没有可导出的数据');
        return;
      }
      
      message.loading('正在准备导出Excel文件...', 0);
      
      // 根据格式选择导出方式
      if (format === 'xlsx') {
        // XLSX格式使用专门的导出函数
        await exportToXlsx(dataToExport);
      } else {
        // XLS格式使用通用导出机制
        generateExportFile(dataToExport, 'xls');
      }
      
      message.destroy();
    } catch (error) {
      message.destroy();
      console.error('Excel导出失败:', error);
      message.error('导出Excel文件时发生错误: ' + (error as Error).message);
    }
  };

  // 生成XLSX格式内容的函数 - 与exportToXlsx保持一致的实现
  const generateXlsxContent = (data: any[], cols: any[]) => {
    console.log('使用generateXlsxContent生成XLSX内容，数据量:', data.length);
    
    // 使用完整的HTML表格格式，确保与exportToXlsx函数保持一致
    let html = '<!DOCTYPE html>\n<html>\n<head>\n';
    html += '<meta charset="UTF-8">\n';
    html += '<style>\ntable { border-collapse: collapse; font-family: Arial, sans-serif; }\nth, td { border: 1px solid #ddd; padding: 8px; }\nth { background-color: #f2f2f2; }\n</style>\n';
    html += '</head>\n<body>\n';
    html += '<table>\n';
    
    // 添加表头
    html += '<tr>\n';
    cols.forEach(col => {
      html += `<th>${escapeXml(col.title || '')}</th>\n`;
    });
    html += '</tr>\n';
    
    // 添加数据行
    data.forEach(row => {
      html += '<tr>\n';
      cols.forEach(col => {
        let value = row[col.dataIndex];
        if (value === null || value === undefined) {
          value = '';
        } else if (typeof value === 'object') {
          value = JSON.stringify(value);
        } else {
          value = String(value);
        }
        html += `<td>${escapeXml(value)}</td>\n`;
      });
      html += '</tr>\n';
    });
    
    html += '</table>\n</body>\n</html>';
    
    console.log('XLSX内容生成完成，长度:', html.length);
    return html;
  };
  
  // 辅助函数：转义XML特殊字符
  const escapeXml = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };
  
  const generateJsonContent = (data: any[], cols: any[]) => {
    const exportData = data.map(row => {
      const record: any = {};
      cols.forEach(col => {
        record[col.title] = row[col.dataIndex] || null;
      });
      return record;
    });
    return JSON.stringify(exportData, null, 2);
  };
  
  const generateXmlContent = (data: any[], cols: any[]) => {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>' + '\n';
    xml += '<root>' + '\n';
    xml += '  <table name="' + tableName + '">' + '\n';
    
    data.forEach((row, index) => {
      xml += '    <record id="' + (index + 1) + '">' + '\n';
      cols.forEach(col => {
        const value = row[col.dataIndex] || '';
        xml += '      <' + col.dataIndex + '><![CDATA[' + value + ']]></' + col.dataIndex + '>' + '\n';
      });
      xml += '    </record>' + '\n';
    });
    
    xml += '  </table>' + '\n';
    xml += '</root>';
    return xml;
  };
  
  const generateSqlContent = (data: any[], cols: any[]) => {
    let sql = '-- MySQL导出脚本\n';
    sql += '-- 表名: ' + database + '.' + tableName + '\n';
    sql += '-- 导出时间: ' + new Date().toLocaleString() + '\n';
    sql += '\n';
    
    // 生成INSERT语句
    const columnNames = cols.map(col => '`' + col.dataIndex + '`').join(', ');
    
    data.forEach(row => {
      const values = cols.map(col => {
        const value = row[col.dataIndex];
        if (value === null || value === undefined) {
          return 'NULL';
        } else if (typeof value === 'string') {
          // 转义SQL中的单引号
          return "'" + value.replace(/'/g, "''") + "'";
        } else {
          return value.toString();
        }
      }).join(', ');
      
      sql += 'INSERT INTO `' + database + '`.`' + tableName + '` (' + columnNames + ') VALUES (' + values + ');\n';
    });
    
    return sql;
  };

  // 复制数据
  const handleCopyData = () => {
    if (!data.length) {
      message.warning('没有可复制的数据');
      return;
    }
    
    // 复制为制表符分隔的文本
    const headers = columns.map(col => col.title).join('\t');
    const rows = data.map(row => 
      columns.map(col => row[col.dataIndex]).join('\t')
    ).join('\n');
    
    const text = `${headers}\n${rows}`;
    navigator.clipboard.writeText(text).then(() => {
      message.success('数据已复制到剪贴板');
    });
  };

  // 查看记录详情 - 使用编辑页面但禁止编辑
  const handleViewRecord = (record: TableData) => {
    setEditingRecord(record);
    setIsViewMode(true);
    form.setFieldsValue(record);
    setIsEditModalVisible(true);
  };

  // 复制记录
  const handleCopyRecord = (record: TableData) => {
    setEditingRecord(null); // 确保是新增模式
    form.setFieldsValue(record); // 填充选中行的数据
    setIsAddModalVisible(true); // 打开新增弹窗
  };

  // 切换列显示
  const toggleColumnVisibility = (columnKey: string) => {
    const newVisibleColumns = new Set(visibleColumns);
    if (newVisibleColumns.has(columnKey)) {
      newVisibleColumns.delete(columnKey);
    } else {
      newVisibleColumns.add(columnKey);
    }
    setVisibleColumns(newVisibleColumns);
  };

  // 应用过滤
  const applyFilter = () => {
    setCurrentPage(1);
    loadTableData();
    setIsFilterMenuVisible(false);
  };

  // 清除过滤
  const clearFilter = () => {
    setFilterConfig({});
    setCustomWhereClause('');
    setCurrentPage(1);
    loadTableData();
  };

  // 排序处理
  const handleSort = (column: string, direction: 'asc' | 'desc') => {
    setSortConfig({ column, direction });
    setCurrentPage(1);
    loadTableData();
  };

  useEffect(() => {
    if (connection && connection.isConnected && database && tableName) {
      loadTableData();
      loadTableInfo();
    } else {
      setData([]);
      setColumns([]);
    }
  }, [connection, database, tableName, currentPage, pageSize, sortConfig]);

  const loadTableData = async () => {
    if (!connection || !database || !tableName) return;

    setLoading(true);
    try {
      // 使用真实数据库连接获取数据
      if (!window.electronAPI || !connection.isConnected) {
        message.error('数据库连接不可用');
        console.error('数据库连接不可用');
        setData([]);
        setColumns([]);
        return;
      }

      // 使用连接池ID
      const poolId = connection.connectionId || connection.id;
      if (!poolId) {
        message.error('连接池ID不存在');
        console.error('连接池ID不存在');
        setData([]);
        setColumns([]);
        return;
      }

      console.log('MySQL数据面板 - 尝试从数据库获取数据:', { connectionId: poolId, database, tableName });

      // 构建查询条件
      let whereClause = '';
      let params: any[] = [];
      
      // 添加过滤条件
      if (filterMode === 'text' && customWhereClause.trim()) {
        // 文本模式：直接使用用户输入的WHERE子句
        whereClause = ` WHERE ${customWhereClause.trim()}`;
      } else if (filterMode === 'builder' && Object.keys(filterConfig).length > 0) {
        // 创建工具模式：构建条件
        const filterConditions = Object.entries(filterConfig)
          .map(([key, config]) => {
            if (!config.operator || (config.operator !== 'IS NULL' && config.operator !== 'IS NOT NULL' && !config.value)) {
              return null;
            }
            
            const columnInfo = columns.find(col => col.key === key);
            const dbType = columnInfo?.dbType;
            
            switch (config.operator) {
              case '=':
              case '<>':
              case '>':
              case '<':
              case '>=':
              case '<=':
                params.push(config.value);
                return `\`${key}\` ${config.operator} ?`;
                
              case 'LIKE':
              case 'NOT LIKE':
                params.push(`%${config.value}%`);
                return `\`${key}\` ${config.operator} ?`;
                
              case 'STARTS WITH':
                params.push(`${config.value}%`);
                return `\`${key}\` LIKE ?`;
                
              case 'ENDS WITH':
                params.push(`%${config.value}`);
                return `\`${key}\` LIKE ?`;
                
              case 'IS NULL':
                return `\`${key}\` IS NULL`;
                
              case 'IS NOT NULL':
                return `\`${key}\` IS NOT NULL`;
                
              case 'BETWEEN':
                if (config.value && config.value2) {
                  params.push(config.value, config.value2);
                  return `\`${key}\` BETWEEN ? AND ?`;
                }
                return null;
                
              default:
                return null;
            }
          })
          .filter(Boolean) as string[];
        
        if (filterConditions.length > 0) {
          whereClause = ' WHERE ' + filterConditions.join(' AND ');
        }
      }
      
      // 添加排序
      let orderClause = '';
      if (sortConfig) {
        orderClause = ` ORDER BY \`${sortConfig.column}\` ${sortConfig.direction.toUpperCase()}`;
      }

      // MySQL专用查询语句 - 使用反引号转义
      const query = `SELECT * FROM \`${database}\`\.\`${tableName}\` ${whereClause} ${orderClause} LIMIT ${(currentPage - 1) * pageSize}, ${pageSize}`;
      console.log('MySQL数据查询:', query, '参数:', params);

      // 执行查询获取数据
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      console.log('MySQL查询结果:', result);

      if (result && result.success && Array.isArray(result.data)) {
        // 处理查询结果
        const realData = result.data.map((row: any, index: number) => ({
          key: index.toString(),
          ...row
        }));

        // 不再获取总记录数，避免千万行表查询卡死

        // 不再从查询结果动态生成列配置，而是使用getTableSchema获取的完整表结构
        // 但如果还没有获取到表结构，则获取一次
        if (columns.length === 0) {
          console.log('尚未获取到表结构，正在获取完整表结构');
          await getTableSchema(poolId);
        }
        
        // 初始化可见列
        if (columns.length && visibleColumns.size === 0) {
          setVisibleColumns(new Set(columns.map(col => col.key)));
        }

        setData(realData);
      } else {
        console.warn('MySQL未获取到数据或查询失败');
        setData([]);
        // 不再清空columns，保留表头显示
        if (columns.length === 0) {
          // 如果没有列定义，尝试获取表结构
          console.log('查询失败，尝试获取表结构以显示表头');
          await getTableSchema(poolId);
        }
      }
    } catch (error) {
      message.error('MySQL加载数据失败');
      console.error('MySQL加载数据失败:', error);
      setData([]);
      setColumns([]);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (record: TableData) => {
    setEditingRecord(record);
    setIsViewMode(false);
    form.setFieldsValue(record);
    setIsEditModalVisible(true);
  };

  const handleAdd = () => {
    setEditingRecord(null);
    form.resetFields();
    setIsAddModalVisible(true);
  };

  const handleDelete = async (record: TableData) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除这条记录吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          // 实现MySQL删除操作
          const poolId = connection?.connectionId || connection?.id;
          if (!poolId) {
            message.error('连接池ID不存在');
            return;
          }
          
          // 获取主键字段
          const primaryKeyQuery = `SELECT column_name FROM information_schema.key_column_usage 
                                 WHERE table_schema = ? AND table_name = ? AND constraint_name = 'PRIMARY'`;
          const pkResult = await window.electronAPI.executeQuery(poolId, primaryKeyQuery, [database, tableName]);
          
          if (pkResult && pkResult.success && pkResult.data && pkResult.data.length > 0) {
            const primaryKey = pkResult.data[0].column_name;
            const deleteQuery = `DELETE FROM \`${database}\`\.\`${tableName}\` WHERE \`${primaryKey}\` = ?`;
            const deleteResult = await window.electronAPI.executeQuery(poolId, deleteQuery, [record[primaryKey]]);
            
            if (deleteResult && deleteResult.success) {
              // 更新本地数据
              setData(prev => prev.filter(item => item.key !== record.key));
              message.success('删除成功');
            } else {
              message.error('删除失败');
            }
          } else {
            // 如果没有主键，只更新本地数据
            setData(prev => prev.filter(item => item.key !== record.key));
            message.success('删除成功（仅本地更新）');
          }
        } catch (error) {
          message.error('删除失败');
          console.error('MySQL删除失败:', error);
        }
      }
    });
  };

  const handleSave = async () => {
    if (isViewMode) {
      setIsEditModalVisible(false);
      return;
    }
    try {
      const values = await form.validateFields();
      const poolId = connection?.connectionId || connection?.id;
      if (!poolId) {
        message.error('连接池ID不存在');
        return;
      }
      
      if (editingRecord) {
        // 编辑现有记录
        const primaryKeyQuery = `SELECT column_name FROM information_schema.key_column_usage 
                               WHERE table_schema = ? AND table_name = ? AND constraint_name = 'PRIMARY'`;
          const pkResult = await window.electronAPI.executeQuery(poolId, primaryKeyQuery, [database, tableName]);
        
        if (pkResult && pkResult.success && pkResult.data && pkResult.data.length > 0) {
          const primaryKey = pkResult.data[0].column_name;
          const updateFields = Object.entries(values)
            .filter(([key]) => key !== primaryKey)
            .map(([key]) => `\`${key}\` = ?`)
            .join(', ');
          
          const updateValues = Object.entries(values)
            .filter(([key]) => key !== primaryKey)
            .map(([_, value]) => value);
          updateValues.push(editingRecord[primaryKey]);
          
          const updateQuery = `UPDATE \`${database}\`\.\`${tableName}\` SET ${updateFields} WHERE \`${primaryKey}\` = ?`;
          const updateResult = await window.electronAPI.executeQuery(poolId, updateQuery, updateValues);
          
          if (updateResult && updateResult.success) {
            setData(prev => prev.map(item => 
              item.key === editingRecord.key ? { ...item, ...values } : item
            ));
            message.success('更新成功');
            setIsEditModalVisible(false);
          } else {
            message.error('更新失败');
          }
        } else {
          // 如果没有主键，只更新本地数据
          setData(prev => prev.map(item => 
            item.key === editingRecord.key ? { ...item, ...values } : item
          ));
          message.success('更新成功（仅本地更新）');
          setIsEditModalVisible(false);
        }
      } else {
        // 添加新记录
        const fields = Object.keys(values).map(key => `\`${key}\``).join(', ');
        const placeholders = Object.keys(values).map(() => '?').join(', ');
        const insertValues = Object.values(values);
        
        const insertQuery = `INSERT INTO \`${database}\`\.\`${tableName}\` (${fields}) VALUES (${placeholders})`;
        const insertResult = await window.electronAPI.executeQuery(poolId, insertQuery, insertValues);
        
        if (insertResult && insertResult.success) {
          const newRecord: TableData = {
            key: Date.now().toString(),
            ...values,
            id: data.length + 1
          };
          setData(prev => [newRecord, ...prev]);
          message.success('添加成功');
          setIsAddModalVisible(false);
        } else {
          message.error('添加失败');
        }
      }
    } catch (error) {
      console.error('保存失败:', error);
      message.error('保存失败');
    }
  };


  const handleRefresh = () => {
    loadTableData();
  };

  const actionColumn = {
    title: '操作',
    key: 'action',
    fixed: 'right',
    width: 220,
    render: (text: string, record: TableData) => (
      <Space size="small">
        <Button 
          type="link" 
          icon={<EyeOutlined />} 
          onClick={() => handleViewRecord(record)}
          size="small"
          className={darkMode ? 'dark-btn' : ''}
        >
          查看
        </Button>
        <Button 
          type="link" 
          icon={<CopyOutlined />} 
          onClick={() => handleCopyRecord(record)}
          size="small"
          className={darkMode ? 'dark-btn' : ''}
        >
          复制
        </Button>
        <Button 
          type="link" 
          icon={<EditOutlined />} 
          onClick={() => handleEdit(record)}
          size="small"
          className={darkMode ? 'dark-btn' : ''}
        >
          编辑
        </Button>
        <Button 
          type="link" 
          danger 
          icon={<DeleteOutlined />} 
          onClick={() => handleDelete(record)}
          size="small"
          className={darkMode ? 'dark-btn' : ''}
        >
          删除
        </Button>
      </Space>
    )
  };

  // 使用通用数据库字段表单组件渲染表单字段
  const renderFormFields = () => {
    // 添加安全检查
    if (!columns || columns.length === 0) {
      return <div>正在加载表结构信息...</div>;
    }
    
    const editableColumns = columns.filter(col => col.editable !== false && col);
    
    // 确保有可编辑列
    if (editableColumns.length === 0) {
      return <div>该表没有可编辑的字段</div>;
    }
    
    return editableColumns.map(col => (
      <DbFieldFormItem 
        key={col.dataIndex} 
        column={col} 
        databaseType="mysql" 
        disabled={isViewMode}
      />
    ));
  };

  if (!connection || !connection.isConnected) {
    return (
      <div className="data-panel">
        <div className="empty-state">
          <Card>
            <div style={{ textAlign: 'center', color: '#999' }}>
              请先建立数据库连接
            </div>
          </Card>
        </div>
      </div>
    );
  }

  if (!database || !tableName) {
    return (
      <div className="data-panel">
        <div className="empty-state">
          <Card>
            <div style={{ textAlign: 'center', color: '#999' }}>
              请选择数据库和表
            </div>
          </Card>
        </div>
      </div>
    );
  }

  // 获取可见的列
  const getVisibleColumns = () => {
    const visibleCols = columns
      .filter(col => visibleColumns.has(col.key))
      .map(col => ({
        ...col,
        // 实现两行表头 - 直接展示数据库字段类型
        title: (
          <div className="table-header-wrapper">
            <div className="header-field-name">
              <span>{col.title}</span>
              <span className="sort-icons">
                {/* 上箭头 - 升序 */}
                <span 
                  className={`sort-icon sort-asc ${sortConfig && sortConfig.column === col.dataIndex && sortConfig.direction === 'asc' ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSort(col.dataIndex, 'asc');
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  ▲
                </span>
                {/* 下箭头 - 降序 */}
                <span 
                  className={`sort-icon sort-desc ${sortConfig && sortConfig.column === col.dataIndex && sortConfig.direction === 'desc' ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSort(col.dataIndex, 'desc');
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  ▼
                </span>
              </span>
            </div>
            <div className="header-field-type">{col.dbType || col.type}</div>
          </div>
        ),
        // 添加排序功能
        sorter: true,
        sortDirections: ['asc', 'desc'] as const,
        // 启用列宽调整功能
        resizable: true,
        onHeaderCell: (column: any) => ({}) // 移除默认的onClick，使用图标点击事件
      }));
    
    return visibleCols;
  };

  // 获取列菜单
  const getColumnMenu = () => {
    return (
      <div className="column-menu">
        {columns.map(col => (
          <div key={col.key} className="menu-item">
            <input
              type="checkbox"
              id={`col-${col.key}`}
              checked={visibleColumns.has(col.key)}
              onChange={() => toggleColumnVisibility(col.key)}
              className="menu-checkbox"
            />
            <label htmlFor={`col-${col.key}`} className="menu-label">
              {col.title}
            </label>
          </div>
        ))}
      </div>
    );
  };

  // 获取过滤菜单
  const getFilterMenu = () => {
    return (
      <div className="filter-menu">
        {/* 过滤模式切换 */}
        <div className="filter-mode-switch">
          <Radio.Group 
            value={filterMode} 
            onChange={(e) => setFilterMode(e.target.value)}
          >
            <Radio.Button value="builder">创建工具</Radio.Button>
            <Radio.Button value="text">文本</Radio.Button>
          </Radio.Group>
        </div>
        
        {/* 移除过滤条件标题 */}
        
        {filterMode === 'builder' ? (
          <div className="filter-builder" style={{ maxHeight: '400px', overflowY: 'auto', marginBottom: '16px' }}>
            {columns.map(col => {
              const currentFilter = filterConfig[col.key] || { operator: '=', value: '', value2: '' };
              const operators = getAvailableOperators(col.dbType);
              const showSecondInput = currentFilter.operator === 'BETWEEN';
              
              return (
                <div key={col.key} className="filter-item-builder">
                  <div className="filter-item-header" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <label className="filter-label" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      {col.title}
                      <Button
                        type="text"
                        size="small"
                        onClick={() => {
                          const newFilterConfig = { ...filterConfig };
                          delete newFilterConfig[col.key];
                          setFilterConfig(newFilterConfig);
                        }}
                        className="filter-clear-btn"
                        icon={<CloseOutlined />}
                        style={{ margin: 0, padding: 0, fontSize: '14px' }}
                      />
                    </label>
                  </div>
                  <div className="filter-item-controls">
                    <Select
                      value={currentFilter.operator}
                      onChange={(value) => updateFilterCondition(col.key, 'operator', value)}
                      style={{ width: 120, marginRight: 8 }}
                      className="filter-operator"
                    >
                      {operators.map(operator => (
                        <Option key={operator.value} value={operator.value}>{operator.label}</Option>
                      ))}
                    </Select>
                    
                    {currentFilter.operator !== 'IS NULL' && currentFilter.operator !== 'IS NOT NULL' && (
                      <>
                        <Input
                          value={currentFilter.value}
                          onChange={(e) => updateFilterCondition(col.key, 'value', e.target.value)}
                          placeholder="值"
                          style={{ width: 150, marginRight: showSecondInput ? 8 : 0 }}
                          className="filter-value"
                          disabled={currentFilter.operator === 'IS NULL' || currentFilter.operator === 'IS NOT NULL'}
                        />
                        {showSecondInput && (
                          <Input
                            value={currentFilter.value2 || ''}
                            onChange={(e) => updateFilterCondition(col.key, 'value2', e.target.value)}
                            placeholder="至"
                            style={{ width: 150 }}
                            className="filter-value2"
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="filter-text">
            <div className="filter-text-input">
              <label className="filter-label">WHERE 子句</label>
              <Input.TextArea
                value={customWhereClause}
                onChange={(e) => setCustomWhereClause(e.target.value)}
                placeholder="请输入WHERE子句内容（不需要包含WHERE关键字），例如：age > 18 AND name LIKE '%张三%'"
                rows={4}
                className="filter-textarea"
              />
              <div className="filter-text-tip">
                提示：请确保SQL语法正确，支持所有MySQL WHERE子句语法
              </div>
            </div>
          </div>
        )}
        
        <div className="filter-actions">
          <Button type="primary" size="small" onClick={applyFilter}>
            应用
          </Button>
          <Button size="small" onClick={clearFilter}>
            清除
          </Button>
        </div>
      </div>
    );
  };

  return (
    <div className={`data-panel ${darkMode ? 'dark' : ''}`}>
      {/* 工具栏 */}
      <div className="data-toolbar">
        <Space>
          <Button 
            icon={<PlusOutlined />} 
            onClick={handleAdd}
          >
            新增
          </Button>
          <Button 
            icon={<EyeOutlined />} 
            onClick={() => {
              const selectedRecord = data.find(record => record.key === selectedRowKey);
              if (selectedRecord) handleViewRecord(selectedRecord);
            }}
            disabled={!selectedRowKey}
            className={darkMode ? 'dark-btn' : ''}
          >
            查看
          </Button>
          <Tooltip title="复制数据">
            <Button 
              icon={<CopyOutlined />} 
              onClick={() => {
                const selectedRecord = data.find(record => record.key === selectedRowKey);
                if (selectedRecord) handleCopyRecord(selectedRecord);
              }}
              disabled={!selectedRowKey}
              className={darkMode ? 'dark-btn' : ''}
            >
              复制
            </Button>
          </Tooltip>
          <Button 
            icon={<EditOutlined />} 
            onClick={() => {
              const selectedRecord = data.find(record => record.key === selectedRowKey);
              if (selectedRecord) handleEdit(selectedRecord);
            }}
            disabled={!selectedRowKey}
            className={darkMode ? 'dark-btn' : ''}
          >
            编辑
          </Button>
          <Button 
            icon={<DeleteOutlined />} 
            danger
            onClick={() => {
              const selectedRecord = data.find(record => record.key === selectedRowKey);
              if (selectedRecord) handleDelete(selectedRecord);
            }}
            disabled={!selectedRowKey}
            className={darkMode ? 'dark-btn' : ''}
          >
            删除
          </Button>
          <Button 
            icon={<ReloadOutlined />} 
            onClick={handleRefresh}
            className={darkMode ? 'dark-btn' : ''}
          >
            刷新
          </Button>
          <Tooltip title="导出数据">
            <Button 
              icon={<DownloadOutlined />} 
              onClick={handleExport}
              className={darkMode ? 'dark-btn' : ''}
            >
              导出
            </Button>
          </Tooltip>
          <Tooltip title="列显示控制">
            <Button 
              icon={<ColumnWidthOutlined />} 
              onClick={() => setIsColumnMenuVisible(!isColumnMenuVisible)}
              className={darkMode ? 'dark-btn' : ''}
            >
              列
            </Button>
          </Tooltip>
          <Tooltip title="数据过滤">
            <Button 
              icon={<FilterOutlined />} 
              onClick={() => setIsFilterMenuVisible(!isFilterMenuVisible)}
              className={darkMode ? 'dark-btn' : ''}
            >
              过滤
            </Button>
          </Tooltip>
        </Space>
      </div>

      {/* 表格信息栏 */}
      <div className="table-info">
        <div className="table-name-info">
          <strong>{database}.{tableName}</strong>
          <span className="table-stats">
            ({columns.length} 列)
          </span>
          {tableInfo.engine && (
            <span className="table-engine">
              | Engine: {tableInfo.engine}, Charset: {tableInfo.charset}
            </span>
          )}
        </div>
        {sortConfig && (
          <div className="sort-info">
            排序: {columns.find(c => c.dataIndex === sortConfig.column)?.title || sortConfig.column}
            ({sortConfig.direction === 'asc' ? '升序' : '降序'})
            <Button 
              size="small" 
              type="link" 
              onClick={() => {
                setSortConfig(null);
                loadTableData();
              }}
              className="clear-sort-btn"
            >
              清除
            </Button>
          </div>
        )}
      </div>

      {/* 列控制菜单 */}
      {isColumnMenuVisible && (
        <div className="context-menu column-menu-container">
          {getColumnMenu()}
        </div>
      )}

      {/* 过滤菜单 */}
      {isFilterMenuVisible && (
        <div className="context-menu filter-menu-container">
          {getFilterMenu()}
        </div>
      )}

      {/* 数据表格 */}
      <div className="data-table-container">
        {loading ? (
          <div className="loading-container">
            <Spin tip="MySQL加载中..." />
          </div>
        ) : (
          <Table
            dataSource={data}
            columns={getVisibleColumns()}
            size="small"
            pagination={false}
            scroll={{ x: true, y: 'calc(100vh - 430px)' }}
            bordered
            rowKey="key"
            className={darkMode ? 'dark-table' : ''}
            // 自定义表头样式
            components={{
              header: {
                cell: ({ className, children, ...props }: any) => {
                  // 确保正确传递所有props，包括resizable相关的事件处理
                  return (
                    <th 
                      className={`${className} ${darkMode ? 'dark-table-header' : ''} double-header`} 
                      {...props}
                    >
                      {children}
                    </th>
                  );
                }
              },
              body: {
                cell: ({ className, children, ...props }: any) => {
                  // 获取当前列名（用于弹窗标题）
                  const columnName = props.col?.title || '';
                  // 确保children是字符串类型
                  const content = typeof children === 'string' ? children : String(children);
                  // 设置最大宽度（像素）
                  const maxWidth = 300;
                  
                  // 只对文本内容超过一定长度的单元格应用省略号和弹窗功能
                  if (content && content.length > 50) {
                    return (
                      <td 
                        className={`${className} ${darkMode ? 'dark-table-cell' : ''}`} 
                        style={{ maxWidth, overflow: 'hidden' }}
                        {...props}
                      >
                        <div 
                          style={{
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            position: 'relative',
                            paddingRight: '16px', // 为省略号留出空间
                            cursor: 'pointer'
                          }}
                          onClick={() => openFullTextModal(content, `${columnName} - 完整内容`)}
                        >
                          {content.substring(0, 80)}...
                        </div>
                      </td>
                    );
                  }
                  
                  return (
                    <td 
                      className={`${className} ${darkMode ? 'dark-table-cell' : ''}`} 
                      style={{ maxWidth: maxWidth }} // 对所有单元格应用最大宽度
                      {...props}
                    >
                      {children}
                    </td>
                  );
                }
              }
            }}
            // 实现行选择功能
            onRow={(record) => ({
              onClick: () => {
                setSelectedRowKey(record.key === selectedRowKey ? null : record.key);
              },
              className: record.key === selectedRowKey ? 'selected-row' : ''
            })}
            // 设置当前排序状态
            sortDirections={['ascend', 'descend'] as const}
            // 确保即使没有数据也显示表头
            locale={{
              emptyText: '暂无数据'
            }}
          />
        )}
        
        {/* 分页 */}
        <div className="pagination-container">
          <Pagination
            current={currentPage}
            pageSize={pageSize}
            showSizeChanger
            showQuickJumper={false}
            showTotal={() => ''}
            pageSizeOptions={['200', '300', '500', '1000']}
            onChange={(page, size) => {
              setCurrentPage(page);
              setPageSize(size || 200);
            }}
            onShowSizeChange={(current, size) => {
              setCurrentPage(1);
              setPageSize(size);
            }}
            className={darkMode ? 'dark-pagination' : ''}
            // 根据查询结果数量设置total，确保分页按钮正确启用
            // 当查询结果数量与当前分页条数相同时，启用下一页和最后一页按钮
            // 当前页数不是1时，启用第一页与上一页按钮
            total={data.length === pageSize ? currentPage * pageSize + 1 : currentPage * pageSize}
          />
        </div>
      </div>

      {/* 编辑模态框 */}
      <Modal
        title={isViewMode ? '查看记录' : (editingRecord ? '编辑记录' : '新增记录')}
        open={isEditModalVisible || isAddModalVisible}
        onOk={handleSave}
        onCancel={() => {
          setIsEditModalVisible(false);
          setIsAddModalVisible(false);
          setIsViewMode(false);
        }}
        footer={isViewMode ? [
          <Button key="close" onClick={() => {
            setIsEditModalVisible(false);
            setIsViewMode(false);
          }}>
            关闭
          </Button>
        ] : undefined}
        width={600}
        className={darkMode ? 'dark-modal' : ''}
      >
        <Form
          form={form}
          layout="vertical"
          className={darkMode ? 'dark-form' : ''}
        >
          {renderFormFields()}
        </Form>
      </Modal>

      {/* 显示完整文本内容的弹窗 */}
      <Modal
        title={fullTextTitle}
        open={fullTextModalVisible}
        onCancel={() => setFullTextModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setFullTextModalVisible(false)}>
            关闭
          </Button>
        ]}
        width={600}
      >
        <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {fullTextContent}
        </div>
      </Modal>
    </div>
  );
};

export default MySqlDataPanel;