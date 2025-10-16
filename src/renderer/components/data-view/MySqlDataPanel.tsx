import React, { useState, useEffect } from 'react';
import { Button, Table, Space, Modal, Form, Input, InputNumber, Select, message, Card, Pagination, Spin, Tooltip, Empty, Badge, Radio } from 'antd';
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
  const [searchText, setSearchText] = useState('');
  const [form] = Form.useForm();
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set());
  const [isColumnMenuVisible, setIsColumnMenuVisible] = useState(false);
  const [isFilterMenuVisible, setIsFilterMenuVisible] = useState(false);
  const [fullTextModalVisible, setFullTextModalVisible] = useState(false);
  const [fullTextContent, setFullTextContent] = useState('');
  const [fullTextTitle, setFullTextTitle] = useState('');
  const [filterMode, setFilterMode] = useState<'builder' | 'text'>('builder'); // 'builder'创建工具模式，'text'文本模式
  const [customWhereClause, setCustomWhereClause] = useState(''); // 文本模式的自定义WHERE子句
  
  // 过滤条件配置，格式：{ columnName: { operator: string, value: string, value2?: string } }
  const [filterConfig, setFilterConfig] = useState<{
    [key: string]: { operator: string; value: string; value2?: string }
  }>({});
  
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
      // 使用DESCRIBE获取表结构
      const describeQuery = `DESCRIBE \`${database}\`\.\`${tableName}\``;
      const schemaResult = await window.electronAPI.executeQuery(poolId, describeQuery, []);
      
      if (schemaResult && schemaResult.success && schemaResult.data.length > 0) {
        const schemaColumns = schemaResult.data.map((field: any) => ({
          title: field.Field,
          dataIndex: field.Field,
          key: field.Field,
          type: field.Type, // 保存字段类型
          editable: field.Field.toLowerCase() !== 'id' && field.Field.toLowerCase().indexOf('created_at') === -1
        }));

        // 初始化可见列
        if (schemaColumns.length && visibleColumns.size === 0) {
          setVisibleColumns(new Set(schemaColumns.map((col: {key: string}) => col.key)));
        }

        // 只有当没有数据或当前没有列配置时，才设置列配置
        if (columns.length === 0) {
          setColumns(schemaColumns);
        }
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

        // 动态生成列配置
          if (realData.length > 0) {
            const firstRow = realData[0];
            const realColumns = Object.keys(firstRow).map(key => {
              // 尝试从已有的columns中获取dbType信息
              const existingColumn = columns.find(col => col.key === key);
              return {
                title: key === 'key' ? '索引' : key,
                dataIndex: key,
                key: key,
                type: typeof firstRow[key] === 'number' ? 'number' : 'string',
                dbType: existingColumn?.dbType, // 保留已有的数据库类型信息
                editable: key !== 'key' && key.toLowerCase() !== 'id' && key.toLowerCase().indexOf('created_at') === -1
              };
            }).filter(col => col.key !== 'key'); // 移除key列

            // 初始化可见列
            if (realColumns.length && visibleColumns.size === 0) {
              setVisibleColumns(new Set(realColumns.map(col => col.key)));
            }

            setColumns(realColumns);
          }

        setData(realData);
      } else {
        console.warn('MySQL未获取到数据或查询失败');
        setData([]);
        setColumns([]);
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