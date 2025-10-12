import React, { useState, useEffect } from 'react';
import { Card, Table, Pagination, Spin, Empty, Select, Space, Button, Input, InputNumber, Checkbox, Modal, Form, message, Tag } from 'antd';
import { DatePicker, TimePicker } from 'antd';
const { RangePicker } = DatePicker;
import { ReloadOutlined, DatabaseOutlined, ColumnHeightOutlined, DeleteOutlined, PlusOutlined, SaveOutlined, FilterOutlined, DownloadOutlined, UploadOutlined, SwapRightOutlined, DatabaseFilled, EditOutlined, TableOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { DatabaseConnection, TableColumn, DataEditOperation, TransactionConfig } from '../types';
import RecordDetailModal from './RecordDetailModal';

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
  const [editingKey, setEditingKey] = useState<string | undefined>();
  const [editCache, setEditCache] = useState<{ [key: string]: any }>({});
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [editOperations, setEditOperations] = useState<DataEditOperation[]>([]);
  const [tableStructure, setTableStructure] = useState<TableColumn[]>([]);
  const [transactionActive, setTransactionActive] = useState<boolean>(false);
  const [transactionId, setTransactionId] = useState<string>('');
  const [filterMode, setFilterMode] = useState<'normal' | 'all' | false>(false);
  const [filterConditions, setFilterConditions] = useState<{ [key: string]: string }>({});
  const [sortOrder, setSortOrder] = useState<{ column: string; order: 'ascend' | 'descend' } | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([]);
  const [showColumnSelector, setShowColumnSelector] = useState<boolean>(false);
  const [tableStructureSchema, setTableStructureSchema] = useState<string>('');
  const [showDetailModal, setShowDetailModal] = useState<boolean>(false);
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [editingRecord, setEditingRecord] = useState<any>(null);
  // 导出相关状态
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [showFormatModal, setShowFormatModal] = useState<boolean>(false);
  const [exportType, setExportType] = useState<'all' | 'current' | null>(null);
  const [exportFormat, setExportFormat] = useState<string>('csv');
  const [exportLoading, setExportLoading] = useState<boolean>(false);

  // 根据字段类型渲染筛选控件
  const renderFilterControl = (column: TableColumn) => {
    const type = column.type.toLowerCase();
    const currentValue = filterConditions[column.name] || '';
    
    // 日期时间类型 - 提供日期时间范围选择
    if (type.includes('datetime') || (type.includes('date') && type.includes('time'))) {
      const [start, end] = currentValue.split('||') || ['', ''];
      return (
        <RangePicker 
          style={{ width: 300 }}
          showTime={true}
          onChange={(dates, dateStrings) => {
            if (dates && dateStrings && dateStrings.length === 2) {
              handleFilterChange(column.name, `${dateStrings[0]}||${dateStrings[1]}`);
            } else {
              handleFilterChange(column.name, '');
            }
          }}
        />
      );
    }
    
    // 日期类型 - 提供日期范围选择
    if (type.includes('date') && !type.includes('time')) {
      const [start, end] = currentValue.split('||') || ['', ''];
      return (
        <RangePicker 
          style={{ width: 250 }}
          onChange={(dates, dateStrings) => {
            if (dates && dateStrings && dateStrings.length === 2) {
              handleFilterChange(column.name, `${dateStrings[0]}||${dateStrings[1]}`);
            } else {
              handleFilterChange(column.name, '');
            }
          }}
        />
      );
    }
    
    // 数值类型
    if (type.includes('int') || type.includes('float') || type.includes('double') || type.includes('decimal')) {
      return (
        <InputNumber
          style={{ width: 150 }}
          placeholder={`输入 ${column.name}`}
          value={currentValue === '' ? undefined : parseFloat(currentValue)}
          onChange={(value) => {
            handleFilterChange(column.name, value === null || value === undefined ? '' : String(value));
          }}
        />
      );
    }
    
    // 布尔类型
    if (type.includes('boolean')) {
      return (
        <Select
          style={{ width: 150 }}
          value={currentValue}
          placeholder="请选择"
          onChange={(value) => {
            handleFilterChange(column.name, value);
          }}
        >
          <Option value="">全部</Option>
          <Option value="true">是</Option>
          <Option value="false">否</Option>
        </Select>
      );
    }
    
    // 默认文本输入
    return (
      <Input
        placeholder={`搜索 ${column.name}`}
        value={currentValue}
        onChange={(e) => handleFilterChange(column.name, e.target.value)}
        style={{ width: 200 }}
      />
    );
  };

  // 获取适合字段类型的编辑器
  const getFieldEditor = (column: TableColumn, record: any, handleSave: () => void) => {
    const value = editCache[record.key]?.[column.name] ?? record[column.name];
    const type = column.type.toLowerCase();
    
    if (type.includes('int') || type.includes('float') || type.includes('double') || type.includes('decimal')) {
      return (
        <InputNumber
          min={-999999999}
          max={999999999}
          style={{ width: '100%' }}
          value={value === null ? undefined : value}
          onChange={(newValue) => {
            setEditCache({
              ...editCache,
              [record.key]: {
                ...editCache[record.key],
                [column.name]: newValue === undefined ? null : newValue
              }
            });
          }}
        />
      );
    } else if (type.includes('boolean')) {
      return (
        <Checkbox
          checked={value === true || value === 'true' || value === 1}
          onChange={(e) => {
            setEditCache({
              ...editCache,
              [record.key]: {
                ...editCache[record.key],
                [column.name]: e.target.checked
              }
            });
          }}
        />
      );
    } else if (type.includes('date') || type.includes('time')) {
      return (
        <Input
          value={value === null ? '' : value}
          onChange={(e) => {
            setEditCache({
              ...editCache,
              [record.key]: {
                ...editCache[record.key],
                [column.name]: e.target.value === '' ? null : e.target.value
              }
            });
          }}
        />
      );
    } else {
      // 默认文本输入
      return (
        <Input
          value={value === null ? '' : value}
          onChange={(e) => {
            setEditCache({
              ...editCache,
              [record.key]: {
                ...editCache[record.key],
                [column.name]: e.target.value === '' ? null : e.target.value
              }
            });
          }}
        />
      );
    }
  };

  // 开始编辑
  const startEditing = (record: any) => {
    if (record && record.key !== undefined) {
      setEditingKey(record.key);
      setEditCache({
        ...editCache,
        [record.key]: { ...record }
      });
    }
  };

  // 点击单元格开始编辑
  const handleCellClick = (record: any) => {
    if (record && record.key !== undefined && record.key !== editingKey) {
      startEditing(record);
    }
  };

  // 保存编辑
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (editingKey) {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveEditing(editingKey);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEditing();
      }
    }
  };
  const saveEditing = async (key: string) => {
    const editedRecord = editCache[key];
    const originalRecord = data.find(item => item.key === key);
    
    if (!originalRecord) return;

    // 检查是否有变更
    const hasChanges = Object.keys(originalRecord).some(field => {
      if (field === 'key') return false;
      return originalRecord[field] !== editedRecord[field];
    });

    if (!hasChanges) {
      cancelEditing();
      return;
    }

    // 添加更新操作到操作列表
    const primaryKeyColumn = tableStructure.find(col => col.primaryKey);
    if (!primaryKeyColumn) {
      message.error('找不到主键列，无法更新数据');
      return;
    }

    const updateOperation: DataEditOperation = {
      type: 'update',
      table: tableName,
      data: editedRecord,
      where: { [primaryKeyColumn.name]: originalRecord[primaryKeyColumn.name] }
    };

    setEditOperations([...editOperations, updateOperation]);
    
    // 更新本地数据
    const newData = [...data];
    const index = newData.findIndex(item => item.key === key);
    if (index > -1) {
      newData[index] = { ...editedRecord };
      setData(newData);
    }

    cancelEditing();
  };

  // 取消编辑
  const cancelEditing = () => {
    setEditingKey(undefined);
    setEditCache({});
  };

  // 加载表数据 - 优化为分步加载：第一步加载表头，第二步并行查询数据和总数量
  const loadTableData = async (page: number, size: number) => {
    if (!connection || !connection.isConnected || !window.electronAPI) {
      setError('数据库未连接或Electron API不可用');
      setLoading(false);
      return;
    }

    // 确保始终使用有效的分页大小，默认200条
    const actualPageSize = Math.max(1, Math.min(size || 200, 200));
    const actualPage = Math.max(1, page || 1);
    
    setLoading(true);
    setError('');
    setEditingKey(undefined);
    setEditCache({});
    
    // 添加性能监控变量
    const startTime = Date.now();
    let structureLoadTime = 0;
    let queryStartTime = 0;
    let queryEndTime = 0;
    
    console.log(`超大表加载监控 - 表[${database}.${tableName}]开始加载，页面: ${actualPage}，每页条数: ${actualPageSize}`);
    
    try {
      const poolId = connection.connectionId || connection.id;
      console.log("日志测试输出部分-----3");
      // 获取表结构 - 根据数据库类型使用不同的引号处理表名
      let tableIdentifier = '';
      if (connection.type === 'postgresql' || connection.type === 'gaussdb') {
        // PostgreSQL和GaussDB使用双引号
        tableIdentifier = `"${database}"."${tableName}"`;
      } else {
        // 其他数据库使用反引号
        tableIdentifier = `\`${database}\`.\`${tableName}\``;
      }
      console.log("日志测试输出部分-----4", tableIdentifier);
      console.log(`超大表加载监控 - 表[${database}.${tableName}]即将调用getTableStructure方法，当前poolId: ${poolId}`);
      // 第一步：加载表头信息（表结构）- 添加超时控制
      let tableStructureResult;
      try {
        console.log(`超大表加载监控 - 表[${database}.${tableName}]创建表结构查询Promise`);
        // 为getTableStructure调用添加30秒超时控制
        const getTableStructurePromise = window.electronAPI.getTableStructure(poolId, tableIdentifier);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`获取表结构超时: 超过30秒未完成`)), 30000)
        );
        
        console.log(`超大表加载监控 - 表[${database}.${tableName}]开始执行表结构查询，使用Promise.race进行超时控制`);
        tableStructureResult = await Promise.race([
          getTableStructurePromise,
          timeoutPromise
        ]);
        console.log(`超大表加载监控 - 表[${database}.${tableName}]表结构查询Promise完成，开始处理结果`);
      } catch (structureError) {
        console.error(`超大表加载监控 - 表[${database}.${tableName}]表结构查询异常:`, structureError);
        throw new Error(`获取表结构失败: ${structureError instanceof Error ? structureError.message : String(structureError)}`);
      }
      structureLoadTime = Date.now() - startTime;
      console.log(`超大表加载监控 - 表[${database}.${tableName}]表结构加载完成，耗时: ${structureLoadTime}ms`);
      console.log(`超大表加载监控 - 表结构查询结果类型: ${typeof tableStructureResult}, 是否包含success字段: ${tableStructureResult ? 'success' in tableStructureResult : '否'}`);
      console.log(`超大表加载监控 - 表结构结果序列化: ${JSON.stringify(tableStructureResult).substring(0, 500)}...`);
      if (tableStructureResult && tableStructureResult.success && tableStructureResult.structure) {
        console.log("日志测试输出部分---2");
        console.log(`超大表加载监控 - 表[${database}.${tableName}]表结构验证通过，开始处理表结构数据`);
        console.log(`超大表加载监控 - 表[${database}.${tableName}]表结构包含列数: ${tableStructureResult.structure.columns ? tableStructureResult.structure.columns.length : 0}`);
        const structure = tableStructureResult.structure;
        setTableStructure(structure.columns);
        setVisibleColumns(structure.columns.map((col: TableColumn) => col.name));
        // 设置表结构的模式名
        setTableStructureSchema(structure.schema || '');
        // 列定义的生成逻辑已移至useEffect中（响应visibleColumns变化）
        
        // 构建查询语句，包含筛选和排序
        // 对于超大数据表，实现选择性列查询以提高性能
        let baseQuery = `SELECT * FROM \`${database}\`.\`${tableName}\``;
        let countQuery = `SELECT COUNT(*) as count FROM \`${database}\`.\`${tableName}\``;
        
        // 检查表是否有大量列或是否是超大表
        // const isLargeTable = structure.columns.length > 50 || (structure.rows && structure.rows > 100000);
        
        // if (isLargeTable) {
        //   console.log(`超大表加载监控 - 表[${database}.${tableName}]检测为大表，列数: ${structure.columns.length}，预估行数: ${structure.rows || '未知'}`);
          
        //   // 对于大表，只选择前20列或主键+常用列
        //    const selectedColumns = structure.columns.slice(0, 20).map((col: TableColumn) => `\`${col.name}\``).join(', ');
        //   baseQuery = `SELECT ${selectedColumns} FROM \`${database}\`.\`${tableName}\``;
        //   console.log(`超大表加载监控 - 表[${database}.${tableName}]使用选择性列查询，仅查询 ${selectedColumns.split(',').length} 列`);
        // } else {
        //   // 对于普通表，查询所有列
        //   baseQuery = `SELECT * FROM \`${database}\`.\`${tableName}\``;
        // }
        
        // 添加筛选条件
        const filterClauses: string[] = [];
        
        Object.entries(filterConditions).forEach(([column, value]) => {
          if (!value) return;
          
          // 查找对应的列信息
          const columnInfo = tableStructure.find(col => col.name === column);
          if (!columnInfo) return;
          
          const type = columnInfo.type.toLowerCase();
          
          // 处理日期时间范围（格式：start||end）
          if ((type.includes('datetime') || (type.includes('date') && type.includes('time'))) && value.includes('||')) {
            const [start, end] = value.split('||');
            if (start && end) {
              filterClauses.push(`\`${column}\` BETWEEN '${start}' AND '${end}'`);
            }
          }
          // 处理日期范围（格式：start||end）
          else if (type.includes('date') && !type.includes('time') && value.includes('||')) {
            const [start, end] = value.split('||');
            if (start && end) {
              filterClauses.push(`\`${column}\` BETWEEN '${start}' AND '${end}'`);
            }
          }
          // 处理数值类型
          else if (type.includes('int') || type.includes('float') || type.includes('double') || type.includes('decimal')) {
            const numValue = parseFloat(value);
            if (!isNaN(numValue)) {
              filterClauses.push(`\`${column}\` = ${numValue}`);
            }
          }
          // 处理布尔类型
          else if (type.includes('boolean')) {
            filterClauses.push(`\`${column}\` = ${value === 'true' ? 'TRUE' : 'FALSE'}`);
          }
          // 默认文本模糊查询
          else {
            filterClauses.push(`\`${column}\` LIKE '%${value}%'`);
          }
        });
        console.log('SQL执行 - 基础查询  1 :', baseQuery);
        if (filterClauses.length > 0) {
          const whereClause = ` WHERE ${filterClauses.join(' AND ')}`;
          baseQuery += whereClause;
          countQuery += whereClause;
        }
        console.log('SQL执行 - 基础查询  2 :', baseQuery);
        // 添加排序
        if (sortOrder) {
          baseQuery += ` ORDER BY \`${sortOrder.column}\` ${sortOrder.order === 'ascend' ? 'ASC' : 'DESC'}`;
        }
        console.log('SQL执行 - 基础查询  3 :', baseQuery);
        // 添加分页 - 强制限制首次渲染数据为200条，防止数据过多导致页面卡顿
        const offset = (actualPage - 1) * actualPageSize;
        baseQuery += ` LIMIT ${actualPageSize} OFFSET ${offset}`;
        
        console.log('SQL执行 - 基础查询:', baseQuery);
        
        // 第二步：使用Promise并行调用查询数据方法和查询总数量方法
        
        // 查询数据的函数
        const fetchData = async () => {
          queryStartTime = Date.now();
          console.log('SQL执行 - 查询数据:', baseQuery);
          console.log(`超大表加载监控 - 表[${database}.${tableName}]数据查询开始执行`);
          
          try {
            // 添加查询超时处理
            const timeoutPromise = new Promise((_, reject) => 
              setTimeout(() => reject(new Error(`查询超时: 超过30秒未完成`)), 30000)
            );
            
            console.log(`超大表加载监控 - 表[${database}.${tableName}]执行查询前检查: 数据库类型=${connection.type}, poolId=${poolId}`);
            console.log(`超大表加载监控 - 表[${database}.${tableName}]执行查询SQL长度: ${baseQuery.length}字符`);
            
            // 使用Promise.race实现查询超时控制
            const dataResult = await Promise.race([
              window.electronAPI.executeQuery(poolId, baseQuery, []),
              timeoutPromise
            ]);
            
            queryEndTime = Date.now();
            console.log(`超大表加载监控 - 表[${database}.${tableName}]数据查询执行完成，耗时: ${queryEndTime - queryStartTime}ms，返回数据条数: ${dataResult && dataResult.success && Array.isArray(dataResult.data) ? dataResult.data.length : 0}`);
            console.log(`超大表加载监控 - 表[${database}.${tableName}]数据查询结果类型: ${typeof dataResult}, 是否包含success字段: ${dataResult ? 'success' in dataResult : '否'}`);
            
            if (dataResult && dataResult.success && Array.isArray(dataResult.data)) {
              console.log(`超大表加载监控 - 表[${database}.${tableName}]数据处理开始，原始数据长度: ${dataResult.data.length}`);
              // 为每个数据项添加唯一key
              const processedData = dataResult.data.map((item: any, index: number) => ({
                ...item,
                key: index + offset
              }));
              setData(processedData);
              console.log(`超大表加载监控 - 表[${database}.${tableName}]数据处理完成，设置数据成功`);
            } else {
              setError('查询表数据失败');
              console.error('表数据查询返回非预期结果:', JSON.stringify(dataResult, null, 2));
              console.log(`超大表加载监控 - 表[${database}.${tableName}]数据查询失败: ${dataResult ? (dataResult.error || '未知错误') : '无返回结果'}`);
            }
          } catch (queryError) {
            console.error(`超大表加载监控 - 表[${database}.${tableName}]数据查询异常:`, queryError);
            setError(`数据查询失败: ${queryError instanceof Error ? queryError.message : String(queryError)}`);
          }
        };
        
        // 不查询总行数，提高超大表查询效率
        console.log(`超大表加载监控 - 表[${database}.${tableName}]开始执行数据查询，不查询总行数以提高性能`);
        
        // 只执行数据查询，不查询总数
        await fetchData();
        console.log(`超大表加载监控 - 表[${database}.${tableName}]数据查询函数执行完毕`);
      } else {
        setError('获取表结构失败');
        console.error('表结构查询返回非预期结果:', JSON.stringify(tableStructureResult, null, 2));
        console.log(`超大表加载监控 - 表[${database}.${tableName}]加载失败: 获取表结构失败`);
        console.log(`超大表加载监控 - 表[${database}.${tableName}]表结构结果详细信息: 成功=${tableStructureResult?.success}, 结构=${tableStructureResult?.structure ? '存在' : '不存在'}`);
      }
    } catch (err) {
      const errorMessage = `加载表数据失败: ${err instanceof Error ? err.message : String(err)}`;
      setError(errorMessage);
      console.error('加载表数据异常:', err);
      console.log(`超大表加载监控 - 表[${database}.${tableName}]加载异常: ${errorMessage}`);
      console.log(`超大表加载监控 - 表[${database}.${tableName}]异常详情:`, JSON.stringify(err instanceof Error ? { message: err.message, stack: err.stack } : err, null, 2));
    } finally {
      const totalLoadTime = Date.now() - startTime;
      console.log(`超大表加载监控 - 表[${database}.${tableName}]加载流程结束，总耗时: ${totalLoadTime}ms，表结构加载耗时: ${structureLoadTime}ms，数据查询耗时: ${queryEndTime - queryStartTime}ms`);
      console.log(`超大表加载监控 - 表[${database}.${tableName}]最终状态: loading=${loading}, error=${error}, 数据量=${data.length}`);
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

  // 开始事务
  const startTransaction = async () => {
    if (!connection || !connection.isConnected || !window.electronAPI) {
      message.error('数据库未连接');
      return;
    }

    try {
      const poolId = connection.connectionId || connection.id;
      const result = await window.electronAPI.executeQuery(poolId, 'START TRANSACTION', []);
      
      if (result && result.success) {
        setTransactionActive(true);
        const randomId = Math.floor(Math.random() * 1000000).toString();
        setTransactionId(randomId);
        message.success('事务已开始');
      } else {
        message.error('启动事务失败');
      }
    } catch (err) {
      message.error(`启动事务失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 提交事务
  const commitTransaction = async () => {
    if (!connection || !connection.isConnected || !window.electronAPI || !transactionActive) {
      message.error('没有活动的事务');
      return;
    }

    try {
      const poolId = connection.connectionId || connection.id;
      const result = await window.electronAPI.executeQuery(poolId, 'COMMIT', []);
      
      if (result && result.success) {
        setTransactionActive(false);
        setTransactionId('');
        message.success('事务已提交');
      } else {
        message.error('提交事务失败');
      }
    } catch (err) {
      message.error(`提交事务失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 回滚事务
  const rollbackTransaction = async () => {
    if (!connection || !connection.isConnected || !window.electronAPI || !transactionActive) {
      message.error('没有活动的事务');
      return;
    }

    try {
      const poolId = connection.connectionId || connection.id;
      const result = await window.electronAPI.executeQuery(poolId, 'ROLLBACK', []);
      
      if (result && result.success) {
        setTransactionActive(false);
        setTransactionId('');
        message.success('事务已回滚');
        // 重新加载数据以反映回滚
        loadTableData(currentPage, pageSize);
      } else {
        message.error('回滚事务失败');
      }
    } catch (err) {
      message.error(`回滚事务失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 处理排序
  const handleTableChange = (pagination: any, filters: any, sorter: any) => {
    if (sorter.field) {
      setSortOrder({
        column: sorter.field,
        order: sorter.order as 'ascend' | 'descend'
      });
    } else {
      setSortOrder(null);
    }
    loadTableData(currentPage, pageSize);
  };

  // 处理筛选
  const handleFilterChange = (columnName: string, value: string) => {
    setFilterConditions({
      ...filterConditions,
      [columnName]: value
    });
  };

  // 应用筛选
  const applyFilter = () => {
    setCurrentPage(1);
    loadTableData(1, pageSize);
  };

  // 重置筛选
  const resetFilter = () => {
    setFilterConditions({});
    setSortOrder(null);
    setCurrentPage(1);
    loadTableData(1, pageSize);
  };

  // 切换列显示
  const toggleColumn = (columnName: string, checked: boolean) => {
    if (checked) {
      setVisibleColumns([...visibleColumns, columnName]);
    } else {
      setVisibleColumns(visibleColumns.filter(name => name !== columnName));
    }
  };

  // 提交变更
  const submitChanges = async () => {
    if (editOperations.length === 0) {
      message.info('没有待提交的变更');
      return;
    }

    if (!connection || !connection.isConnected || !window.electronAPI) {
      message.error('数据库未连接');
      return;
    }

    try {
      const poolId = connection.connectionId || connection.id;
      
      // 如果没有活动的事务，开始一个新事务
      if (!transactionActive) {
        await window.electronAPI.executeQuery(poolId, 'START TRANSACTION', []);
      }

      // 执行所有编辑操作
      for (const operation of editOperations) {
        let query = '';
        let params: any[] = [];

        if (operation.type === 'insert') {
          const columns = Object.keys(operation.data).filter(key => key !== 'key');
          const placeholders = columns.map((_, index) => `?`).join(', ');
          query = `INSERT INTO \`${database}\`.\`${tableName}\` (${columns.map(col => `\`${col}\``).join(', ')}) VALUES (${placeholders})`;
          params = columns.map(col => operation.data[col]);
        } else if (operation.type === 'update') {
          const setClauses = Object.keys(operation.data as object)
            .filter((key: string) => key !== 'key' && operation.where[key] === undefined)
            .map((key: string) => `\`${key}\` = ?`);
          const whereClauses = Object.keys(operation.where).map((key: string) => `\`${key}\` = ?`);
          
          query = `UPDATE \`${database}\`.\`${tableName}\` SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`;
          params = [...setClauses.map((_: any, idx: number) => {
            const key = Object.keys(operation.data as object).filter((k: string) => k !== 'key' && operation.where[k] === undefined)[idx];
            return operation.data[key as keyof typeof operation.data];
          }), ...Object.values(operation.where)];
        } else if (operation.type === 'delete') {
          const whereClauses = Object.keys(operation.where).map(key => `\`${key}\` = ?`);
          query = `DELETE FROM \`${database}\`.\`${tableName}\` WHERE ${whereClauses.join(' AND ')}`;
          params = Object.values(operation.where);
        }

        if (query) {
          const result = await window.electronAPI.executeQuery(poolId, query, params);
          if (!result || !result.success) {
            if (!transactionActive) {
              await window.electronAPI.executeQuery(poolId, 'ROLLBACK', []);
            }
            message.error(`执行操作失败: ${result?.error || '未知错误'}`);
            return;
          }
        }
      }

      // 如果是临时启动的事务，提交它
      if (!transactionActive) {
        await window.electronAPI.executeQuery(poolId, 'COMMIT', []);
      }

      message.success('所有变更已成功提交');
      setEditOperations([]);
      loadTableData(currentPage, pageSize);
    } catch (err) {
      message.error(`提交变更失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 新增记录
  const addNewRecord = () => {
    const newRecord: any = { key: `new_${Date.now()}` };
    
    // 为主键列设置默认值或自动生成
    tableStructure.forEach(column => {
      if (column.primaryKey && column.autoIncrement) {
        // 自增列不设置值
        return;
      }
      
      // 根据类型设置默认值
      const type = column.type.toLowerCase();
      if (type.includes('int') || type.includes('float') || type.includes('double') || type.includes('decimal')) {
        newRecord[column.name] = 0;
      } else if (type.includes('boolean')) {
        newRecord[column.name] = false;
      } else {
        newRecord[column.name] = '';
      }
    });

    // 打开详情模态框以编辑新记录
    setSelectedRecord(newRecord);
    setEditingRecord({...newRecord}); // 创建可编辑的副本
    setShowDetailModal(true);
  };

  // 删除选中记录
  const deleteSelectedRecords = async () => {
    if (selectedRowKeys.length === 0) {
      message.info('请先选择要删除的记录');
      return;
    }

    Modal.confirm({
      title: '确认删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 条记录吗？`,
      okText: '确定',
      cancelText: '取消',
      onOk: async () => {
        try {
          const primaryKeyColumn = tableStructure.find(col => col.primaryKey);
          if (!primaryKeyColumn) {
            message.error('找不到主键列，无法删除数据');
            return;
          }

          // 为每个选中的记录添加删除操作
          const deleteOperations: DataEditOperation[] = selectedRowKeys.map((key: React.Key) => {
            const record = data.find(item => item.key === key);
            return {
              type: 'delete' as const,
              table: tableName,
              data: {},
              where: { [primaryKeyColumn.name]: record?.[primaryKeyColumn.name] }
            };
          }).filter(Boolean) as DataEditOperation[];

          setEditOperations([...editOperations, ...deleteOperations]);
          setSelectedRowKeys([]);
          message.success('记录已标记为删除，请提交变更以应用删除操作');
        } catch (err) {
          message.error(`删除记录失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });
  };

  // 导入数据
  const importData = () => {
    message.info('导入数据功能待实现');
  };

  // 导出数据
  const exportData = () => {
    setShowExportModal(true);
  };

  // 处理导出类型选择
  const handleExportTypeSelect = async (type: 'all' | 'current' | 'cancel') => {
    setShowExportModal(false);
    if (type === 'cancel') {
      // 重置导出格式为默认值
      setExportFormat('csv');
      return;
    }

    setExportType(type);
    setShowFormatModal(true);
  };

  // 选择导出格式（不立即执行）
  const handleFormatSelect = (format: string) => {
    setExportFormat(format);
  };

  // 确认导出格式并执行导出
  const confirmExportFormat = async () => {
    setShowFormatModal(false);
    await performExport();
  };

  // 处理导出格式模态框取消
  const handleFormatModalCancel = () => {
    setShowFormatModal(false);
    // 重置导出格式为默认值
    setExportFormat('csv');
  };

  // 执行导出操作
  const performExport = async () => {
    if (!connection || !connection.isConnected || !window.electronAPI) {
      message.error('数据库未连接或Electron API不可用');
      return;
    }

    setExportLoading(true);
    try {
      // 获取保存文件路径
      const defaultFileName = `${database}-${tableName}.${exportFormat}`;
      const savePathResult = await window.electronAPI.showSaveDialog(defaultFileName, exportFormat);
      
      if (!savePathResult || savePathResult.canceled || !savePathResult.filePath) {
        message.warning('导出已取消');
        return;
      }
      
      const savePath = savePathResult.filePath;
      const poolId = connection.connectionId || connection.id;
      
      if (exportType === 'current') {
        // 导出当前列表数据
        console.log(`导出当前${data.length}条记录到${savePath}`);
        
        // 构建带筛选条件的查询语句
        let query = `SELECT * FROM \`${database}\`.\`${tableName}\``;
        
        // 添加筛选条件
        const filterClauses: string[] = [];
        Object.entries(filterConditions).forEach(([column, value]) => {
          if (!value) return;
          
          // 查找对应的列信息
          const columnInfo = tableStructure.find(col => col.name === column);
          if (!columnInfo) return;
          
          const type = columnInfo.type.toLowerCase();
          
          // 处理日期时间范围（格式：start||end）
          if ((type.includes('datetime') || (type.includes('date') && type.includes('time'))) && value.includes('||')) {
            const [start, end] = value.split('||');
            if (start && end) {
              filterClauses.push(`\`${column}\` BETWEEN '${start}' AND '${end}'`);
            }
          }
          // 处理日期范围（格式：start||end）
          else if (type.includes('date') && !type.includes('time') && value.includes('||')) {
            const [start, end] = value.split('||');
            if (start && end) {
              filterClauses.push(`\`${column}\` BETWEEN '${start}' AND '${end}'`);
            }
          }
          // 处理数值类型
          else if (type.includes('int') || type.includes('float') || type.includes('double') || type.includes('decimal')) {
            const numValue = parseFloat(value);
            if (!isNaN(numValue)) {
              filterClauses.push(`\`${column}\` = ${numValue}`);
            }
          }
          // 处理布尔类型
          else if (type.includes('boolean')) {
            filterClauses.push(`\`${column}\` = ${value === 'true' ? 'TRUE' : 'FALSE'}`);
          }
          // 默认文本模糊查询
          else {
            filterClauses.push(`\`${column}\` LIKE '%${value}%'`);
          }
        });
        
        if (filterClauses.length > 0) {
          const whereClause = ` WHERE ${filterClauses.join(' AND ')}`;
          query += whereClause;
        }
        
        // 添加排序
        if (sortOrder) {
          query += ` ORDER BY \`${sortOrder.column}\` ${sortOrder.order === 'ascend' ? 'ASC' : 'DESC'}`;
        }
        
        // 添加分页限制（只导出当前页数据）
        const offset = (currentPage - 1) * pageSize;
        query += ` LIMIT ${pageSize} OFFSET ${offset}`;
        
        // 导出查询结果
        const exportResult = await window.electronAPI.exportQueryResult(poolId, query, exportFormat);
        
        if (exportResult && exportResult.success) {
          // 将数据写入文件
          const writeResult = await window.electronAPI.writeExportFile(savePath, exportResult.data, exportFormat, connection?.type);
          
          if (writeResult && writeResult.success) {
            message.success(`数据导出成功，已保存至：${savePath}`);
          } else {
            throw new Error(`文件写入失败: ${writeResult?.error || '未知错误'}`);
          }
        } else {
          throw new Error(`数据导出失败: ${exportResult?.error || '未知错误'}`);
        }
      } else if (exportType === 'all') {
        // 导出全部数据
        console.log(`导出表${database}.${tableName}的全部数据到${savePath}`);
        
        // 使用tableData导出方法，可以支持流式查询
        const exportResult = await window.electronAPI.exportTableData(
          poolId, 
          `\`${database}\`.\`${tableName}\``, 
          exportFormat
        );
        
        if (exportResult && exportResult.success) {
          // 将数据写入文件
          const writeResult = await window.electronAPI.writeExportFile(savePath, exportResult.data, exportFormat, connection?.type);
          
          if (writeResult && writeResult.success) {
            message.success(`全部数据导出成功，已保存至：${savePath}`);
          } else {
            throw new Error(`文件写入失败: ${writeResult?.error || '未知错误'}`);
          }
        } else {
          throw new Error(`全部数据导出失败: ${exportResult?.error || '未知错误'}`);
        }
      }
    } catch (error) {
      message.error(`导出数据失败: ${error instanceof Error ? error.message : String(error)}`);
      console.error('导出数据异常:', error);
    } finally {
      setExportLoading(false);
    }
  };// 处理页面大小变化
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

  // 当可见列变化时，更新表格列
  useEffect(() => {
    if (tableStructure.length > 0) {
      // 重新生成所有列配置，确保可以恢复之前隐藏的列
      const tableColumns = tableStructure
        .filter(col => visibleColumns.includes(col.name))
        .map((column: TableColumn) => {
          // 优化列宽计算逻辑，限制最大宽度为200px，避免单元格过宽
          const columnWidth = Math.min(200, Math.max(100, Math.min(column.name.length * 8, 200)));
          const columnConfig: any = {
            title: (
                <div style={{ textAlign: 'center', lineHeight: 1.2 }}>
                  <div style={{ fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{column.name}</div>
                  <div style={{
                    color: darkMode ? '#999' : '#666',
                    fontSize: '12px',
                    whiteSpace: 'nowrap'
                  }}>#{column.type}</div>
                  {(connection.type === 'postgresql' || connection.type === 'gaussdb') && tableStructureSchema && (
                    <div style={{
                      color: darkMode ? '#888' : '#555',
                      fontSize: '10px',
                      fontStyle: 'italic',
                      whiteSpace: 'nowrap'
                    }}>schema: {tableStructureSchema}</div>
                  )}
                </div>
              ),
            dataIndex: column.name,
            key: column.name,
            sorter: true,
            ellipsis: true,
            width: columnWidth, // 表头宽度
            onCell: (record: any) => ({
              onClick: () => handleCellClick(record),
              style: {
                cursor: 'pointer',
                width: columnWidth, // 单元格宽度，与表头保持一致
                maxWidth: columnWidth,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }
            }),
            render: (text: any, record: any) => {
              if (!record || record.key === undefined) return text;
              const editable = true;
              const isEditing = record.key === editingKey;
              if (isEditing && editable) {
                return getFieldEditor(column, record, () => saveEditing(record.key));
              }
              if (text === null) return <span style={{ color: '#999' }}>NULL</span>;
              if (text === undefined) return <span style={{ color: '#ccc' }}>UNDEFINED</span>;
              if (typeof text === 'string' && text.length > 40) {
                return <span title={text}>{text.substring(0, 40)}...</span>;
              }
              return text;
            }
          };
          return columnConfig;
        });
      
      // 直接设置表格列，不添加操作列
      setColumns(tableColumns);
    }
  }, [visibleColumns, tableStructure]);

  return (
    <div 
      className={`table-data-panel ${darkMode ? 'dark' : ''}`} 
      style={{ height: '100%', padding: '16px', display: 'flex', flexDirection: 'column' }}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      <Card 
        title={
          <Space>
            <DatabaseOutlined />
            <span>{database}.{tableName}</span>
            {transactionActive && (
              <Tag color="processing" style={{ marginLeft: 10 }}>
                事务中 #{transactionId}
              </Tag>
            )}
          </Space>
        }
        size="small"
        className="table-data-card"
        style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
      >
        {/* 上方固定工具栏 */}
        <div style={{ 
          marginBottom: 16, 
          padding: 8, 
          backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5', 
          border: '1px solid #d9d9d9',
          borderRadius: 4,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8, 
          alignItems: 'center'
        }}>
          <Space>
            <Button 
              icon={<DatabaseFilled />} 
              onClick={startTransaction} 
              disabled={transactionActive}
              title="开始事务"
            />
            {transactionActive && (
              <Space>
                <Button onClick={commitTransaction} type="primary" title="提交事务" icon={<CheckCircleOutlined />} />
                <Button onClick={rollbackTransaction} danger title="回滚事务" icon={<CloseCircleOutlined />} />
              </Space>
            )}
          </Space>
          
          <Space>
            <Button 
              icon={<FilterOutlined />} 
              onClick={() => setFilterMode(filterMode ? false : 'normal')}
              title="筛选排序"
            />
            <Button 
              icon={<ColumnHeightOutlined />} 
              onClick={() => setShowColumnSelector(!showColumnSelector)}
              title="列选择器"
            />
            <Button 
              icon={<DatabaseFilled />} 
              onClick={() => {
                if (selectedRowKeys.length === 1) {
                  const record = data.find(item => item.key === selectedRowKeys[0]);
                  if (record) {
                    setSelectedRecord(record);
                    setEditingRecord({...record}); // 创建可编辑的副本
                    setShowDetailModal(true);
                  }
                } else {
                  message.info('请选择一条记录查看详情');
                }
              }}
              disabled={selectedRowKeys.length !== 1}
              title="查看详情"
            />
          </Space>
          
          <Space>
            <Button 
              type="primary" 
              icon={<PlusOutlined />} 
              onClick={addNewRecord}
              title="新增记录"
            />
            <Button 
              danger 
              icon={<DeleteOutlined />} 
              onClick={deleteSelectedRecords}
              disabled={selectedRowKeys.length === 0}
              title={`删除记录 (${selectedRowKeys.length})`}
            />
          </Space>
          
          <Space>
            <Button icon={<UploadOutlined />} onClick={importData} title="导入数据" />
            <Button icon={<DownloadOutlined />} onClick={exportData} title="导出数据" />
          </Space>
          
          <Space>
            <Button 
              icon={<SaveOutlined />} 
              onClick={submitChanges}
              disabled={editOperations.length === 0}
              title={`提交变更 (${editOperations.length})`}
            />
            <Button 
              icon={<ReloadOutlined />} 
              onClick={handleRefresh} 
              loading={loading}
              title="刷新数据"
            />
          </Space>
        </div>

        {/* 导出类型选择弹窗 */}
        <Modal
          title="导出数据"
          open={showExportModal}
          footer={null}
          onCancel={() => setShowExportModal(false)}
        >
          <div style={{ padding: 20 }}>
            <p style={{ marginBottom: 20 }}>请选择要导出的数据范围：</p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
              <Button 
                type="default" 
                onClick={() => handleExportTypeSelect('all')}
                icon={<DatabaseOutlined />}
              >
                全部数据
              </Button>
              <Button 
                type="default" 
                onClick={() => handleExportTypeSelect('current')}
                icon={<TableOutlined />}
              >
                当前 {data.length} 条记录
              </Button>
              <Button 
                danger 
                onClick={() => handleExportTypeSelect('cancel')}
              >
                取消
              </Button>
            </div>
          </div>
        </Modal>

        {/* 导出格式选择弹窗 */}
        <Modal
          title="选择导出格式"
          open={showFormatModal}
          footer={null}
          onCancel={handleFormatModalCancel}
        >
          <div style={{ padding: 20 }}>
            <p style={{ marginBottom: 20 }}>请选择导出文件格式：</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {['csv', 'txt', 'json', 'xml', 'xlsx', 'xls', 'sql'].map(format => (
                <Button 
                  key={format} 
                  type={exportFormat === format ? 'primary' : 'default'} 
                  onClick={() => handleFormatSelect(format)}
                  block
                >
                  {format.toUpperCase()}
                </Button>
              ))}
            </div>
            <div style={{ marginTop: 20, textAlign: 'center' }}>
              <Space>
                <Button danger onClick={handleFormatModalCancel}>
                  取消
                </Button>
                <Button type="primary" onClick={confirmExportFormat}>
                  确定
                </Button>
              </Space>
            </div>
          </div>
        </Modal>

        {/* 导出加载中状态 */}
        {exportLoading && (
          <Modal
            title="正在导出数据"
            open={true}
            footer={null}
            closable={false}
          >
            <div style={{ textAlign: 'center', padding: 20 }}>
              <Spin size="large" />
              <p style={{ marginTop: 20 }}>
                {exportType === 'all' ? '正在查询并导出全部数据...' : '正在导出当前数据...'}
              </p>
            </div>
          </Modal>
        )}

        {/* 筛选面板 */}
        {filterMode && (
          <div style={{ 
            marginBottom: 16, 
            padding: 12, 
            backgroundColor: darkMode ? '#1a1a1a' : '#fff', 
            border: '1px solid #d9d9d9',
            borderRadius: 4
          }}>
            {/* 筛选面板头部 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16 }}>筛选条件</h3>
              <Button type="text" onClick={() => setFilterMode(false)}>收起</Button>
            </div>
            
            {/* 筛选条件区域 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
              {/* 所有筛选条件 */}
              {(filterMode === 'all' ? tableStructure : tableStructure.slice(0, 3)).map(column => (
                <div key={column.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ whiteSpace: 'nowrap' }}>{column.name}:</span>
                  {renderFilterControl(column)}
                </div>
              ))}
            </div>
            
            {/* 底部控制按钮 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              {tableStructure.length > 3 && (
                <Button 
                  type="link" 
                  onClick={() => setFilterMode(filterMode === 'normal' ? 'all' : 'normal')}
                >
                  {filterMode === 'normal' ? '显示全部' : '显示精简'}
                </Button>
              )}
              <Space>
                <Button onClick={resetFilter}>重置</Button>
                <Button type="primary" onClick={applyFilter}>应用</Button>
              </Space>
            </div>
          </div>
        )}

        {/* 列选择器 */}
        {showColumnSelector && (
          <div style={{ 
            marginBottom: 16, 
            padding: 12, 
            backgroundColor: darkMode ? '#1a1a1a' : '#fff', 
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16
          }}>
            <span style={{ marginRight: 8 }}>显示列:</span>
            {tableStructure.map(column => (
              <div key={column.name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Checkbox
                  checked={visibleColumns.includes(column.name)}
                  onChange={(e) => toggleColumn(column.name, e.target.checked)}
                >
                  {column.name}
                </Checkbox>
              </div>
            ))}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <Spin size="large" tip="加载数据中..." />
          </div>
        ) : error ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#f5222d' }}>
            <Empty description={error} />
          </div>
        ) : data.length > 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <Table
              columns={columns}
              dataSource={data}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content', y: 'calc(100vh - 400px)' }}
              className="table-data-table"
              style={{ border: '1px solid #d9d9d9' }}
              bordered={true}
              rowClassName={(record) => {
                if (!record || record.key === undefined) return 'table-row-with-border';
                const isSelected = selectedRowKeys.includes(record.key);
                return isSelected ? 'table-row-selected' : 'table-row-with-border';
              }}
              rowSelection={{
                selectedRowKeys,
                onChange: setSelectedRowKeys,
                getCheckboxProps: (record) => ({
                  style: {
                    backgroundColor: record && record.key !== undefined && selectedRowKeys.includes(record.key) ? '#e6f7ff' : 'transparent'
                  }
                })
              }}
              onChange={handleTableChange}
              components={{
                body: {
                  row: (props: any) => {
                    const { className, style, ...restProps } = props;
                    const isSelected = props.record && props.record.key !== undefined && selectedRowKeys.includes(props.record.key);
                    return (
                      <tr
                        className={className}
                        style={{
                          ...style,
                          backgroundColor: isSelected ? '#e6f7ff' : 'transparent',
                          transition: 'background-color 0.3s'
                        }}
                        {...restProps}
                      />
                    );
                  }
                }
              }}
            />
            
            <div style={{ marginTop: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  {editOperations.length > 0 && (
                    <Tag color="warning" style={{ marginLeft: 10 }}>
                      {editOperations.length} 项变更待提交
                    </Tag>
                  )}
                </div>
                <Pagination
                  current={currentPage}
                  pageSize={pageSize}
                  total={total}
                  onChange={handlePageChange}
                  showSizeChanger
                  pageSizeOptions={['200', '500', '1000']}
                  onShowSizeChange={handlePageSizeChange}
                />
              </div>
            </div>
          </div>
        )}
      </Card>
      
      {/* 详情模态框 - 使用新的RecordDetailModal组件 */}
      <RecordDetailModal
        visible={showDetailModal}
        record={selectedRecord}
        tableStructure={tableStructure}
        editOperations={editOperations}
        onClose={() => setShowDetailModal(false)}
        onSave={(newOperations) => setEditOperations(newOperations)}
        tableName={tableName}
      />
    </div>
  );
};

export default TableDataPanel;