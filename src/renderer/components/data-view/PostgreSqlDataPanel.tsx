import React, { useState, useEffect } from 'react';
import { Button, Table, Space, Modal, Form, Input, InputNumber, Select, message, Card, Pagination, Spin, Tooltip } from 'antd';
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
  RestOutlined
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
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [isEditModalVisible, setIsEditModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<TableData | null>(null);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [form] = Form.useForm();
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set());
  const [isColumnMenuVisible, setIsColumnMenuVisible] = useState(false);
  const [isFilterMenuVisible, setIsFilterMenuVisible] = useState(false);
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
  const [filterMode, setFilterMode] = useState<'builder' | 'text'>('builder');
  const [customWhereClause, setCustomWhereClause] = useState('');

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
  const handleExport = () => {
    if (!data.length) {
      message.warning('没有可导出的数据');
      return;
    }
    
    // 导出为CSV
    const headers = columns.map(col => col.title).join(',');
    const rows = data.map(row => 
      columns.map(col => {
        const value = row[col.dataIndex];
        return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
      }).join(',')
    ).join('\n');
    
    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${tableName}_data_${Date.now()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    message.success('数据已导出为CSV文件');
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
  
  // 更新单个过滤条件
  const updateFilterCondition = (column: string, field: 'operator' | 'value' | 'value2', value: string) => {
    setFilterConfig(prev => {
      // 确保当前配置是FilterCondition类型
      const currentConfig: FilterCondition = prev[column] || { operator: '=', value: '', value2: '' };
      return {
        ...prev,
        [column]: {
          ...currentConfig,
          [field]: value
        }
      };
    });
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
      // 在PostgreSQL中，我们通过查询pg_attribute表获取列信息
      const schemaQuery = `SELECT a.attname as Field,
                               pg_catalog.format_type(a.atttypid, a.atttypmod) as Type,
                               (SELECT substring(pg_catalog.pg_get_expr(d.adbin, d.adrelid) for 128)
                                FROM pg_catalog.pg_attrdef d
                                WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum AND a.atthasdef) as Default,
                               CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END as Null,
                               CASE WHEN EXISTS(
                                 SELECT 1
                                 FROM pg_catalog.pg_index i
                                 JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid
                                 JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
                                 JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                                 WHERE i.indrelid = a.attrelid
                                   AND a.attnum = ANY(i.indkey)
                                   AND i.indisprimary
                               ) THEN 'PRI' ELSE '' END as Key
                        FROM pg_catalog.pg_attribute a
                        JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
                        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
                        WHERE c.relname = $1
                          AND n.nspname = $2
                          AND a.attnum > 0
                          AND NOT a.attisdropped
                        ORDER BY a.attnum;`;
      
      const schemaResult = await window.electronAPI.executeQuery(poolId, schemaQuery, [tableName, database]);
      
      if (schemaResult && schemaResult.success && Array.isArray(schemaResult.data)) {
        // 构建schemaColumns，确保保存完整的数据库类型信息
        const schemaColumns = schemaResult.data.map((col: any) => ({
          title: col.Field,
          dataIndex: col.Field,
          key: col.Field,
          type: col.Type.includes('int') || col.Type.includes('numeric') || 
                col.Type.includes('float') || col.Type.includes('double precision') ||
                col.Type.includes('decimal') ? 'number' : 'string',
          dbType: col.Type, // 存储原始数据库字段类型
          editable: col.Key !== 'PRI' && col.Field.toLowerCase().indexOf('created_at') === -1
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
  const getFilterMenu = () => {
    return (
      <div className="filter-menu">
        <h3 className="menu-title">过滤条件</h3>
        {columns.map(col => (
          <div key={col.key} className="filter-item">
            <label className="filter-label">{col.title}</label>
            <div className="filter-input-group">
              <Select
                value={filterConfig[col.key]?.operator || '='}
                onChange={(value) => updateFilterCondition(col.key, 'operator', value)}
                style={{ width: 80 }}
                size="small"
              >
                <Option value="=">=</Option>
                <Option value="!=">≠</Option>
                <Option value=">">{'>'}</Option>
                <Option value=">=">≥</Option>
                <Option value="<">{'<'}</Option>
                <Option value="<=">≤</Option>
                <Option value="LIKE">包含</Option>
                <Option value="NOT LIKE">不包含</Option>
              </Select>
              <Input
                value={filterConfig[col.key]?.value || ''}
                onChange={(e) => updateFilterCondition(col.key, 'value', e.target.value)}
                placeholder={`过滤 ${col.title}`}
                className="filter-input"
              />
            </div>
          </div>
        ))}
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
      <div className="data-toolbar">
        <Space>
          <Button 
            type="primary" 
            icon={<PlusOutlined />} 
            onClick={handleAdd}
          >
            新增
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
          <Tooltip title="复制数据">
            <Button 
              icon={<CopyOutlined />} 
              onClick={handleCopyData}
              className={darkMode ? 'dark-btn' : ''}
            >
              复制
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
        
        <Space>
          <Input
            placeholder="搜索..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 200 }}
            onPressEnter={handleSearch}
            className={darkMode ? 'dark-input' : ''}
          />
          <Button 
            icon={<SearchOutlined />} 
            onClick={handleSearch}
            className={darkMode ? 'dark-btn' : ''}
          >
            搜索
          </Button>
        </Space>
      </div>

      {/* 表格信息栏 */}
      <div className="table-info">
        <div className="table-name-info">
          <strong>{database}.{tableName}</strong>
          <span className="table-stats">
            ({total} 条记录, {columns.length} 列)
          </span>
          {tableInfo.owner && (
            <span className="table-owner">
              | Owner: {tableInfo.owner}, Size: {tableInfo.size}
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