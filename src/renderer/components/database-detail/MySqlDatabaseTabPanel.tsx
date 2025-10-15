import React, { useState, useEffect } from 'react';
import { Button, Card, Input, Row, Col, Statistic, Space, Spin, Tag, Table, Tabs, Modal, message, Dropdown, Menu } from 'antd';
import { DatabaseOutlined, TableOutlined, EyeOutlined, PlayCircleOutlined, FunctionOutlined, BarChartOutlined } from '@ant-design/icons';
import type { DatabaseType, DatabaseConnection } from '../../types';

interface Props {
  connection: DatabaseConnection;
  database: string;
  type: DatabaseType;
  darkMode?: boolean;
  onTableSelect?: (tableName: string) => void;
  onTableDesign?: (connection: DatabaseConnection, database: string, tableName: string) => void;
}

const MySqlDatabaseTabPanel: React.FC<Props> = ({ connection, database, type, darkMode = false, onTableSelect, onTableDesign }) => {
  // 状态管理
  const [loading, setLoading] = useState(false);
  const [tableList, setTableList] = useState<any[]>([]);
  const [viewList, setViewList] = useState<any[]>([]);
  const [procedureList, setProcedureList] = useState<any[]>([]);
  const [functionList, setFunctionList] = useState<any[]>([]);
  const [recentQueries, setRecentQueries] = useState<any[]>([]);
  const [mysqlVersion, setMysqlVersion] = useState('未知');
  const [databaseStats, setDatabaseStats] = useState({
    tableCount: 0,
    totalSize: '0 MB',
    rowCount: 0,
    indexCount: 0,
    viewCount: 0,
    procedureCount: 0,
    functionCount: 0
  });
  
  // 搜索关键词状态
  const [tableSearchTerm, setTableSearchTerm] = useState('');
  const [viewSearchTerm, setViewSearchTerm] = useState('');
  const [procedureSearchTerm, setProcedureSearchTerm] = useState('');
  const [functionSearchTerm, setFunctionSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState('tables');

  // 搜索过滤函数
  const filterListBySearch = (list: any[], searchTerm: string) => {
    if (!searchTerm.trim()) {
      return list;
    }
    const term = searchTerm.toLowerCase();
    return list.filter(item => 
      item.name?.toLowerCase().includes(term) || 
      item.comment?.toLowerCase().includes(term)
    );
  };

  // 格式化大小
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // 加载数据库统计信息
  const loadDatabaseStats = async () => {
    try {
      if (!connection || !connection.isConnected || !window.electronAPI) {
        console.warn('数据库未连接或Electron API不可用，无法加载数据库统计信息');
        return;
      }

      const poolId = connection.connectionId || connection.id;
      
      // 获取表数量和总大小
      const countQuery = `SELECT COUNT(*) as table_count, 
        SUM(data_length + index_length) as total_size, 
        SUM(table_rows) as row_count 
        FROM information_schema.TABLES 
        WHERE table_schema = ? AND table_type = 'BASE TABLE'`;
      
      // 获取视图数量
      const viewCountQuery = `SELECT COUNT(*) as view_count FROM information_schema.VIEWS WHERE TABLE_SCHEMA = ?`;
      
      // 获取存储过程数量
      const procedureCountQuery = `SELECT COUNT(*) as procedure_count FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'`;
      
      // 获取函数数量
      const functionCountQuery = `SELECT COUNT(*) as function_count FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION'`;
      
      // 获取MySQL版本
      const versionQuery = `SELECT VERSION() as version`;

      const [countResult, viewResult, procedureResult, functionResult, versionResult] = await Promise.all([
        window.electronAPI.executeQuery(poolId, countQuery, [database]),
        window.electronAPI.executeQuery(poolId, viewCountQuery, [database]),
        window.electronAPI.executeQuery(poolId, procedureCountQuery, [database]),
        window.electronAPI.executeQuery(poolId, functionCountQuery, [database]),
        window.electronAPI.executeQuery(poolId, versionQuery, [])
      ]);

      // 计算总大小并格式化
      const bytes = countResult?.success && countResult.data?.length > 0 ? countResult.data[0].total_size || 0 : 0;
      const totalSize = formatSize(bytes);

      // 更新MySQL版本信息
      if (versionResult?.success && versionResult.data?.length > 0) {
        setMysqlVersion(versionResult.data[0].version || '未知');
      }

      setDatabaseStats({
        tableCount: countResult?.success && countResult.data?.length > 0 ? countResult.data[0].table_count || 0 : 0,
        totalSize: totalSize,
        rowCount: countResult?.success && countResult.data?.length > 0 ? countResult.data[0].row_count || 0 : 0,
        indexCount: 0, // 索引数量需要额外查询，这里简化处理
        viewCount: viewResult?.success && viewResult.data?.length > 0 ? viewResult.data[0].view_count || 0 : 0,
        procedureCount: procedureResult?.success && procedureResult.data?.length > 0 ? procedureResult.data[0].procedure_count || 0 : 0,
        functionCount: functionResult?.success && functionResult.data?.length > 0 ? functionResult.data[0].function_count || 0 : 0
      });
    } catch (error) {
      console.error('加载数据库统计信息失败:', error);
      setDatabaseStats({ 
        tableCount: 0, 
        totalSize: '0 MB', 
        rowCount: 0, 
        indexCount: 0,
        viewCount: 0,
        procedureCount: 0,
        functionCount: 0
      });
    }
  };

  // 加载表列表
  const loadTableList = async () => {
    try {
      if (!connection || !connection.isConnected || !window.electronAPI) {
        console.warn('数据库未连接或Electron API不可用，无法加载表列表');
        // 连接断开时清空列表
        setTableList([]);
        return;
      }

      const poolId = connection.connectionId || connection.id;
      
      // MySQL查询 - 获取完整的表信息
      const tableQuery = `SELECT table_name, table_rows, data_length, index_length, create_time, table_comment, engine 
        FROM information_schema.TABLES 
        WHERE table_schema = ? AND table_type = 'BASE TABLE'`;
      const queryParams = [database];
      
      console.log('执行MySQL表列表查询:', tableQuery, '数据库:', database);
      const result = await window.electronAPI.executeQuery(poolId, tableQuery, queryParams);
      
      // 添加详细的结果调试信息
      console.log('表列表查询原始结果:', JSON.stringify(result, null, 2));
      
      if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
        // 处理真实数据，将create_time正确映射到created字段
        const processedTables = result.data.map((table: any, index: number) => {
          // 为每行数据添加详细的字段映射日志
          console.log(`处理表[${index}]:`, {
            table_name: table.table_name || table.TABLE_NAME,
            table_rows: table.table_rows || table.TABLE_ROWS,
            data_length: table.data_length || table.DATA_LENGTH,
            index_length: table.index_length || table.INDEX_LENGTH,
            create_time: table.create_time || table.CREATE_TIME,
            table_comment: table.table_comment || table.TABLE_COMMENT,
            engine: table.engine || table.ENGINE
          });
          
          // 修复未知表问题 - 确保正确获取表名，检查多种可能的字段名格式
          const tableName = table.table_name || table.TABLE_NAME || `表_${index + 1}`;
          
          // 修复行数和大小显示问题 - 确保正确获取行数和大小信息，检查多种可能的字段名格式
          const rows = table.table_rows || table.TABLE_ROWS || 0;
          const dataSize = table.data_length || table.DATA_LENGTH || 0;
          const indexSize = table.index_length || table.INDEX_LENGTH || 0;
          
          return {
            name: tableName,
            rows: rows,
            size: formatSize(dataSize + indexSize),
            created: table.create_time || table.CREATE_TIME || 'N/A', // 确保字段映射正确
            comment: table.table_comment || table.TABLE_COMMENT || '',
            engine: table.engine || table.ENGINE || ''
          };
        });
        
        console.log('处理后的表列表数据:', JSON.stringify(processedTables, null, 2));
        console.log('成功加载表列表，共', processedTables.length, '个表');
        setTableList(processedTables);
      } else if (result && result.success && Array.isArray(result.data) && result.data.length === 0) {
        // 查询成功但没有数据
        console.log('当前数据库没有表');
        setTableList([]);
      } else {
        console.error('表列表查询返回非预期结果:', JSON.stringify(result, null, 2));
        setTableList([]);
      }
    } catch (error) {
      console.error('加载表列表失败:', error);
      // 出错时清空列表
      setTableList([]);
    }
  };

  // 加载最近查询（简化处理，真实应用中可能需要从本地存储或服务器获取）
  const loadRecentQueries = async () => {
    // 在真实应用中，这里应该从本地存储或服务器获取最近执行的查询
    // 这里简化处理，暂时返回空数组
    setRecentQueries([]);
  };

  // 表选择函数
  const handleTableSelect = (tableName: string) => {
    const table = tableList.find(t => t.name === tableName);
    if (onTableSelect) {
      onTableSelect(tableName);
    }
  };

  // 加载视图列表
  const loadViewList = async () => {
    try {
      if (!connection || !connection.isConnected || !window.electronAPI) {
        console.warn('数据库未连接或Electron API不可用，无法加载视图列表');
        // 连接断开时清空列表
        setViewList([]);
        return;
      }

      const poolId = connection.connectionId || connection.id;
      
      // MySQL查询
      const viewQuery = `SELECT table_name, CREATE_TIME, view_definition, table_comment 
        FROM information_schema.views 
        WHERE TABLE_SCHEMA = ?`;
      const queryParams = [database];
      
      console.log('执行MySQL视图列表查询:', viewQuery, '数据库:', database);
      const result = await window.electronAPI.executeQuery(poolId, viewQuery, queryParams);
      
      // 添加详细的结果调试信息
      console.log('视图列表查询原始结果:', JSON.stringify(result, null, 2));
      
      if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
        // 处理真实数据，确保字段映射正确
        const processedViews = result.data.map((view: any, index: number) => {
          // 为每行数据添加详细的字段映射日志
          console.log(`处理视图[${index}]:`, {
            table_name: view.table_name,
            CREATE_TIME: view.CREATE_TIME,
            view_definition: view.view_definition,
            table_comment: view.table_comment
          });
          
          // 修复未知视图问题 - 确保正确获取视图名，检查多种可能的字段名格式
          const viewName = view.table_name || view.TABLE_NAME || `视图_${index + 1}`;
          
          return {
            name: viewName,
            definition: view.view_definition || view.VIEW_DEFINITION || '',
            created: view.CREATE_TIME || view.create_time || 'N/A',
            comment: view.table_comment || view.TABLE_COMMENT || ''
          };
        });
        
        console.log('处理后的视图列表数据:', JSON.stringify(processedViews, null, 2));
        console.log('成功加载视图列表，共', processedViews.length, '个视图');
        setViewList(processedViews);
      } else {
        console.log('当前数据库没有视图或查询失败:', result);
        setViewList([]);
      }
    } catch (error) {
      console.error('加载视图列表失败:', error);
      // 出错时清空列表
      setViewList([]);
    }
  };

  // 加载存储过程列表
  const loadProcedureList = async () => {
    try {
      if (!connection || !connection.isConnected || !window.electronAPI) {
        console.warn('数据库未连接或Electron API不可用，无法加载存储过程列表');
        // 连接断开时清空列表
        setProcedureList([]);
        return;
      }

      const poolId = connection.connectionId || connection.id;
      
      // MySQL查询
      const procedureQuery = `SELECT routine_name, routine_definition, created 
        FROM information_schema.routines 
        WHERE routine_schema = ? AND routine_type = 'PROCEDURE'`;
      const queryParams = [database];
      
      console.log('执行MySQL存储过程列表查询:', procedureQuery, '数据库:', database);
      const result = await window.electronAPI.executeQuery(poolId, procedureQuery, queryParams);
      
      // 添加详细的结果调试信息
      console.log('存储过程列表查询原始结果:', JSON.stringify(result, null, 2));
      
      if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
        // 处理真实数据，确保字段映射正确
        const processedProcedures = result.data.map((procedure: any, index: number) => {
          // 为每行数据添加详细的字段映射日志
          console.log(`处理存储过程[${index}]:`, {
            routine_name: procedure.routine_name,
            routine_definition: procedure.routine_definition,
            created: procedure.created
          });
          
          // 修复未知存储过程问题 - 确保正确获取存储过程名，检查多种可能的字段名格式
          const procedureName = procedure.routine_name || procedure.ROUTINE_NAME || `存储过程_${index + 1}`;
          
          return {
            name: procedureName,
            definition: procedure.routine_definition || procedure.ROUTINE_DEFINITION || '',
            created: procedure.created || procedure.CREATED || 'N/A'
          };
        });
        
        console.log('处理后的存储过程列表数据:', JSON.stringify(processedProcedures, null, 2));
        console.log('成功加载存储过程列表，共', processedProcedures.length, '个存储过程');
        setProcedureList(processedProcedures);
      } else if (result && result.success && Array.isArray(result.data) && result.data.length === 0) {
        // 查询成功但没有数据
        console.log('当前数据库没有存储过程');
        setProcedureList([]);
      } else {
        console.error('存储过程列表查询返回非预期结果:', JSON.stringify(result, null, 2));
        setProcedureList([]);
      }
    } catch (error) {
      console.error('加载存储过程列表失败:', error);
      // 出错时清空列表
      setProcedureList([]);
    }
  };

  // 加载函数列表
  const loadFunctionList = async () => {
    try {
      if (!connection || !connection.isConnected || !window.electronAPI) {
        console.warn('数据库未连接或Electron API不可用，无法加载函数列表');
        // 连接断开时清空列表
        setFunctionList([]);
        return;
      }

      const poolId = connection.connectionId || connection.id;
      
      // MySQL查询
      const functionQuery = `SELECT routine_name, routine_definition, created 
        FROM information_schema.routines 
        WHERE routine_schema = ? AND routine_type = 'FUNCTION'`;
      const queryParams = [database];
      
      console.log('执行MySQL函数列表查询:', functionQuery, '数据库:', database);
      const result = await window.electronAPI.executeQuery(poolId, functionQuery, queryParams);
      
      // 添加详细的结果调试信息
      console.log('函数列表查询原始结果:', JSON.stringify(result, null, 2));
      
      if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
        // 处理真实数据，确保字段映射正确
        const processedFunctions = result.data.map((func: any, index: number) => {
          // 为每行数据添加详细的字段映射日志
          console.log(`处理函数[${index}]:`, {
            routine_name: func.routine_name,
            routine_definition: func.routine_definition,
            created: func.created
          });
          
          // 修复未知函数问题 - 确保正确获取函数名，检查多种可能的字段名格式
          const functionName = func.routine_name || func.ROUTINE_NAME || `函数_${index + 1}`;
          
          return {
            name: functionName,
            definition: func.routine_definition || func.ROUTINE_DEFINITION || '',
            created: func.created || func.CREATED || 'N/A'
          };
        });
        
        console.log('处理后的函数列表数据:', JSON.stringify(processedFunctions, null, 2));
        console.log('成功加载函数列表，共', processedFunctions.length, '个函数');
        setFunctionList(processedFunctions);
      } else if (result && result.success && Array.isArray(result.data) && result.data.length === 0) {
        // 查询成功但没有数据
        console.log('当前数据库没有函数');
        setFunctionList([]);
      } else {
        console.error('函数列表查询返回非预期结果:', JSON.stringify(result, null, 2));
        setFunctionList([]);
      }
    } catch (error) {
      console.error('加载函数列表失败:', error);
      // 出错时清空列表
      setFunctionList([]);
    }
  };

  // 加载所有数据
  const loadAllData = async () => {
    setLoading(true);
    try {
      const promises = [
        loadDatabaseStats(),
        loadTableList(),
        loadRecentQueries(),
        loadViewList(),
        loadProcedureList(),
        loadFunctionList()
      ];

      await Promise.all(promises);
      
      // 日志输出所有加载结果的数量
      console.log('数据加载完成 - 表:', tableList.length, ' 视图:', viewList.length, 
                 ' 存储过程:', procedureList.length, ' 函数:', functionList.length);
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 刷新函数
  const refreshTables = () => loadTableList();
  const refreshViews = () => loadViewList();
  const refreshProcedures = () => loadProcedureList();
  const refreshFunctions = () => loadFunctionList();

  // 数据库类型对应的颜色
  const getDatabaseColor = (dbType: DatabaseType) => {
    const colors = {
      mysql: '#00758f',
      postgresql: '#336791',
      oracle: '#c74634',
      sqlite: '#003b57',
      redis: '#a41e11',
      gaussdb: '#1890ff'
    };
    return colors[dbType] || '#666';
  };

  // 右键菜单处理函数
  const handleTableContextMenu = (tableName: string) => {
    const menu = (
      <Menu>
        <Menu.Item onClick={() => handleTableSelect(tableName)}>
          查看数据
        </Menu.Item>
        <Menu.Item onClick={() => handleAlterTable(tableName)}>
          设计表
        </Menu.Item>
        <Menu.Item onClick={() => handleTruncateTable(tableName)}>
          清空表
        </Menu.Item>
        <Menu.Item onClick={() => handleDropTable(tableName)} danger>
          删除表
        </Menu.Item>
      </Menu>
    );
    return menu;
  };

  const handleViewContextMenu = (viewName: string) => {
    const menu = (
      <Menu>
        <Menu.Item onClick={() => handleViewSelect(viewName)}>
          查看数据
        </Menu.Item>
        <Menu.Item onClick={() => handleAlterTable(viewName)}>
          设计表
        </Menu.Item>
        <Menu.Item onClick={() => handleDropView(viewName)} danger>
          删除视图
        </Menu.Item>
      </Menu>
    );
    return menu;
  };

  const handleProcedureContextMenu = (procedureName: string) => {
    const menu = (
      <Menu>
        <Menu.Item onClick={() => handleExecuteProcedure(procedureName)}>
          执行
        </Menu.Item>
        <Menu.Item onClick={() => handleAlterProcedure(procedureName)}>
          修改
        </Menu.Item>
        <Menu.Item onClick={() => handleDropProcedure(procedureName)} danger>
          删除存储过程
        </Menu.Item>
      </Menu>
    );
    return menu;
  };

  const handleFunctionContextMenu = (functionName: string) => {
    const menu = (
      <Menu>
        <Menu.Item onClick={() => handleExecuteFunction(functionName)}>
          执行
        </Menu.Item>
        <Menu.Item onClick={() => handleAlterFunction(functionName)}>
          修改
        </Menu.Item>
        <Menu.Item onClick={() => handleDropFunction(functionName)} danger>
          删除函数
        </Menu.Item>
      </Menu>
    );
    return menu;
  };

  // 处理函数
  const handleViewSelect = (viewName: string) => {
    if (onTableSelect) {
      onTableSelect(viewName);
    }
  };

  const handleExecuteProcedure = (procedureName: string) => {
    console.log('Execute procedure:', procedureName);
  };

  const handleExecuteFunction = (functionName: string) => {
    console.log('Execute function:', functionName);
  };

  const handleAlterTable = (tableName: string) => {
    if (!connection || !connection.isConnected) {
      message.error('数据库未连接');
      return;
    }
    
    // 使用onTableDesign回调创建新的表设计标签页
    if (onTableDesign) {
      onTableDesign(connection, database, tableName);
    }
  };

  const handleAlterView = (viewName: string) => {
    console.log('Alter view:', viewName);
  };

  const handleAlterProcedure = (procedureName: string) => {
    console.log('Alter procedure:', procedureName);
  };

  const handleAlterFunction = (functionName: string) => {
    console.log('Alter function:', functionName);
  };

  // 清空表函数
  const handleTruncateTable = (tableName: string) => {
    Modal.confirm({
      title: '确认清空表',
      content: `确定要清空表 "${tableName}" 中的所有数据吗？此操作不可撤销！`,
      okText: '确认',
      cancelText: '取消',
      onOk: () => {
        console.log('Truncate table:', tableName);
      }
    });
  };

  const handleDropTable = (tableName: string) => {
    Modal.confirm({
      title: '确认删除表',
      content: `确定要删除表 "${tableName}" 吗？此操作不可撤销！`,
      okText: '确认',
      cancelText: '取消',
      onOk: () => {
        console.log('Drop table:', tableName);
      }
    });
  };

  const handleDropView = (viewName: string) => {
    Modal.confirm({
      title: '确认删除视图',
      content: `确定要删除视图 "${viewName}" 吗？此操作不可撤销！`,
      okText: '确认',
      cancelText: '取消',
      onOk: () => {
        console.log('Drop view:', viewName);
      }
    });
  };

  const handleDropProcedure = (procedureName: string) => {
    Modal.confirm({
      title: '确认删除存储过程',
      content: `确定要删除存储过程 "${procedureName}" 吗？此操作不可撤销！`,
      okText: '确认',
      cancelText: '取消',
      onOk: () => {
        console.log('Drop procedure:', procedureName);
      }
    });
  };

  const handleDropFunction = (functionName: string) => {
    Modal.confirm({
      title: '确认删除函数',
      content: `确定要删除函数 "${functionName}" 吗？此操作不可撤销！`,
      okText: '确认',
      cancelText: '取消',
      onOk: () => {
        console.log('Drop function:', functionName);
      }
    });
  };

  // 表列定义
  const tableColumns = [
    {
      title: '表名',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: any) => {
        console.log('渲染表名:', text, '完整记录:', record);
        return (
          <Dropdown overlay={handleTableContextMenu(text)}>
            <Button 
              type="link" 
              onClick={() => handleTableSelect(text)}
              icon={<TableOutlined />}
            >
              {text}
            </Button>
          </Dropdown>
        );
      }
    },
    {
      title: '注释',
      dataIndex: 'comment',
      key: 'comment',
      width: 150
    },
    {
      title: '引擎',
      dataIndex: 'engine',
      key: 'engine',
      width: 120
    },
    {
      title: '行数',
      dataIndex: 'rows',
      key: 'rows',
      render: (rows: number) => rows.toLocaleString()
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size'
    },
    {
      title: '创建时间',
      dataIndex: 'created',
      key: 'created',
      render: (created: any) => {
        console.log('渲染创建时间:', created);
        return created;
      }
    }
  ];

  // 查询历史列定义
  const queryColumns = [
    {
      title: '查询语句',
      dataIndex: 'query',
      key: 'query',
      render: (text: string) => (
        <code style={{ fontSize: '12px', background: '#f5f5f5', padding: '2px 4px', borderRadius: '3px' }}>
          {text.length > 80 ? text.substring(0, 80) + '...' : text}
        </code>
      )
    },
    {
      title: '耗时',
      dataIndex: 'time',
      key: 'time',
      width: 80
    },
    {
      title: '行数',
      dataIndex: 'rows',
      key: 'rows',
      width: 100,
      render: (rows: number) => rows.toLocaleString()
    }
  ];

  // 视图列定义
  const viewColumns = [
    {
      title: '视图名',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: any) => {
        console.log('渲染视图名:', text, '完整记录:', record);
        return (
          <Dropdown overlay={handleViewContextMenu(text)}>
            <Button 
              type="link" 
              icon={<EyeOutlined />}
            >
              {text}
            </Button>
          </Dropdown>
        );
      }
    },
    {
      title: '注释',
      dataIndex: 'comment',
      key: 'comment',
      width: 150
    },
    {
      title: '定义',
      dataIndex: 'definition',
      key: 'definition',
      render: (text: string) => {
        console.log('渲染视图定义:', text);
        return (
          <code style={{ fontSize: '12px', background: '#f5f5f5', padding: '2px 4px', borderRadius: '3px' }}>
            {text.length > 100 ? text.substring(0, 100) + '...' : text}
          </code>
        );
      }
    },
    {
      title: '创建时间',
      dataIndex: 'created',
      key: 'created',
      render: (created: any) => {
        console.log('渲染视图创建时间:', created);
        return created;
      }
    }
  ];

  // 存储过程列定义
  const procedureColumns = [
    {
      title: '存储过程名',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => (
        <Dropdown overlay={handleProcedureContextMenu(text)}>
          <Button 
            type="link" 
            icon={<PlayCircleOutlined />}
          >
            {text}
          </Button>
        </Dropdown>
      )
    },
    {
      title: '注释',
      dataIndex: 'comment',
      key: 'comment',
      width: 150
    },
    {
      title: '创建时间',
      dataIndex: 'created',
      key: 'created'
    }
  ];

  // 函数列定义
  const functionColumns = [
    {
      title: '函数名',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => (
        <Dropdown overlay={handleFunctionContextMenu(text)}>
          <Button 
            type="link" 
            icon={<FunctionOutlined />}
          >
            {text}
          </Button>
        </Dropdown>
      )
    },
    {
      title: '注释',
      dataIndex: 'comment',
      key: 'comment',
      width: 150
    },
    {
      title: '创建时间',
      dataIndex: 'created',
      key: 'created'
    }
  ];

  useEffect(() => {
    // 当连接或数据库变化时，重新加载数据
    if (connection && connection.isConnected) {
      loadAllData();
    } else {
      // 连接断开时，清空数据
      setDatabaseStats({ 
        tableCount: 0, 
        totalSize: '0 MB', 
        rowCount: 0, 
        indexCount: 0,
        viewCount: 0,
        procedureCount: 0,
        functionCount: 0
      });
      setTableList([]);
      setRecentQueries([]);
    }
  }, [connection, database]);

  return (
    <div className="mysql-database-tab-panel">
      {/* 数据库头部信息 */}
      <Card 
        className="database-header-card"
        bodyStyle={{ padding: '16px 24px' }}
      >
        <Row gutter={16} align="middle">
          <Col flex="none">
            <div 
              className="database-icon"
              style={{
                backgroundColor: getDatabaseColor(type),
                width: 48,
                height: 48,
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontSize: 20
              }}
            >
              <DatabaseOutlined />
            </div>
          </Col>
          <Col flex="auto">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
                  {database}
                </h2>
                <Space size={8} style={{ marginTop: 4 }}>
                  <Tag color={getDatabaseColor(type)}>{type.toUpperCase()}</Tag>
                  <span style={{ color: '#666', fontSize: 12 }}>
                    连接: {connection?.name || '-'} - 状态: {connection?.isConnected ? '已连接' : '未连接'}
                  </span>
                  {mysqlVersion !== '未知' && (
                    <span style={{ color: '#666', fontSize: 12 }}>
                      版本: {mysqlVersion}
                    </span>
                  )}
                </Space>
              </div>
              <Space>
                <Spin spinning={loading && activeTab === 'tables'}>
                  <Statistic title="表数量" value={databaseStats.tableCount} />
                </Spin>
                <Spin spinning={loading}>
                  <Statistic title="视图数量" value={databaseStats.viewCount} />
                </Spin>
                <Spin spinning={loading}>
                  <Statistic title="存储过程" value={databaseStats.procedureCount} />
                </Spin>
                <Spin spinning={loading}>
                  <Statistic title="函数数量" value={databaseStats.functionCount} />
                </Spin>
                <Spin spinning={loading && activeTab === 'tables'}>
                  <Statistic title="总大小" value={databaseStats.totalSize} />
                </Spin>
                <Spin spinning={loading && activeTab === 'tables'}>
                  <Statistic title="总行数" value={databaseStats.rowCount} formatter={value => 
                    Number(value).toLocaleString()
                  } />
                </Spin>
              </Space>
            </div>
          </Col>
        </Row>
      </Card>

      {/* 标签页内容 */}
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        className="database-tabs"
        items={[
          {
            key: 'tables',
            label: (
              <span>
                <TableOutlined />
                表
              </span>
            ),
            children: (
            <div className="database-tab-content">
              <Card title="表" size="small" className="table-list-card">
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Input
                    placeholder="搜索表名或注释"
                    allowClear
                    style={{ width: 200 }}
                    value={tableSearchTerm}
                    onChange={(e) => setTableSearchTerm(e.target.value)}
                  />
                  <Button 
                    type="primary" 
                    icon={<DatabaseOutlined />} 
                    onClick={refreshTables}
                  >
                    刷新
                  </Button>
                </div>
                <Table
                  dataSource={filterListBySearch(tableList, tableSearchTerm)}
                  columns={tableColumns}
                  pagination={false}
                  size="small"
                  scroll={{ x: 'max-content', y: 'calc(100vh - 530px)' }}
                  rowKey="name"
                  className="table-list-table"
                  locale={{ emptyText: '暂无表数据' }}
                  bordered
                  style={{ border: '1px solid #f0f0f0', borderRadius: '2px' }}
                  onRow={(record) => {
                    // 添加行级别的调试信息
                    console.log('渲染表行:', record);
                    return {};
                  }}
                  onHeaderRow={(columns) => {
                    console.log('Table header columns rendered:', columns);
                    return {};
                  }}
                />
              </Card>
            </div>
          )
          },
          {
            key: 'views',
            label: (
              <span>
                <EyeOutlined />
                视图
              </span>
            ),
            children: (
              <div className="database-tab-content">
                <Card title="视图" size="small">
                  <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Input
                      placeholder="搜索视图名或注释"
                      allowClear
                      style={{ width: 200 }}
                      value={viewSearchTerm}
                      onChange={(e) => setViewSearchTerm(e.target.value)}
                    />
                    <Button 
                      type="primary" 
                      icon={<EyeOutlined />} 
                      onClick={refreshViews}
                    >
                      刷新
                    </Button>
                  </div>
                  <div style={{ height: '400px', overflow: 'hidden' }}>
                    <Table
                      dataSource={filterListBySearch(viewList, viewSearchTerm)}
                      columns={viewColumns}
                      pagination={false}
                      size="small"
                      rowKey="name"
                      locale={{ emptyText: '暂无视图数据' }}
                      bordered
                      style={{ border: '1px solid #f0f0f0', borderRadius: '2px' }}
                      scroll={{ y: 'calc(100% - 2px)' }}
                    />
                  </div>
                </Card>
              </div>
            )
          },
          {
            key: 'procedures',
            label: (
              <span>
                <PlayCircleOutlined />
                存储过程
              </span>
            ),
            children: (
              <div className="database-tab-content">
                <Card title="存储过程" size="small">
                  <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Input
                      placeholder="搜索存储过程名或注释"
                      allowClear
                      style={{ width: 200 }}
                      value={procedureSearchTerm}
                      onChange={(e) => setProcedureSearchTerm(e.target.value)}
                    />
                    <Button 
                      type="primary" 
                      icon={<PlayCircleOutlined />} 
                      onClick={refreshProcedures}
                    >
                      刷新
                    </Button>
                  </div>
                  <div style={{ height: '400px', overflow: 'hidden' }}>
                    <Table
                      dataSource={filterListBySearch(procedureList, procedureSearchTerm)}
                      columns={procedureColumns}
                      pagination={false}
                      size="small"
                      rowKey="name"
                      locale={{ emptyText: '暂无存储过程数据' }}
                      bordered
                      style={{ border: '1px solid #f0f0f0', borderRadius: '2px' }}
                      scroll={{ y: 'calc(100% - 2px)' }}
                    />
                  </div>
                </Card>
              </div>
            )
          },
          {
            key: 'functions',
            label: (
              <span>
                <FunctionOutlined />
                函数
              </span>
            ),
            children: (
              <div className="database-tab-content">
                <Card title="函数" size="small">
                  <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Input
                      placeholder="搜索函数名或注释"
                      allowClear
                      style={{ width: 200 }}
                      value={functionSearchTerm}
                      onChange={(e) => setFunctionSearchTerm(e.target.value)}
                    />
                    <Button 
                      type="primary" 
                      icon={<FunctionOutlined />} 
                      onClick={refreshFunctions}
                    >
                      刷新
                    </Button>
                  </div>
                  <div style={{ height: '400px', overflow: 'hidden' }}>
                    <Table
                      dataSource={filterListBySearch(functionList, functionSearchTerm)}
                      columns={functionColumns}
                      pagination={false}
                      size="small"
                      rowKey="name"
                      locale={{ emptyText: '暂无函数数据' }}
                      bordered
                      style={{ border: '1px solid #f0f0f0', borderRadius: '2px' }}
                      scroll={{ y: 'calc(100% - 2px)' }}
                    />
                  </div>
                </Card>
              </div>
            )
          },
          {
            key: 'recent-queries',
            label: (
              <span>
                <BarChartOutlined />
                最近查询
              </span>
            ),
            children: (
              <div className="database-tab-content">
                <Card title="最近查询" size="small">
                  <div style={{ height: '400px', overflow: 'hidden' }}>
                    <Table
                      dataSource={recentQueries}
                      columns={queryColumns}
                      pagination={false}
                      size="small"
                      rowKey="query"
                      scroll={{ y: 'calc(100% - 2px)' }}
                    />
                  </div>
                </Card>
              </div>
            )
          }
        ]}
      />
    </div>
  );
};

export default MySqlDatabaseTabPanel;