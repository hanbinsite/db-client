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
      // 模拟加载表数据
      const mockColumns = [
        { title: 'ID', dataIndex: 'id', key: 'id', type: 'int', editable: false },
        { title: '姓名', dataIndex: 'name', key: 'name', type: 'varchar', editable: true },
        { title: '邮箱', dataIndex: 'email', key: 'email', type: 'varchar', editable: true },
        { title: '年龄', dataIndex: 'age', key: 'age', type: 'int', editable: true },
        { title: '创建时间', dataIndex: 'created_at', key: 'created_at', type: 'datetime', editable: false }
      ];

      const mockData: TableData[] = Array.from({ length: 50 }, (_, index) => ({
        key: index.toString(),
        id: index + 1,
        name: `用户${index + 1}`,
        email: `user${index + 1}@example.com`,
        age: Math.floor(Math.random() * 50) + 18,
        created_at: new Date(Date.now() - Math.random() * 10000000000).toISOString().split('T')[0]
      }));

      // 应用搜索过滤
      let filteredData = mockData;
      if (searchText) {
        filteredData = mockData.filter(item =>
          Object.values(item).some(value =>
            value && value.toString().toLowerCase().includes(searchText.toLowerCase())
          )
        );
      }

      // 应用列过滤
      Object.entries(filterConfig).forEach(([column, value]) => {
        if (value) {
          filteredData = filteredData.filter(item => {
            const cellValue = item[column];
            return cellValue && cellValue.toString().toLowerCase().includes(value.toLowerCase());
          });
        }
      });

      // 应用排序
      if (sortConfig) {
        filteredData.sort((a, b) => {
          const aValue = a[sortConfig.column];
          const bValue = b[sortConfig.column];
          
          if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
          if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
          return 0;
        });
      }

      // 初始化可见列
      if (mockColumns.length && visibleColumns.size === 0) {
        setVisibleColumns(new Set(mockColumns.map(col => col.key)));
      }

      // 分页
      const startIndex = (currentPage - 1) * pageSize;
      const paginatedData = filteredData.slice(startIndex, startIndex + pageSize);

      setColumns(mockColumns);
      setData(paginatedData);
      setTotal(filteredData.length);
    } catch (error) {
      message.error('加载数据失败');
      console.error('加载数据失败:', error);
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