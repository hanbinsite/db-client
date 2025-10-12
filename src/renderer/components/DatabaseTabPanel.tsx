import React, { useState, useEffect } from 'react';
import { Tabs, Card, Row, Col, Statistic, Table, Space, Button, Tag, Spin, Input, Dropdown, Menu, Modal, message } from 'antd';
import { DatabaseOutlined, TableOutlined, BarChartOutlined, CodeOutlined, EyeOutlined, PlayCircleOutlined, FunctionOutlined } from '@ant-design/icons';
import { DatabaseConnection, DatabaseType } from '../types';
import QueryPanel from './QueryPanel';
import TableStructurePanel from './TableStructurePanel';
import './DatabaseTabPanel.css';

const { TabPane } = Tabs;
interface DatabaseTabPanelProps {
  connection: DatabaseConnection;
  database: string;
  type: DatabaseType;
  darkMode: boolean;
  onTableSelect: (tableName: string) => void;
  onTableDesign: (connection: DatabaseConnection, database: string, tableName: string) => void;
}

const DatabaseTabPanel: React.FC<DatabaseTabPanelProps> = ({
  connection,
  database,
  type,
  darkMode,
  onTableSelect,
  onTableDesign
}) => {
  const [activeTab, setActiveTab] = useState('tables');
  const [loading, setLoading] = useState(false);
  const [databaseStats, setDatabaseStats] = useState({
    tableCount: 0,
    totalSize: '0 MB',
    rowCount: 0,
    indexCount: 0,
    viewCount: 0,
    procedureCount: 0,
    functionCount: 0
  });
  const [mysqlVersion, setMysqlVersion] = useState<string>('未知');
  const [tableList, setTableList] = useState<any[]>([]);
  const [recentQueries, setRecentQueries] = useState<any[]>([]);
  const [viewList, setViewList] = useState<any[]>([]);
  const [procedureList, setProcedureList] = useState<any[]>([]);
  const [functionList, setFunctionList] = useState<any[]>([]);
  
  // 搜索状态
  const [tableSearchTerm, setTableSearchTerm] = useState('');
  const [viewSearchTerm, setViewSearchTerm] = useState('');
  const [procedureSearchTerm, setProcedureSearchTerm] = useState('');
  const [functionSearchTerm, setFunctionSearchTerm] = useState('');
  
  // 刷新函数
  const refreshTables = () => {
    loadTableList();
  };
  
  const refreshViews = () => {
    loadViewList();
  };
  
  const refreshProcedures = () => {
    loadProcedureList();
  };
  
  const refreshFunctions = () => {
    loadFunctionList();
  };
  
  // 搜索过滤函数
  const filterListBySearch = (list: any[], searchTerm: string) => {
    if (!searchTerm.trim()) {
      return list;
    }
    
    const term = searchTerm.toLowerCase();
    return list.filter(item => 
      (item.name && item.name.toLowerCase().includes(term)) ||
      (item.comment && item.comment.toLowerCase().includes(term))
    );
  };

  // 格式化大小函数，将字节数转换为MB或GB
  const formatSize = (bytes: number | string): string => {
    let sizeBytes = 0;
    
    // 处理传入的可能是字符串的情况
    if (typeof bytes === 'string') {
      // 检查是否已经包含单位
      if (bytes.includes('MB') || bytes.includes('GB') || bytes.includes('KB') || bytes.includes('TB')) {
        return bytes; // 如果已经有单位，直接返回
      }
      sizeBytes = parseFloat(bytes) || 0;
    } else {
      sizeBytes = bytes || 0;
    }

    // 转换为MB
    const sizeInMB = sizeBytes / (1024 * 1024);
    
    // 如果大于1024MB，转换为GB
    if (sizeInMB >= 1024) {
      return (sizeInMB / 1024).toFixed(2) + ' GB';
    }
    
    // 最小显示为MB
    return sizeInMB.toFixed(2) + ' MB';
  };

  // 加载数据库统计信息
  const loadDatabaseStats = async () => {
    if (!connection || !connection.isConnected || !window.electronAPI) {
      setDatabaseStats({ 
        tableCount: 0, 
        totalSize: '0 MB', 
        rowCount: 0, 
        indexCount: 0,
        viewCount: 0,
        procedureCount: 0,
        functionCount: 0
      });
      return;
    }

    try {
      const poolId = connection.connectionId || connection.id;
      let countQuery = '';
      let sizeQuery = '';
      let rowCountQuery = '';
      let viewCountQuery = '';
      let procedureCountQuery = '';
      let functionCountQuery = '';

      switch (connection.type) {
        case 'mysql':
          countQuery = `SELECT COUNT(*) AS table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${database}' AND TABLE_TYPE = 'BASE TABLE'`;
          sizeQuery = `SELECT SUM(data_length + index_length) AS total_size FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${database}'`;
          rowCountQuery = `SELECT SUM(table_rows) AS row_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${database}'`;
          viewCountQuery = `SELECT COUNT(*) AS view_count FROM information_schema.VIEWS WHERE TABLE_SCHEMA = '${database}'`;
          procedureCountQuery = `SELECT COUNT(*) AS procedure_count FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = '${database}' AND ROUTINE_TYPE = 'PROCEDURE'`;
          functionCountQuery = `SELECT COUNT(*) AS function_count FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = '${database}' AND ROUTINE_TYPE = 'FUNCTION'`;
          break;
        case 'postgresql':
        case 'gaussdb':
          countQuery = `SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = 'public' AND table_catalog = '${database}'`;
          sizeQuery = `SELECT SUM(pg_total_relation_size(table_schema || '.' || table_name)) AS total_size_bytes FROM information_schema.tables WHERE table_schema = 'public' AND table_catalog = '${database}'`;
          rowCountQuery = `SELECT SUM(pg_relation_size(quote_ident(table_name))) AS row_count FROM information_schema.tables WHERE table_schema = 'public' AND table_catalog = '${database}'`;
          break;
        case 'oracle':
          countQuery = `SELECT COUNT(*) AS table_count FROM all_tables WHERE owner = '${database.toUpperCase()}'`;
          sizeQuery = `SELECT 'N/A' AS total_size FROM dual`;
          rowCountQuery = `SELECT SUM(num_rows) AS row_count FROM all_tables WHERE owner = '${database.toUpperCase()}'`;
          break;
        case 'sqlite':
          countQuery = `SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`;
          sizeQuery = `SELECT 'N/A' AS total_size`;
          rowCountQuery = `SELECT 'N/A' AS row_count`;
          break;
        default:
          countQuery = 'SELECT 0 AS table_count';
          sizeQuery = 'SELECT \'0 MB\' AS total_size';
          rowCountQuery = 'SELECT 0 AS row_count';
      }

      // 如果是MySQL数据库，获取版本信息
      if (connection.type === 'mysql') {
        try {
          const dbInfo = await window.electronAPI.getDatabaseInfo(poolId);
          if (dbInfo?.success && dbInfo?.version) {
            setMysqlVersion(dbInfo.version);
          } else {
            setMysqlVersion('未知');
          }
        } catch (error) {
          console.error('获取数据库版本信息失败:', error);
          setMysqlVersion('未知');
        }
      }
      
      const countResult = await window.electronAPI.executeQuery(poolId, countQuery);
      const sizeResult = await window.electronAPI.executeQuery(poolId, sizeQuery);
      const rowCountResult = await window.electronAPI.executeQuery(poolId, rowCountQuery);

      let totalSize = '0 MB';
      
      // 处理不同数据库的大小结果
      if (connection.type === 'mysql' && sizeResult?.success && sizeResult.data?.length > 0) {
        // MySQL返回的是字节数，需要格式化
        totalSize = formatSize(sizeResult.data[0].total_size || 0);
      } else if ((connection.type === 'postgresql' || connection.type === 'gaussdb') && sizeResult?.success && sizeResult.data?.length > 0) {
        // PostgreSQL返回的是字节数，需要格式化
          totalSize = formatSize(sizeResult.data[0].total_size_bytes || 0);
        } else if (sizeResult?.success && sizeResult.data?.length > 0 && sizeResult.data[0].total_size) {
          // 其他数据库可能已经格式化过
          totalSize = sizeResult.data[0].total_size;
        }

        // 初始化视图、存储过程和函数数量为0
        let viewCount = 0;
        let procedureCount = 0;
        let functionCount = 0;

        // 对于MySQL数据库，执行额外的查询来获取视图、存储过程和函数数量
        if (connection.type === 'mysql') {
          const viewResult = viewCountQuery ? await window.electronAPI.executeQuery(poolId, viewCountQuery) : null;
          const procedureResult = procedureCountQuery ? await window.electronAPI.executeQuery(poolId, procedureCountQuery) : null;
          const functionResult = functionCountQuery ? await window.electronAPI.executeQuery(poolId, functionCountQuery) : null;

          viewCount = viewResult?.success && viewResult.data?.length > 0 ? viewResult.data[0].view_count || 0 : 0;
          procedureCount = procedureResult?.success && procedureResult.data?.length > 0 ? procedureResult.data[0].procedure_count || 0 : 0;
          functionCount = functionResult?.success && functionResult.data?.length > 0 ? functionResult.data[0].function_count || 0 : 0;
        }

        setDatabaseStats({
          tableCount: countResult?.success && countResult.data?.length > 0 ? countResult.data[0].table_count || 0 : 0,
          totalSize: totalSize,
          rowCount: rowCountResult?.success && rowCountResult.data?.length > 0 ? rowCountResult.data[0].row_count || 0 : 0,
          indexCount: 0, // 索引数量需要额外查询，这里简化处理
          viewCount: viewCount,
          procedureCount: procedureCount,
          functionCount: functionCount
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
        // 连接断开时清空列表，而不是显示模拟数据
        setTableList([]);
        return;
      }

      const poolId = connection.connectionId || connection.id;
      let tablesQuery = '';
        let queryParams: any[] = [];

      switch (connection.type) {
        case 'mysql':
          // 增强MySQL查询，使用参数化查询防止SQL注入
          tablesQuery = `SELECT table_name, table_name AS name, table_comment AS comment, engine, table_rows AS \`rows\`, 
            ROUND((data_length + index_length) / 1024 / 1024, 2) AS size_mb, 
            create_time AS created 
            FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?`;
          queryParams = [database];
          break;
        case 'postgresql':
        case 'gaussdb':
          tablesQuery = `SELECT table_name AS name, 
            (SELECT description FROM pg_description WHERE objoid = c.oid AND objsubid = 0) AS comment, 
            'PostgreSQL' AS engine, 
            0 AS rows, 
            pg_size_pretty(pg_relation_size('"' || ? || '".' || quote_ident(table_name))) AS size, 
            to_char(created, 'YYYY-MM-DD') AS created 
            FROM information_schema.tables c WHERE table_schema = 'public' AND table_catalog = ?`;
          queryParams = [database, database];
          break;
        case 'oracle':
          tablesQuery = `SELECT table_name AS name, comments AS comment, 'Oracle' AS engine, 
            num_rows AS rows, 'N/A' AS size, 
            to_char(created, 'YYYY-MM-DD') AS created 
            FROM all_tables WHERE owner = ?`;
          queryParams = [database.toUpperCase()];
          break;
        case 'sqlite':
          // SQLite不支持在子查询中引用外部表名，简化查询
          tablesQuery = `SELECT name, 'N/A' AS comment, 'SQLite' AS engine, 
            0 AS rows, 'N/A' AS size, 
            'N/A' AS created 
            FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`;
          queryParams = [];
          break;
        default:
          tablesQuery = 'SELECT NULL AS name, NULL AS comment, NULL AS engine, 0 AS rows, NULL AS size, NULL AS created LIMIT 0';
          queryParams = [];
      }

      console.log('执行的表列表查询:', tablesQuery, '数据库:', database);
      const result = await window.electronAPI.executeQuery(poolId, tablesQuery, queryParams);
      console.log('表列表查询结果:', JSON.stringify(result, null, 2));
      
      if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
        // 处理大小格式，确保所有表都有size字段
        const processedTables = result.data.map((table: any) => {
          // 增强表名处理逻辑，确保能够正确提取表名
          console.log('原始表数据:', JSON.stringify(table));
          
          // 支持更多可能的表名字段格式
          const tableName = 
            table.name || 
            table.table_name || 
            table.TABLE_NAME || 
            table.tableName || 
            table['table-name'] || 
            table['TABLE-NAME'] ||
            (typeof table === 'object' && Object.values(table)[0]) || // 作为最后的备选，尝试获取第一个值
            '未知表'; // 最差情况下使用默认名称
          
          console.log('处理后表名:', tableName);
          
          return {
            ...table,
            name: tableName,
            size: table.size || (table.size_mb ? `${table.size_mb} MB` : '0 MB'),
            rows: table.rows || table.TABLE_ROWS || table.table_rows || 0,
            comment: table.comment || table.table_comment || table.TABLE_COMMENT || '',
            created: table.created || table.CREATE_TIME || table.create_time || 'N/A',
            engine: table.engine || table.ENGINE || 'N/A'
          };
        });
        
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
      // 出错时清空列表，而不是显示模拟数据
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
  const [selectedTable, setSelectedTable] = useState<any>(null);
  
  const handleTableSelect = (tableName: string) => {
    const table = tableList.find(t => t.name === tableName);
    setSelectedTable(table);
    if (onTableSelect) {
      onTableSelect(tableName);
    }
  };

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

  // 加载视图列表
  const loadViewList = async () => {
    // 只有在MySQL连接时才尝试加载视图
    if (connection?.type !== 'mysql') {
      setViewList([]);
      return;
    }

    try {
      if (!connection || !connection.isConnected || !window.electronAPI) {
        console.warn('数据库未连接或Electron API不可用，无法加载视图列表');
        // 连接断开时清空列表，而不是显示模拟数据
        setViewList([]);
        return;
      }

      const poolId = connection.connectionId || connection.id;
      // 修正：在MySQL中，视图的注释信息存储在information_schema.TABLES表中
      // 使用LEFT JOIN连接VIEWS和TABLES表来获取完整信息
      const viewQuery = `SELECT v.table_name, v.view_definition, t.table_comment, v.create_time 
        FROM information_schema.VIEWS v
        LEFT JOIN information_schema.TABLES t ON v.table_schema = t.table_schema AND v.table_name = t.table_name
        WHERE v.TABLE_SCHEMA = ?`;
      
      console.log('执行视图列表查询:', viewQuery, '数据库:', database);
      const result = await window.electronAPI.executeQuery(poolId, viewQuery, [database]);
      
      if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
        // 处理真实数据
        const processedViews = result.data.map((view: any) => ({
          name: view.table_name || view.name || '未知视图',
          definition: view.view_definition || '',
          comment: view.table_comment || '',
          created: view.create_time ? new Date(view.create_time).toLocaleDateString() : 'N/A'
        }));
        console.log('成功加载视图列表，共', processedViews.length, '个视图');
        setViewList(processedViews);
      } else if (result && result.success && Array.isArray(result.data) && result.data.length === 0) {
        // 查询成功但没有数据
        console.log('当前数据库没有视图');
        setViewList([]);
      } else {
        console.error('视图列表查询返回非预期结果:', JSON.stringify(result, null, 2));
        setViewList([]);
      }
    } catch (error) {
      console.error('加载视图列表失败:', error);
      // 出错时清空列表，而不是显示模拟数据
      setViewList([]);
    }
  };

  // 加载存储过程列表
  const loadProcedureList = async () => {
    // 只有在MySQL连接时才尝试加载存储过程
    if (connection?.type !== 'mysql') {
      setProcedureList([]);
      return;
    }

    try {
      if (!connection || !connection.isConnected || !window.electronAPI) {
        console.warn('数据库未连接或Electron API不可用，无法加载存储过程列表');
        // 连接断开时清空列表，而不是显示模拟数据
        setProcedureList([]);
        return;
      }

      const poolId = connection.connectionId || connection.id;
      const procedureQuery = `SELECT routine_name, routine_definition, routine_comment, created 
        FROM information_schema.ROUTINES 
        WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE'`;
      
      console.log('执行存储过程列表查询:', procedureQuery, '数据库:', database);
      const result = await window.electronAPI.executeQuery(poolId, procedureQuery, [database]);
      
      if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
        // 处理真实数据
        const processedProcedures = result.data.map((procedure: any) => ({
          name: procedure.routine_name || procedure.name || '未知存储过程',
          definition: procedure.routine_definition || '',
          comment: procedure.routine_comment || '',
          created: procedure.created ? new Date(procedure.created).toLocaleDateString() : 'N/A'
        }));
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
      // 出错时清空列表，而不是显示模拟数据
      setProcedureList([]);
    }
  };

  // 加载函数列表
  const loadFunctionList = async () => {
    // 只有在MySQL连接时才尝试加载函数
    if (connection?.type !== 'mysql') {
      setFunctionList([]);
      return;
    }

    try {
      if (!connection || !connection.isConnected || !window.electronAPI) {
        console.warn('数据库未连接或Electron API不可用，无法加载函数列表');
        // 连接断开时清空列表，而不是显示模拟数据
        setFunctionList([]);
        return;
      }

      const poolId = connection.connectionId || connection.id;
      const functionQuery = `SELECT routine_name, routine_definition, routine_comment, created 
        FROM information_schema.ROUTINES 
        WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION'`;
      
      console.log('执行函数列表查询:', functionQuery, '数据库:', database);
      const result = await window.electronAPI.executeQuery(poolId, functionQuery, [database]);
      
      if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
        // 处理真实数据
        const processedFunctions = result.data.map((func: any) => ({
          name: func.routine_name || func.name || '未知函数',
          definition: func.routine_definition || '',
          comment: func.routine_comment || '',
          created: func.created ? new Date(func.created).toLocaleDateString() : 'N/A'
        }));
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
      // 出错时清空列表，而不是显示模拟数据
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
        loadRecentQueries()
      ];

      // 对于MySQL数据库，额外加载视图、存储过程和函数
      if (connection?.type === 'mysql') {
        promises.push(loadViewList());
        promises.push(loadProcedureList());
        promises.push(loadFunctionList());
      }

      await Promise.all(promises);
    } catch (error) {
      console.error('加载数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

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

  // 处理函数（实际功能需要根据项目具体实现）
  const handleViewSelect = (viewName: string) => {
    onTableSelect(viewName);
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
    onTableDesign(connection, database, tableName);
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

  const tableColumns = [
    {
      title: '表名',
      dataIndex: 'name',
      key: 'name',
      render: (text: string) => (
        <Dropdown overlay={handleTableContextMenu(text)}>
          <Button 
            type="link" 
            onClick={() => handleTableSelect(text)}
            icon={<TableOutlined />}
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
      key: 'created'
    }
  ];

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
      render: (text: string) => (
        <Dropdown overlay={handleViewContextMenu(text)}>
          <Button 
            type="link" 
            icon={<EyeOutlined />}
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
      title: '定义',
      dataIndex: 'definition',
      key: 'definition',
      render: (text: string) => (
        <code style={{ fontSize: '12px', background: '#f5f5f5', padding: '2px 4px', borderRadius: '3px' }}>
          {text.length > 100 ? text.substring(0, 100) + '...' : text}
        </code>
      )
    },
    {
      title: '创建时间',
      dataIndex: 'created',
      key: 'created'
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

  return (
    <div className="database-tab-panel">
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
                  {/* MySQL特定的详情信息 - 只有获取到版本信息时才显示 */}
                  {connection?.type === 'mysql' && mysqlVersion !== '未知' && (
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
                {connection?.type === 'mysql' && (
                  <Spin spinning={loading}>
                    <Statistic title="视图数量" value={databaseStats.viewCount} />
                  </Spin>
                )}
                {connection?.type === 'mysql' && (
                  <Spin spinning={loading}>
                    <Statistic title="存储过程" value={databaseStats.procedureCount} />
                  </Spin>
                )}
                {connection?.type === 'mysql' && (
                  <Spin spinning={loading}>
                    <Statistic title="函数数量" value={databaseStats.functionCount} />
                  </Spin>
                )}
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
                />
              </Card>
            </div>
          )
          },
          // 仅对MySQL数据库显示视图、存储过程和函数标签页
          ...(connection?.type === 'mysql' ? [
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
                    <Table
                      dataSource={filterListBySearch(viewList, viewSearchTerm)}
                      columns={viewColumns}
                      pagination={false}
                      size="small"
                      rowKey="name"
                      locale={{ emptyText: '暂无视图数据' }}
                      bordered
                      style={{ border: '1px solid #f0f0f0', borderRadius: '2px' }}
                    />
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
                    <Table
                      dataSource={filterListBySearch(procedureList, procedureSearchTerm)}
                      columns={procedureColumns}
                      pagination={false}
                      size="small"
                      rowKey="name"
                      locale={{ emptyText: '暂无存储过程数据' }}
                      bordered
                      style={{ border: '1px solid #f0f0f0', borderRadius: '2px' }}
                    />
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
                    <Table
                      dataSource={filterListBySearch(functionList, functionSearchTerm)}
                      columns={functionColumns}
                      pagination={false}
                      size="small"
                      rowKey="name"
                      locale={{ emptyText: '暂无函数数据' }}
                      bordered
                      style={{ border: '1px solid #f0f0f0', borderRadius: '2px' }}
                    />
                  </Card>
                </div>
              )
            }
          ] : []),
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
                  <Table
                    dataSource={recentQueries}
                    columns={queryColumns}
                    pagination={false}
                    size="small"
                    rowKey="query"
                  />
                </Card>
              </div>
            )
          }
        ]}
      />
    </div>
  );
};

export default DatabaseTabPanel;