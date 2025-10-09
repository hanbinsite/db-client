import React, { useState, useEffect, useContext } from 'react';
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
import { DatabaseConnection } from '../types';
import { useTheme } from './ThemeContext';
import './DataPanel.css';

const { Option } = Select;

interface DataPanelProps {
  connection: DatabaseConnection | null;
  database: string;
  table: string;
}

interface TableData {
  key: string;
  [key: string]: any;
}

const DataPanel: React.FC<DataPanelProps> = ({ connection, database, table }) => {
  const { darkMode } = useTheme();
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
  const [filterConfig, setFilterConfig] = useState<{[key: string]: string}>({});
  const [sortConfig, setSortConfig] = useState<{column: string; direction: 'asc' | 'desc'} | null>(null);

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
    link.setAttribute('download', `${table}_data_${Date.now()}.csv`);
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
    if (connection && connection.isConnected && database && table) {
      loadTableData();
    } else {
      setData([]);
      setColumns([]);
    }
  }, [connection, database, table, currentPage, pageSize]);

  const loadTableData = async () => {
    if (!connection || !database || !table) return;

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

      console.log('尝试从真实数据库获取数据:', { connectionId: poolId, database, table });

      // 初始化params变量和查询语句
      let paramsArray: any[] = [];
      let query = '';
      
      // 根据数据库类型构建查询语句
      switch (connection.type) {
        case 'mysql':
          query = `SELECT * FROM \`${database}\`.\`${table}\` LIMIT ${(currentPage - 1) * pageSize}, ${pageSize}`;
          break;
        case 'postgresql':
        case 'gaussdb':
          query = `SELECT * FROM "${database}"."${table}" LIMIT ${pageSize} OFFSET ${(currentPage - 1) * pageSize}`;
          break;
        case 'oracle':
          // Oracle 分页语法不同
          query = `SELECT * FROM (SELECT t.*, ROWNUM rn FROM "${database}"."${table}" t) WHERE rn BETWEEN ${(currentPage - 1) * pageSize + 1} AND ${currentPage * pageSize}`;
          break;
        case 'sqlite':
          query = `SELECT * FROM "${table}" LIMIT ${pageSize} OFFSET ${(currentPage - 1) * pageSize}`;
          break;
        case 'redis':
          // Redis特殊处理 - 获取键的值
          query = 'get';
          paramsArray = [table];
          break;
        default:
          query = `SELECT * FROM "${table}" LIMIT ${pageSize} OFFSET ${(currentPage - 1) * pageSize}`;
      }

      // 执行查询获取数据
      const result = await window.electronAPI.executeQuery(poolId, query, paramsArray);
      console.log('数据库查询结果:', result);

      if (result && result.success && Array.isArray(result.data)) {
        // 处理查询结果
        const realData = result.data.map((row: any, index: number) => ({
          key: index.toString(),
          ...row
        }));

        // 获取总记录数用于分页
      let totalCount = 1; // 默认至少有一条记录
      if (connection.type !== 'redis') {
        let countQuery = '';
        switch (connection.type) {
          case 'mysql':
            countQuery = `SELECT COUNT(*) AS total FROM \`${database}\`.\`${table}\``;
            break;
          case 'postgresql':
          case 'gaussdb':
            countQuery = `SELECT COUNT(*) AS total FROM "${database}"."${table}"`;
            break;
          case 'oracle':
            countQuery = `SELECT COUNT(*) AS total FROM "${database}"."${table}"`;
            break;
          case 'sqlite':
            countQuery = `SELECT COUNT(*) AS total FROM "${table}"`;
            break;
          default:
            countQuery = `SELECT COUNT(*) AS total FROM "${table}"`;
        }

        const countResult = await window.electronAPI.executeQuery(poolId, countQuery);
        totalCount = countResult && countResult.success && countResult.data.length > 0 
          ? countResult.data[0].total 
          : realData.length;
      }

        // 动态生成列配置
        if (realData.length > 0) {
          if (connection.type === 'redis') {
            // Redis特殊处理 - 为键值对创建特殊的列配置
            const keyName = table;
            let value = realData[0]?.value;
            if (value === undefined) {
              // 如果result格式不同，尝试其他方式获取值
              if (typeof realData[0] === 'object' && realData[0] !== null) {
                value = JSON.stringify(realData[0]);
              } else {
                value = realData[0];
              }
            }

            // 获取键的类型
            const typeResult = await window.electronAPI.executeQuery(poolId, 'type', [keyName]);
            let keyType = 'string';
            if (typeResult && typeResult.success && typeResult.data && typeResult.data.length > 0) {
              keyType = typeResult.data[0].value || 'string';
            }

            const realColumns = [
              {
                title: '键名',
                dataIndex: 'key',
                key: 'key',
                type: 'string',
                editable: false
              },
              {
                title: '值',
                dataIndex: 'value',
                key: 'value',
                type: typeof value === 'number' ? 'number' : 'string',
                editable: true
              },
              {
                title: '类型',
                dataIndex: 'type',
                key: 'type',
                type: 'string',
                editable: false
              }
            ];

            // 设置数据格式化为对象数组
            setData([{
              key: keyName,
              value: value,
              type: keyType
            }]);

            // 初始化可见列
            if (realColumns.length && visibleColumns.size === 0) {
              setVisibleColumns(new Set(realColumns.map(col => col.key)));
            }

            setColumns(realColumns);
          } else {
            // 传统数据库的处理方式
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
          }
        } else {
          setColumns([]);
        }

        setData(realData);
        setTotal(totalCount);
      } else {
        console.warn('未获取到数据或查询失败');
        setData([]);
        setColumns([]);
        setTotal(0);
      }
    } catch (error) {
      message.error('加载数据失败');
      console.error('加载数据失败:', error);
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

  const handleDelete = (record: TableData) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除这条记录吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          // 模拟删除操作
          setData(prev => prev.filter(item => item.key !== record.key));
          message.success('删除成功');
        } catch (error) {
          message.error('删除失败');
        }
      }
    });
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      
      if (editingRecord) {
        // 编辑现有记录
        setData(prev => prev.map(item => 
          item.key === editingRecord.key ? { ...item, ...values } : item
        ));
        message.success('更新成功');
        setIsEditModalVisible(false);
      } else {
        // 添加新记录
        const newRecord: TableData = {
          key: Date.now().toString(),
          ...values,
          id: data.length + 1,
          created_at: new Date().toISOString().split('T')[0]
        };
        setData(prev => [newRecord, ...prev]);
        message.success('添加成功');
        setIsAddModalVisible(false);
      }
    } catch (error) {
      console.error('保存失败:', error);
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
      
      if (col.type === 'int') {
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

  if (!database || !table) {
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
        })
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
            <Input
              value={filterConfig[col.key] || ''}
              onChange={(e) => setFilterConfig(prev => ({
                ...prev,
                [col.key]: e.target.value
              }))}
              placeholder={`过滤 ${col.title}`}
              className="filter-input"
            />
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
    <div className={`data-panel ${darkMode ? 'dark' : ''}`}>
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
          <strong>{database}.{table}</strong>
          <span className="table-stats">
            ({total} 条记录, {columns.length} 列)
          </span>
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
            <Spin tip="加载中..." />
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
    </div>
  );
};

export default DataPanel;