import React, { useState, useEffect } from 'react';
import { Card, Table, Pagination, Spin, Empty, Select, Space, Button } from 'antd';
import { ReloadOutlined, DatabaseOutlined, ColumnHeightOutlined } from '@ant-design/icons';
import { DatabaseConnection } from '../types';

const { Option } = Select;

interface TableDataPanelProps {
  connection: DatabaseConnection;
  database: string;
  tableName: string;
  darkMode: boolean;
}

const TableDataPanel: React.FC<TableDataPanelProps> = ({ 
  connection, 
  database, 
  tableName, 
  darkMode 
}) => {
  const [data, setData] = useState<any[]>([]);
  const [columns, setColumns] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [total, setTotal] = useState<number>(0);
  const [pageSize, setPageSize] = useState<number>(200);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [error, setError] = useState<string>('');

  // 加载表数据
  const loadTableData = async (page: number, size: number) => {
    if (!connection || !connection.isConnected || !window.electronAPI) {
      setError('数据库未连接或Electron API不可用');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    
    try {
      const poolId = connection.connectionId || connection.id;
      
      // 获取表结构 - 格式为 database.tableName
      const tableStructure = await window.electronAPI.getTableStructure(poolId, `${database}.${tableName}`);
      
      if (tableStructure && tableStructure.success && tableStructure.structure) {
        // 设置列定义
        const tableColumns = tableStructure.structure.columns.map((column: any) => ({
          title: `${column.name} (${column.type})`,
          dataIndex: column.name,
          key: column.name,
          sorter: true,
          ellipsis: true,
          render: (text: any) => {
            if (text === null) return <span style={{ color: '#999' }}>NULL</span>;
            if (typeof text === 'string' && text.length > 200) {
              return <span title={text}>{text.substring(0, 200)}...</span>;
            }
            return text;
          }
        }));
        setColumns(tableColumns);
        
        // 获取总行数 - 使用数据库名.表名格式
        const countQuery = `SELECT COUNT(*) as count FROM \`${database}\`.\`${tableName}\``;
        const countResult = await window.electronAPI.executeQuery(poolId, countQuery, []);
        
        if (countResult && countResult.success && countResult.data && countResult.data.length > 0) {
          setTotal(countResult.data[0].count || 0);
        }
        
        // 获取当前页数据 - 使用数据库名.表名格式
        const offset = (page - 1) * size;
        // 直接拼接到SQL语句中，避免参数化查询可能导致的问题
        const dataQuery = `SELECT * FROM \`${database}\`.\`${tableName}\` LIMIT ${size} OFFSET ${offset}`;
        const dataResult = await window.electronAPI.executeQuery(poolId, dataQuery, []);
        
        if (dataResult && dataResult.success && Array.isArray(dataResult.data)) {
          // 为每个数据项添加唯一key
          const processedData = dataResult.data.map((item: any, index: number) => ({
            ...item,
            key: index + offset
          }));
          setData(processedData);
        } else {
          setError('查询表数据失败');
          console.error('表数据查询返回非预期结果:', JSON.stringify(dataResult, null, 2));
        }
      } else {
        setError('获取表结构失败');
        console.error('表结构查询返回非预期结果:', JSON.stringify(tableStructure, null, 2));
      }
    } catch (err) {
      setError(`加载表数据失败: ${err instanceof Error ? err.message : String(err)}`);
      console.error('加载表数据异常:', err);
    } finally {
      setLoading(false);
    }
  };

  // 处理分页变化
  const handlePageChange = (page: number, newPageSize?: number) => {
    setCurrentPage(page);
    if (newPageSize) {
      setPageSize(newPageSize);
      loadTableData(page, newPageSize);
    } else {
      loadTableData(page, pageSize);
    }
  };

  // 处理页面大小变化
  const handlePageSizeChange = (current: number, size: number) => {
    setPageSize(size);
    setCurrentPage(1);
    loadTableData(1, size);
  };

  // 刷新数据
  const handleRefresh = () => {
    loadTableData(currentPage, pageSize);
  };

  // 当连接、数据库或表名变化时，重新加载数据
  useEffect(() => {
    if (connection && connection.isConnected && database && tableName) {
      setCurrentPage(1);
      loadTableData(1, pageSize);
    }
  }, [connection, database, tableName]);

  return (
    <div className={`table-data-panel ${darkMode ? 'dark' : ''}`} style={{ height: '100%', padding: '16px' }}>
      <Card 
        title={
          <Space>
            <DatabaseOutlined />
            <span>{database}.{tableName}</span>
          </Space>
        }
        size="small"
        extra={
          <Space>
            <Select 
              value={pageSize} 
              onChange={(value) => handlePageSizeChange(currentPage, value)} 
              style={{ width: 100 }}
            >
              <Option value={200}>200条/页</Option>
              <Option value={500}>500条/页</Option>
              <Option value={1000}>1000条/页</Option>
            </Select>
            <Button 
              icon={<ReloadOutlined />} 
              onClick={handleRefresh} 
              loading={loading}
            >
              刷新
            </Button>
          </Space>
        }
        className="table-data-card"
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <Spin size="large" tip="加载数据中..." />
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#f5222d' }}>
            <Empty description={error} />
          </div>
        ) : data.length > 0 ? (
          <>
            <Table
              columns={columns}
              dataSource={data}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
              className="table-data-table"
            />
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                共 {total} 条记录，每页显示 {pageSize} 条
              </div>
              <Pagination
                current={currentPage}
                pageSize={pageSize}
                total={total}
                onChange={handlePageChange}
                showSizeChanger
                pageSizeOptions={['200', '500', '1000']}
                onShowSizeChange={handlePageSizeChange}
                showTotal={(total) => `共 ${total} 条`}
              />
            </div>
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <Empty description="表中暂无数据" />
          </div>
        )}
      </Card>
    </div>
  );
};

export default TableDataPanel;