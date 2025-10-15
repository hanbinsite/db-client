import React, { useState, useEffect } from 'react';
import { Button, Card, Input, Row, Col, Statistic, Space, Spin, Tag, Table, Tabs, Modal, message, Dropdown, Menu } from 'antd';
import { DatabaseOutlined, TableOutlined, EyeOutlined, PlayCircleOutlined, FunctionOutlined, BarChartOutlined } from '@ant-design/icons';
import type { DatabaseType, DatabaseConnection } from '../../types';

interface Props {
  connection: DatabaseConnection;
  database: string; // 对于PostgreSQL，这里传入的实际上是schema名称
  type: DatabaseType;
  darkMode?: boolean;
  onTableSelect?: (tableName: string) => void;
  onTableDesign?: (connection: DatabaseConnection, database: string, tableName: string) => void;
}

const PostgreSqlDatabaseTabPanel: React.FC<Props> = ({ connection, database, type, darkMode = false, onTableSelect, onTableDesign }) => {
  // 状态管理
  const [loading, setLoading] = useState(false);
  const [tableList, setTableList] = useState<any[]>([]);
  const [viewList, setViewList] = useState<any[]>([]);
  const [procedureList, setProcedureList] = useState<any[]>([]);
  const [functionList, setFunctionList] = useState<any[]>([]);
  const [recentQueries, setRecentQueries] = useState<any[]>([]);
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
  
  // 当database（schema名称）或connection变化时，自动加载数据
  useEffect(() => {
    if (connection && connection.isConnected && database) {
      console.log(`PostgreSqlDatabaseTabPanel - 检测到schema变化: ${database}，开始加载数据`);
      loadAllData();
    }
  }, [connection, database]); // 依赖项包括connection和database

  // 加载数据库统计信息
  const loadDatabaseStats = async () => {
    try {
      if (!connection || !connection.isConnected || !window.electronAPI) {
        console.warn('数据库未连接或Electron API不可用，无法加载数据库统计信息');
        return;
      }

      const poolId = connection.connectionId || connection.id;
      const schemaName = database; // 对于PostgreSQL，传入的database参数是schema名称
      
      // 获取表数量、大小和行数
      const tableStatsQuery = `
        SELECT 
          COUNT(*) as table_count,
          SUM(pg_total_relation_size(c.oid)) as total_size,
          SUM(reltuples::bigint) as row_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = $1
      `;
      
      // 获取视图数量
      const viewCountQuery = `
        SELECT COUNT(*) as view_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'v' AND n.nspname = $1
      `;
      
      // 获取存储过程数量
      const procedureCountQuery = `
        SELECT COUNT(*) as procedure_count
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = $1 AND p.prokind = 'p'
      `;
      
      // 获取函数数量
      const functionCountQuery = `
        SELECT COUNT(*) as function_count
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = $1 AND p.prokind = 'f'
      `;
      
      const [tableStatsResult, viewCountResult, procedureCountResult, functionCountResult] = await Promise.all([
        window.electronAPI.executeQuery(poolId, tableStatsQuery, [schemaName]),
        window.electronAPI.executeQuery(poolId, viewCountQuery, [schemaName]),
        window.electronAPI.executeQuery(poolId, procedureCountQuery, [schemaName]),
        window.electronAPI.executeQuery(poolId, functionCountQuery, [schemaName])
      ]);

      // 计算总大小并格式化
      const bytes = tableStatsResult?.success && tableStatsResult.data?.length > 0 ? tableStatsResult.data[0].total_size || 0 : 0;
      const totalSize = formatSize(bytes);

      setDatabaseStats({
        tableCount: tableStatsResult?.success && tableStatsResult.data?.length > 0 ? tableStatsResult.data[0].table_count || 0 : 0,
        totalSize: totalSize,
        rowCount: tableStatsResult?.success && tableStatsResult.data?.length > 0 ? tableStatsResult.data[0].row_count || 0 : 0,
        indexCount: 0, // 索引数量需要额外查询，这里简化处理
        viewCount: viewCountResult?.success && viewCountResult.data?.length > 0 ? viewCountResult.data[0].view_count || 0 : 0,
        procedureCount: procedureCountResult?.success && procedureCountResult.data?.length > 0 ? procedureCountResult.data[0].procedure_count || 0 : 0,
        functionCount: functionCountResult?.success && functionCountResult.data?.length > 0 ? functionCountResult.data[0].function_count || 0 : 0
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
      const schemaName = database; // 对于PostgreSQL，传入的database参数是schema名称
      
      // PostgreSQL查询
      const tableQuery = `
        SELECT 
          c.relname AS table_name,
          pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
          (SELECT reltuples::bigint FROM pg_class WHERE oid = c.oid) AS table_rows,
          pg_get_userbyid(c.relowner) AS table_owner,
          (SELECT description FROM pg_description WHERE objoid = c.oid AND objsubid = 0) AS table_comment,
          to_char(pg_stat_file('base/'||oid::text||'/1').modification,'YYYY-MM-DD HH24:MI:SS') as create_time
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = $1
        ORDER BY c.relname`;
      
      console.log('执行PostgreSQL表列表查询:', tableQuery, 'Schema:', schemaName);
      const result = await window.electronAPI.executeQuery(poolId, tableQuery, [schemaName]);
      
      if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
        // 处理真实数据
        const processedTables = result.data.map((table: any) => ({
          name: table.table_name || '未知表',
          rows: table.table_rows || 0,
          size: table.size || formatSize(0),
          created: table.create_time || 'N/A',
          comment: table.table_comment || '',
          owner: table.table_owner || ''
        }));
        console.log('成功加载表列表，共', processedTables.length, '个表');
        setTableList(processedTables);
      } else if (result && result.success && Array.isArray(result.data) && result.data.length === 0) {
        // 查询成功但没有数据
        console.log('当前Schema没有表');
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
      const schemaName = database; // 对于PostgreSQL，传入的database参数是schema名称
      
      // PostgreSQL查询
      const viewQuery = `
        SELECT 
          c.relname AS view_name,
          pg_get_viewdef(c.oid, true) AS view_definition,
          pg_get_userbyid(c.relowner) AS viewowner,
          to_char(pg_stat_file('base/'||oid::text||'/1').modification,'YYYY-MM-DD HH24:MI:SS') as create_time,
          (SELECT description FROM pg_description WHERE objoid = c.oid AND objsubid = 0) as comment
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'v' AND n.nspname = $1
        ORDER BY c.relname`;
      
      console.log('执行视图列表查询:', viewQuery, 'Schema:', schemaName);
      const result = await window.electronAPI.executeQuery(poolId, viewQuery, [schemaName]);
      
      if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
        // 处理真实数据
        const processedViews = result.data.map((view: any) => ({
          name: view.view_name || '未知视图',
          definition: view.view_definition || '',
          comment: view.comment || '',
          created: view.create_time ? new Date(view.create_time).toLocaleDateString() : 'N/A',
          owner: view.viewowner || ''
        }));
        console.log('成功加载视图列表，共', processedViews.length, '个视图');
        setViewList(processedViews);
      } else if (result && result.success && Array.isArray(result.data) && result.data.length === 0) {
        // 查询成功但没有数据
        console.log('当前Schema没有视图');
        setViewList([]);
      } else {
        console.error('视图列表查询返回非预期结果:', JSON.stringify(result, null, 2));
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
      const schemaName = database; // 对于PostgreSQL，传入的database参数是schema名称
      
      // PostgreSQL查询（在PostgreSQL中，存储过程通常也被视为函数，但使用PROCEDURE作为procostype）
      const procedureQuery = `
        SELECT 
          n.nspname AS schema_name,
          p.proname AS routine_name,
          pg_get_functiondef(p.oid) AS routine_definition,
          d.description AS routine_comment,
          pg_get_userbyid(p.proowner) AS owner_name,
          p.prolang::regproc AS language,
          p.procost AS cost,
          p.prorows AS rows
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        LEFT JOIN pg_description d ON p.oid = d.objoid AND d.objsubid = 0
        WHERE n.nspname = $1
        AND p.prokind = 'p'  -- 'p'表示存储过程
        ORDER BY p.proname`;
      
      console.log('执行存储过程列表查询:', procedureQuery, 'Schema:', schemaName);
      const result = await window.electronAPI.executeQuery(poolId, procedureQuery, [schemaName]);
      
      if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
        // 处理真实数据
        const processedProcedures = result.data.map((procedure: any) => ({
          name: procedure.routine_name || '未知存储过程',
          definition: procedure.routine_definition || '',
          comment: procedure.routine_comment || '',
          language: procedure.language || 'sql',
          owner: procedure.owner_name || ''
        }));
        console.log('成功加载存储过程列表，共', processedProcedures.length, '个存储过程');
        setProcedureList(processedProcedures);
      } else if (result && result.success && Array.isArray(result.data) && result.data.length === 0) {
        // 查询成功但没有数据
        console.log('当前Schema没有存储过程');
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
      const schemaName = database; // 对于PostgreSQL，传入的database参数是schema名称
      
      // PostgreSQL查询
      const functionQuery = `
        SELECT 
          n.nspname AS schema_name,
          p.proname AS routine_name,
          pg_get_functiondef(p.oid) AS routine_definition,
          d.description AS routine_comment,
          pg_get_userbyid(p.proowner) AS owner_name,
          p.prolang::regproc AS language,
          pg_get_function_arguments(p.oid) AS arguments,
          pg_get_function_result(p.oid) AS return_type
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        LEFT JOIN pg_description d ON p.oid = d.objoid AND d.objsubid = 0
        WHERE n.nspname = $1
        AND p.prokind = 'f'  -- 'f'表示函数
        ORDER BY p.proname`;
      
      console.log('执行函数列表查询:', functionQuery, 'Schema:', schemaName);
      const result = await window.electronAPI.executeQuery(poolId, functionQuery, [schemaName]);
      
      if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
        // 处理真实数据
        const processedFunctions = result.data.map((func: any) => ({
          name: func.routine_name || '未知函数',
          definition: func.routine_definition || '',
          comment: func.routine_comment || '',
          language: func.language || 'sql',
          owner: func.owner_name || '',
          arguments: func.arguments || '',
          returnType: func.return_type || ''
        }));
        console.log('成功加载函数列表，共', processedFunctions.length, '个函数');
        setFunctionList(processedFunctions);
      } else if (result && result.success && Array.isArray(result.data) && result.data.length === 0) {
        // 查询成功但没有数据
        console.log('当前Schema没有函数');
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
      title: '所有者',
      dataIndex: 'owner',
      key: 'owner',
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
      title: '所有者',
      dataIndex: 'owner',
      key: 'owner',
      width: 120
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
      title: '语言',
      dataIndex: 'language',
      key: 'language',
      width: 100
    },
    {
      title: '所有者',
      dataIndex: 'owner',
      key: 'owner',
      width: 120
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
      title: '参数',
      dataIndex: 'arguments',
      key: 'arguments',
      width: 200
    },
    {
      title: '返回类型',
      dataIndex: 'returnType',
      key: 'returnType',
      width: 120
    },
    {
      title: '语言',
      dataIndex: 'language',
      key: 'language',
      width: 100
    },
    {
      title: '所有者',
      dataIndex: 'owner',
      key: 'owner',
      width: 120
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

  // 复制一个数据库状态作为GaussDB的处理
  const isGaussDB = type === 'gaussdb';

  return (
    <div className={`${isGaussDB ? 'gaussdb' : 'postgresql'}-database-tab-panel`}>
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
                  {database} {isGaussDB ? '(Schema)' : '(Schema)'}
                </h2>
                <Space size={8} style={{ marginTop: 4 }}>
                  <Tag color={getDatabaseColor(type)}>{type.toUpperCase()}</Tag>
                  <span style={{ color: '#666', fontSize: 12 }}>
                    连接: {connection?.name || '-'} - 状态: {connection?.isConnected ? '已连接' : '未连接'}
                  </span>
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

export default PostgreSqlDatabaseTabPanel;