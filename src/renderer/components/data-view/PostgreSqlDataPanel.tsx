import React, { useState, useEffect } from 'react';
import { Button, Table, Space, Modal, Form, Input, InputNumber, Select, message, Card, Pagination, Spin, Tooltip, Empty, Radio, Checkbox, Dropdown, Menu } from 'antd';
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
  CheckOutlined,
  FileTextOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  MoreOutlined,
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

const PostgreSqlDataPanel: React.FC<DataPanelProps> = ({ connection, database, tableName, darkMode }) => {
  // 优先使用传入的darkMode属性，否则使用useTheme钩子获取
  const [data, setData] = useState<TableData[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(200); // 与MySQL保持一致
  const [total, setTotal] = useState(0);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<TableData | null>(null);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [form] = Form.useForm();
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set());
  const [isColumnMenuVisible, setIsColumnMenuVisible] = useState(false);
  const [isFilterMenuVisible, setIsFilterMenuVisible] = useState(false);
  const [isViewMode, setIsViewMode] = useState(false);
  // 定义过滤条件类型
  interface FilterCondition {
    operator: string;
    value?: string;
    value2?: string;
  }
  
  const [filterConfig, setFilterConfig] = useState<Record<string, FilterCondition>>({});
  const [sortConfig, setSortConfig] = useState<{column: string; direction: 'asc' | 'desc'} | null>(null);
  const [tableInfo, setTableInfo] = useState<{owner?: string; tablespace?: string; size?: string}>({});
  const [fullTextModalVisible, setFullTextModalVisible] = useState(false);
  const [fullTextContent, setFullTextContent] = useState('');
  const [fullTextTitle, setFullTextTitle] = useState('');
  const [filterMode, setFilterMode] = useState<'builder' | 'text'>('builder'); // 'builder'创建工具模式，'text'文本模式
  const [customWhereClause, setCustomWhereClause] = useState(''); // 文本模式的自定义WHERE子句
  const [exportCurrentPageOnly, setExportCurrentPageOnly] = useState(true); // 导出选项：仅当前页
  // 获取PostgreSQL表信息
  const loadTableInfo = async () => {
    if (!connection || !database || !tableName) return;
    
    try {
      const poolId = connection.connectionId || connection.id;
      const query = `SELECT tableowner as owner, tablespace, pg_size_pretty(pg_total_relation_size(c.oid)) as size
                    FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind = 'r'`;
      
      const result = await window.electronAPI.executeQuery(poolId, query, [database, tableName]);
      
      if (result && result.success && result.data && result.data.length > 0) {
        setTableInfo({
          owner: result.data[0].owner || 'Unknown',
          tablespace: result.data[0].tablespace || 'default',
          size: result.data[0].size || '0 B'
        });
      }
    } catch (error) {
      console.error('获取PostgreSQL表信息失败:', error);
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
  // 导出数据
  const handleExport = async (format: 'csv' | 'excel' | 'pdf' = 'csv') => {
    if (!data.length && !connection?.isConnected) {
      message.warning('没有可导出的数据');
      return;
    }
    
    // 直接使用exportCurrentPageOnly状态决定导出范围
    const scope = exportCurrentPageOnly ? 'current' : 'all';
    
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
                  return `"${key}" ${config.operator} $${params.length}`;
                  
                case 'LIKE':
                case 'NOT LIKE':
                  params.push(`%${config.value}%`);
                  return `"${key}" ${config.operator} $${params.length}`;
                  
                case 'STARTS WITH':
                  params.push(`${config.value}%`);
                  return `"${key}" LIKE $${params.length}`;
                  
                case 'ENDS WITH':
                  params.push(`%${config.value}`);
                  return `"${key}" LIKE $${params.length}`;
                  
                case 'IS NULL':
                  return `"${key}" IS NULL`;
                  
                case 'IS NOT NULL':
                  return `"${key}" IS NOT NULL`;
                  
                case 'BETWEEN':
                  if (config.value && config.value2) {
                    params.push(config.value, config.value2);
                    return `"${key}" BETWEEN $${params.length - 1} AND $${params.length}`;
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
          orderClause = ` ORDER BY "${sortConfig.column}" ${sortConfig.direction.toUpperCase()}`;
        }
        
        // 查询所有记录（不使用LIMIT）
        const query = `SELECT * FROM "${database}"."${tableName}" ${whereClause} ${orderClause}`;
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
      
      // 根据格式直接生成文件
      let formatMapping: {[key: string]: string} = {
        'csv': 'csv',
        'excel': 'xlsx',
        'pdf': 'pdf'
      };
      
      let targetFormat = formatMapping[format] || 'csv';
      
      // 特殊处理不同格式
      if (targetFormat === 'pdf') {
        // 生成PDF格式（简化版）
        const pdfContent = generatePdfContent(exportDataList);
        const fileName = `${tableName || 'export'}_data_${Date.now()}.pdf`;
        const blob = new Blob([pdfContent], { type: 'application/pdf;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = fileName;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => {
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        }, 100);
        message.success('PDF文件导出成功');
      } else if (targetFormat === 'xlsx') {
        // 使用现有的XLSX导出功能
        generateExportFile(exportDataList, 'xlsx');
      } else {
        // 使用现有的导出功能
        generateExportFile(exportDataList, targetFormat);
      }
    } catch (error) {
      console.error('导出数据失败:', error);
      message.error('导出数据失败');
    }
  };
  
  // 生成PDF内容（简化版）
  const generatePdfContent = (exportData: any[]) => {
    // 创建一个简单的PDF文本表示
    let content = `PostgreSQL 数据表导出: ${database}.${tableName}\n`;
    content += `导出时间: ${new Date().toLocaleString()}\n`;
    content += `记录数: ${exportData.length}\n\n`;
    
    // 添加列标题
    const headers = columns.map(col => col.title);
    content += headers.join('\t') + '\n';
    content += headers.map(() => '---').join('\t') + '\n';
    
    // 添加数据行
    exportData.forEach(row => {
      const rowValues = columns.map(col => {
        const value = row[col.dataIndex];
        if (value === null || value === undefined) return 'NULL';
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
      });
      content += rowValues.join('\t') + '\n';
    });
    
    return content;
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
  
  // 生成XLSX格式内容的函数
  const generateXlsxContent = (data: any[], cols: any[]) => {
    console.log('使用generateXlsxContent生成XLSX内容，数据量:', data.length);
    
    // 使用完整的HTML表格格式
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
        const value = row[col.dataIndex];
        xml += '      <' + col.dataIndex + '>' + escapeXml(String(value || '')) + '</' + col.dataIndex + '>' + '\n';
      });
      xml += '    </record>' + '\n';
    });
    
    xml += '  </table>' + '\n';
    xml += '</root>';
    return xml;
  };
  
  const generateSqlContent = (data: any[], cols: any[]) => {
    // 只包含可用于INSERT的列
    const insertableColumns = cols.filter(col => col.editable !== false);
    const columnNames = insertableColumns.map(col => col.dataIndex).join('", "');
    
    let sql = `INSERT INTO "${database}"."${tableName}"("${columnNames}") VALUES\n`;
    
    const values = data.map(row => {
      const rowValues = insertableColumns.map(col => {
        const value = row[col.dataIndex];
        if (value === null || value === undefined) {
          return 'NULL';
        } else if (typeof value === 'string') {
          // 转义单引号
          return `'${value.replace(/'/g, "''")}'`;
        } else if (typeof value === 'number') {
          return value.toString();
        } else {
          // 对于其他类型，转换为JSON字符串
          return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
        }
      });
      return `(${rowValues.join(', ')})`;
    });
    
    sql += values.join(',\n');
    sql += ';';
    
    return sql;
  };

  // 复制数据
  const handleCopyData = () => {
    if (!data.length) {
      message.warning('没有可复制的数据');
      return;
    }
    
    // 构建CSV格式的数据
    const headers = columns.map(col => col.title).join(',');
    const rows = data.map(row => 
      columns.map(col => {
        const value = row[col.dataIndex];
        if (value === null || value === undefined) return '';
        return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
      }).join(',')
    ).join('\n');
    
    const csv = `${headers}\n${rows}`;
    
    // 复制到剪贴板
    navigator.clipboard.writeText(csv)
      .then(() => message.success('数据已复制到剪贴板'))
      .catch(err => {
        console.error('复制失败:', err);
        message.error('复制失败');
        // 降级方案：使用传统的execCommand方法
        try {
          const textArea = document.createElement('textarea');
          textArea.value = csv;
          document.body.appendChild(textArea);
          textArea.select();
          document.execCommand('copy');
          document.body.removeChild(textArea);
          message.success('数据已复制到剪贴板');
        } catch (fallbackError) {
          console.error('降级复制也失败:', fallbackError);
        }
      });
  };

  // 查看记录详情
  const handleViewRecord = (record: TableData) => {
    // 这里可以实现显示记录详情的模态框
    Modal.info({
      title: '记录详情',
      content: (
        <div className="record-detail">
          {columns.map(col => (
            <div key={col.dataIndex} className="detail-row">
              <span className="detail-label">{col.title}:</span>
              <span className="detail-value">{record[col.dataIndex]}</span>
            </div>
          ))}
        </div>
      ),
      width: 600
    });
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
  }
  
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
    if (dbType && (dbType.includes('char') || dbType.includes('text') || dbType.includes('varchar'))) {
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
  }, [connection, database, tableName, currentPage, pageSize]);

  // 获取表结构
  const getTableSchema = async (poolId: string) => {
    try {
      // 使用主进程专用API获取包含schema的表结构
      const schemaResult = await window.electronAPI.getTableStructureWithSchema(poolId, database, tableName);
      if (schemaResult && schemaResult.success && schemaResult.structure && Array.isArray(schemaResult.structure.columns)) {
        const schemaColumns = schemaResult.structure.columns.map((col: any) => ({
          title: col.name,
          dataIndex: col.name,
          key: col.name,
          type: typeof col.type === 'string' && (
            col.type.toLowerCase().includes('int') ||
            col.type.toLowerCase().includes('numeric') ||
            col.type.toLowerCase().includes('float') ||
            col.type.toLowerCase().includes('double') ||
            col.type.toLowerCase().includes('decimal')
          ) ? 'number' : 'string',
          dbType: col.type,
          editable: col.name && col.name.toLowerCase().indexOf('created_at') === -1
        }));

        if (schemaColumns.length && visibleColumns.size === 0) {
          setVisibleColumns(new Set(schemaColumns.map((col: {key: string}) => col.key)));
        }

        setColumns(schemaColumns);
      }
    } catch (error) {
      console.error('获取表结构失败:', error);
    }
  };

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
        setTotal(0);
        return;
      }

      // 使用连接池ID
      const poolId = connection.connectionId || connection.id;
      if (!poolId) {
        message.error('连接池ID不存在');
        console.error('连接池ID不存在');
        setData([]);
        setColumns([]);
        setTotal(0);
        return;
      }

      console.log('PostgreSQL数据面板 - 尝试从数据库获取数据:', { connectionId: poolId, database, tableName });

      // 先获取表结构信息
      await getTableSchema(poolId);

      // 构建查询条件
      let whereClause = '';
      let params: any[] = [];
      
      // 处理文本模式的WHERE子句
      if (filterMode === 'text' && customWhereClause.trim()) {
        whereClause = ` WHERE ${customWhereClause.trim()}`;
      } 
      // 处理构建器模式的过滤条件
        else if (filterMode === 'builder' && Object.keys(filterConfig).length > 0) {
          const filterConditions = Object.entries(filterConfig)
            .map(([key, config]) => {
              // 确保config是对象类型
              if (typeof config !== 'object' || config === null) {
                return null;
              }
              
              const configObj = config as { operator: string; value?: string; value2?: string };
              
              if (!configObj.operator || (configObj.operator !== 'IS NULL' && configObj.operator !== 'IS NOT NULL' && !configObj.value)) {
                return null;
              }
              
              switch (configObj.operator) {
                case '=':
                case '<>':
                case '>':
                case '<':
                case '>=':
                case '<=':
                  params.push(configObj.value);
                  return `"${key}" ${configObj.operator} $${params.length}`;
                  
                case 'LIKE':
                case 'NOT LIKE':
                  params.push(`%${configObj.value}%`);
                  return `"${key}" ${configObj.operator} $${params.length}`;
                  
                case 'STARTS WITH':
                  params.push(`${configObj.value}%`);
                  return `"${key}" LIKE $${params.length}`;
                  
                case 'ENDS WITH':
                  params.push(`%${configObj.value}`);
                  return `"${key}" LIKE $${params.length}`;
                  
                case 'IS NULL':
                  return `"${key}" IS NULL`;
                  
                case 'IS NOT NULL':
                  return `"${key}" IS NOT NULL`;
                  
                case 'BETWEEN':
                  if (configObj.value && configObj.value2) {
                    params.push(configObj.value, configObj.value2);
                    return `"${key}" BETWEEN $${params.length - 1} AND $${params.length}`;
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
      // 处理搜索文本
      else if (searchText.trim()) {
        const searchConditions = columns
          .filter(col => col.type === 'string')
          .map(col => {
            params.push(`%${searchText}%`);
            return `"${col.dataIndex}" ILIKE $${params.length}`;
          });
        
        if (searchConditions.length > 0) {
          whereClause = ' WHERE ' + searchConditions.join(' OR ');
        }
      }
      
      // 添加排序
      let orderClause = '';
      if (sortConfig) {
        orderClause = ` ORDER BY "${sortConfig.column}" ${sortConfig.direction.toUpperCase()}`;
      }

      // PostgreSQL专用查询语句 - 使用双引号转义，使用LIMIT和OFFSET进行分页
      const query = `SELECT * FROM "${database}"."${tableName}" ${whereClause} ${orderClause} LIMIT ${pageSize} OFFSET ${(currentPage - 1) * pageSize}`;
      console.log('PostgreSQL数据查询:', query, '参数:', params);

      // 执行查询获取数据
      const result = await window.electronAPI.executeQuery(poolId, query, params);
      console.log('PostgreSQL查询结果:', result);

      if (result && result.success && Array.isArray(result.data)) {
        // 处理查询结果
        const realData = result.data.map((row: any, index: number) => ({
          key: index.toString(),
          ...row
        }));

        // 获取总记录数用于分页
        let totalCount = 1;
        const countQuery = `SELECT COUNT(*) AS total FROM "${database}"."${tableName}" ${whereClause}`;
        const countResult = await window.electronAPI.executeQuery(poolId, countQuery, params);
        totalCount = countResult && countResult.success && countResult.data.length > 0 
          ? countResult.data[0].total 
          : realData.length;

        // 动态生成列配置
        if (realData.length > 0) {
          const firstRow = realData[0];
          const realColumns = Object.keys(firstRow).map(key => ({
            title: key === 'key' ? '索引' : key,
            dataIndex: key,
            key: key,
            type: typeof firstRow[key] === 'number' ? 'number' : 'string',
            editable: key !== 'key' && key.toLowerCase() !== 'id' && key.toLowerCase().indexOf('created_at') === -1
          })).filter(col => col.key !== 'key'); // 移除key列

          // 初始化可见列
          if (realColumns.length && visibleColumns.size === 0) {
            setVisibleColumns(new Set(realColumns.map(col => col.key)));
          }

          setColumns(realColumns);
        } else {
          setColumns([]);
        }

        setData(realData);
        setTotal(totalCount);
      } else {
        console.warn('PostgreSQL未获取到数据或查询失败');
        setData([]);
        setColumns([]);
        setTotal(0);
      }
    } catch (error) {
      message.error('PostgreSQL加载数据失败');
      console.error('PostgreSQL加载数据失败:', error);
      setData([]);
      setColumns([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (record: TableData) => {
    setEditingRecord(record);
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
          // 实现PostgreSQL删除操作
          const poolId = connection?.connectionId || connection?.id;
          if (!poolId) {
            message.error('连接池ID不存在');
            return;
          }
          
          // 获取主键字段
          const primaryKeyQuery = `SELECT a.attname as column_name
                                 FROM pg_index i
                                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                                 WHERE i.indrelid = '"${database}"."${tableName}"'::regclass AND i.indisprimary`;
          const pkResult = await window.electronAPI.executeQuery(poolId, primaryKeyQuery);
          
          if (pkResult && pkResult.success && pkResult.data && pkResult.data.length > 0) {
            const primaryKey = pkResult.data[0].column_name;
            const deleteQuery = `DELETE FROM "${database}"."${tableName}" WHERE "${primaryKey}" = $1`;
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
          console.error('PostgreSQL删除失败:', error);
        }
      }
    });
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const poolId = connection?.connectionId || connection?.id;
      if (!poolId) {
        message.error('连接池ID不存在');
        return;
      }
      
      if (editingRecord) {
        // 编辑现有记录
        const primaryKeyQuery = `SELECT a.attname as column_name
                               FROM pg_index i
                               JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                               WHERE i.indrelid = '"${database}"."${tableName}"'::regclass AND i.indisprimary`;
        const pkResult = await window.electronAPI.executeQuery(poolId, primaryKeyQuery);
        
        if (pkResult && pkResult.success && pkResult.data && pkResult.data.length > 0) {
          const primaryKey = pkResult.data[0].column_name;
          const updateFields = Object.entries(values)
            .filter(([key]) => key !== primaryKey)
            .map(([key], index) => `"${key}" = $${index + 1}`)
            .join(', ');
          
          const updateValues = Object.entries(values)
            .filter(([key]) => key !== primaryKey)
            .map(([_, value]) => value);
          updateValues.push(editingRecord[primaryKey]);
          
          const updateQuery = `UPDATE "${database}"."${tableName}" SET ${updateFields} WHERE "${primaryKey}" = $${updateValues.length}`;
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
        const fields = Object.keys(values).map(key => `"${key}"`).join(', ');
        const placeholders = Object.keys(values).map((_, index) => `$${index + 1}`).join(', ');
        const insertValues = Object.values(values);
        
        const insertQuery = `INSERT INTO "${database}"."${tableName}" (${fields}) VALUES (${placeholders})`;
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

  const handleSearch = () => {
    setCurrentPage(1);
    loadTableData();
  };

  const handleRefresh = () => {
    loadTableData();
  };

  const actionColumn = {
    title: '操作',
    key: 'action',
    fixed: 'right',
    width: 160,
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
          icon={<EditOutlined />} 
          onClick={() => handleEdit(record)}
          size="small"
          className={darkMode ? 'dark-btn' : ''}
          disabled={isViewMode}
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
          disabled={isViewMode}
        >
          删除
        </Button>
      </Space>
    )
  };

  const renderFormFields = () => {
    const editableColumns = columns.filter(col => col.editable !== false);
    
    return editableColumns.map(col => {
      let inputComponent = <Input />;
      
      if (col.type === 'number') {
        inputComponent = <InputNumber style={{ width: '100%' }} />;
      } else if (col.dataIndex === 'email') {
        inputComponent = <Input type="email" />;
      }
      
      return (
        <Form.Item
          key={col.dataIndex}
          label={col.title}
          name={col.dataIndex}
          rules={[
            { required: true, message: `请输入${col.title}` }
          ]}
        >
          {inputComponent}
        </Form.Item>
      );
    });
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

  // 打开显示完整内容的弹窗 - 合并实现，避免重复
  const openFullTextModal = (content: string, title: string) => {
    setFullTextContent(content);
    setFullTextTitle(title);
    setFullTextModalVisible(true);
  };

  // 获取可见的列
  const getVisibleColumns = () => {
    // 确保操作列始终可见
    const visibleCols = columns
      .filter(col => visibleColumns.has(col.key))
      .map(col => ({
        ...col,
        // 添加排序功能
        sorter: true,
        sortDirections: ['asc', 'desc'] as const,
        onHeaderCell: (column: any) => ({
          onClick: () => {
            const currentDirection = sortConfig && sortConfig.column === column.dataIndex
              ? sortConfig.direction
              : null;
            
            let newDirection: 'asc' | 'desc' = 'asc';
            if (currentDirection === 'asc') {
              newDirection = 'desc';
            } else if (currentDirection === 'desc') {
              // 如果已经是降序，清除排序
              setSortConfig(null);
              setCurrentPage(1);
              loadTableData();
              return;
            }
            
            handleSort(column.dataIndex, newDirection);
          }
        }),
        // 为长文本和对象内容添加点击显示完整内容的功能
        render: (text: any) => {
          // 为字符串类型的长内容添加点击显示完整内容的功能
          if (typeof text === 'string' && text.length > 100) {
            return (
              <Tooltip title="点击查看完整内容">
                <span 
                  className="truncated-text cursor-pointer"
                  onClick={() => openFullTextModal(text, col.title)}
                >
                  {text.substring(0, 100)}...
                </span>
              </Tooltip>
            );
          }
          // 对于数组或对象类型，也添加点击显示完整内容的功能
          else if (text !== null && text !== undefined && typeof text === 'object') {
            try {
              const jsonString = JSON.stringify(text, null, 2);
              return (
                <Tooltip title="点击查看完整内容">
                  <span 
                    className="truncated-text cursor-pointer"
                    onClick={() => openFullTextModal(jsonString, col.title)}
                  >
                    [对象] {jsonString.length > 50 ? jsonString.substring(0, 50) + '...' : jsonString}
                  </span>
                </Tooltip>
              );
            } catch {
              return '[对象]';
            }
          }
          return text;
        }
      }));
    
    return [...visibleCols, actionColumn];
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
  // 获取导出菜单
  const getExportMenu = () => {
    return (
      <Menu className="export-menu">
        <Menu.Item key="csv" icon={<FileTextOutlined />} onClick={() => handleExport('csv')}>
          导出为 CSV
        </Menu.Item>
        <Menu.Item key="excel" icon={<FileExcelOutlined />} onClick={() => handleExport('excel')}>
          导出为 Excel
        </Menu.Item>
        <Menu.Item key="pdf" icon={<FilePdfOutlined />} onClick={() => handleExport('pdf')}>
          导出为 PDF
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item key="current-page">
          <Checkbox
            checked={exportCurrentPageOnly}
            onChange={(e) => setExportCurrentPageOnly(e.target.checked)}
          >
            仅导出当前页
          </Checkbox>
        </Menu.Item>
      </Menu>
    );
  };
  
  const getFilterMenu = () => {
    return (
      <div className="filter-menu">
        <h3 className="menu-title">过滤条件</h3>
        
        {/* 过滤模式切换 */}
        <div className="filter-mode-switch">
          <Radio.Group 
            value={filterMode} 
            onChange={(e) => setFilterMode(e.target.value)}
            size="small"
            className="filter-mode-radio"
          >
            <Radio.Button value="builder">构建器</Radio.Button>
            <Radio.Button value="text">文本模式</Radio.Button>
          </Radio.Group>
        </div>
        
        {/* 文本模式的WHERE子句输入 */}
        {filterMode === 'text' && (
          <div className="filter-text-mode">
            <div className="text-mode-label">自定义WHERE子句：</div>
            <Input.TextArea
              value={customWhereClause}
              onChange={(e) => setCustomWhereClause(e.target.value)}
              placeholder="输入WHERE子句内容（不需要WHERE关键字）"
              rows={4}
              className="text-mode-input"
            />
            <div className="text-mode-hint">提示：使用正确的PostgreSQL语法，例如：id {'>'} 10 AND name LIKE '%test%'</div>
          </div>
        )}
        
        {/* 构建器模式的过滤条件 */}
        {filterMode === 'builder' && (
          <div className="filter-builder-mode">
            {columns.map(col => {
              const operators = getAvailableOperators(col.type);
              const config = filterConfig[col.key] || {};
              const showValue2 = config.operator === 'BETWEEN';
              
              return (
                <div key={col.key} className="filter-item">
                  <label className="filter-label">{col.title}</label>
                  <div className="filter-input-group">
                    <Select
                      value={config.operator || '='}
                      onChange={(value) => updateFilterCondition(col.key, 'operator', value)}
                      style={{ width: 100 }}
                      size="small"
                    >
                      {operators.map(op => (
                        <Option key={op.value} value={op.value}>{op.label}</Option>
                      ))}
                    </Select>
                    
                    {(config.operator !== 'IS NULL' && config.operator !== 'IS NOT NULL') && (
                      <>
                        <Input
                          value={config.value || ''}
                          onChange={(e) => updateFilterCondition(col.key, 'value', e.target.value)}
                          placeholder={`过滤 ${col.title}`}
                          className="filter-input"
                        />
                        {showValue2 && (
                          <>
                            <span className="filter-input-separator">至</span>
                            <Input
                              value={config.value2 || ''}
                              onChange={(e) => updateFilterCondition(col.key, 'value2', e.target.value)}
                              placeholder={`结束值`}
                              className="filter-input"
                            />
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
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
    <div className="data-panel">
      {/* 工具栏 */}
      <div className="data-toolbar" style={{ marginBottom: '16px' }}>
        <Space>
          <Tooltip title="添加新记录">
            <Button 
              type="primary" 
              icon={<PlusOutlined />} 
              onClick={handleAdd}
              disabled={isViewMode}
            >
              新增
            </Button>
          </Tooltip>
          <Tooltip title="刷新数据">
            <Button 
              icon={<ReloadOutlined />} 
              onClick={handleRefresh}
              className={darkMode ? 'dark-btn' : ''}
            >
              刷新
            </Button>
          </Tooltip>
          <Dropdown 
            overlay={getExportMenu()} 
            trigger={['click']}
            className="export-dropdown"
          >
            <Tooltip title="导出数据">
              <Button 
                icon={<DownloadOutlined />}
                className={darkMode ? 'dark-btn' : ''}
              >
                导出
              </Button>
            </Tooltip>
          </Dropdown>
          <Tooltip title="复制数据">
            <Button 
              icon={<CopyOutlined />} 
              onClick={handleCopyData}
              className={darkMode ? 'dark-btn' : ''}
            >
              复制
            </Button>
          </Tooltip>
          <Tooltip title={isViewMode ? '退出只读模式' : '切换到只读模式'}>
            <Button 
              icon={<EyeOutlined />}
              type={isViewMode ? 'default' : 'primary'}
              onClick={() => setIsViewMode(!isViewMode)}
              className={darkMode ? 'dark-btn' : ''}
            >
            {isViewMode ? '编辑' : '只读'}
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
              style={{ position: 'relative' }}
            >
              过滤
              {(Object.keys(filterConfig).length > 0 || customWhereClause) && (
                <span style={{ 
                  position: 'absolute', 
                  top: -5, 
                  right: -5, 
                  background: '#ff4d4f', 
                  color: '#fff', 
                  borderRadius: 10, 
                  minWidth: 20, 
                  height: 20, 
                  fontSize: 12, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  border: '1px solid #fff'
                }}>
                  {Object.keys(filterConfig).length > 0 ? Object.keys(filterConfig).length : 1}
                </span>
              )}
            </Button>
          </Tooltip>
        </Space>
        
        <Space>
          <Input
            placeholder="搜索当前页数据..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 220 }}
            onPressEnter={handleSearch}
            className={darkMode ? 'dark-input' : ''}
            prefix={<SearchOutlined />}
            allowClear
          />
        </Space>
      </div>

      {/* 表格信息栏 */}
      <Card 
        size="small"
        bodyStyle={{ padding: '12px', marginBottom: '16px' }}
        style={{ 
          background: darkMode ? '#141414' : '#fff',
          border: `1px solid ${darkMode ? '#333' : '#d9d9d9'}`
        }}
      >
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', fontSize: '13px', alignItems: 'center' }}>
          <div>
            <strong style={{ color: darkMode ? '#fff' : '#000' }}>表信息: </strong>
            <span style={{ color: '#007BFF', fontWeight: 'bold' }}>"{database}"."{tableName}"</span>
          </div>
          {tableInfo.owner && <div><span style={{ color: darkMode ? '#aaa' : '#666' }}>所有者:</span> <strong>{tableInfo.owner}</strong></div>}
          {tableInfo.size && <div><span style={{ color: darkMode ? '#aaa' : '#666' }}>大小:</span> <strong>{tableInfo.size}</strong></div>}
          <div><span style={{ color: darkMode ? '#aaa' : '#666' }}>记录数:</span> <strong style={{ color: '#007BFF' }}>{total}</strong></div>
          <div><span style={{ color: darkMode ? '#aaa' : '#666' }}>列数:</span> <strong>{columns.length}</strong></div>
          {(Object.keys(filterConfig).length > 0 || customWhereClause) && (
            <div>
              <span style={{ color: '#ff4d4f' }}>⚠️ 已应用过滤条件</span>
              <Button 
                type="link" 
                danger
                size="small"
                onClick={() => {
                  setFilterConfig({});
                  setCustomWhereClause('');
                  setCurrentPage(1);
                  loadTableData();
                  message.success('已清除所有过滤条件');
                }}
                style={{ padding: '0 4px' }}
              >
                清除
              </Button>
            </div>
          )}
          {sortConfig && (
            <div className="sort-info" style={{ marginLeft: 'auto' }}>
              排序: {columns.find(c => c.key === sortConfig.column)?.title || sortConfig.column}
              ({sortConfig.direction === 'asc' ? '升序' : '降序'})
              <Button 
                size="small" 
                type="link" 
                onClick={() => {
                  setSortConfig(null);
                  loadTableData();
                }}
                style={{ padding: '0 4px', marginLeft: '8px' }}
              >
                清除
              </Button>
            </div>
          )}
        </div>
      </Card>

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
            <Spin tip="PostgreSQL加载中..." />
          </div>
        ) : (
          <Table
            dataSource={data}
            columns={getVisibleColumns()}
            size="small"
            pagination={false}
            scroll={{ x: true, y: 'calc(100vh - 380px)' }}
            bordered
            rowKey="id"
            className={darkMode ? 'dark-table' : ''}
            // 自定义表头样式
            components={{
              header: {
                cell: ({ className, children, ...props }: any) => (
                  <th 
                    className={`${className} ${darkMode ? 'dark-table-header' : ''}`} 
                    {...props}
                  >
                    {children}
                  </th>
                )
              },
              body: {
                cell: ({ className, children, ...props }: any) => (
                  <td 
                    className={`${className} ${darkMode ? 'dark-table-cell' : ''}`} 
                    {...props}
                  >
                    {children}
                  </td>
                )
              }
            }}
            // 设置当前排序状态
            sortDirections={['ascend', 'descend'] as const}
          />
        )}
        
        {/* 分页 */}
        <div className="pagination-container">
          <Pagination
            current={currentPage}
            pageSize={pageSize}
            total={total}
            showSizeChanger
            showQuickJumper
            showTotal={(total, range) => 
              `第 ${range[0]}-${range[1]} 条，共 ${total} 条`
            }
            onChange={(page, size) => {
              setCurrentPage(page);
              setPageSize(size || 20);
            }}
            className={darkMode ? 'dark-pagination' : ''}
          />
        </div>
      </div>

      {/* 编辑模态框 */}
      <Modal
        title={editingRecord ? '编辑记录' : '新增记录'}
        open={isEditModalVisible || isAddModalVisible}
        onOk={handleSave}
        onCancel={() => {
          setIsEditModalVisible(false);
          setIsAddModalVisible(false);
        }}
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
      
      {/* 完整内容显示模态框 */}
      <Modal
        title={`完整内容 - ${fullTextTitle}`}
        open={fullTextModalVisible}
        onCancel={() => setFullTextModalVisible(false)}
        width={800}
        footer={[
          <Button 
            key="close" 
            onClick={() => setFullTextModalVisible(false)}
            className={darkMode ? 'dark-btn' : ''}
          >
            关闭
          </Button>
        ]}
        className={darkMode ? 'dark-modal' : ''}
      >
        <pre className="full-text-content">{fullTextContent}</pre>
      </Modal>
    </div>
  );
};

export default PostgreSqlDataPanel;