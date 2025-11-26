import React, { useState, useEffect } from 'react';
import { ipcRenderer } from 'electron';
import { Button, Select, Input, Table, Tooltip, Tag, message } from 'antd';
import { 
  PlusOutlined, MinusOutlined, FilterOutlined, 
  PlayCircleOutlined,
  DatabaseOutlined, TableOutlined, 
  ColumnWidthOutlined, SortAscendingOutlined, SortDescendingOutlined,
  CopyOutlined, DeleteOutlined
} from '@ant-design/icons';

const { Option } = Select;
const { TextArea } = Input;

interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  schema?: string;
}

interface ColumnInfo {
  name: string;
  type: string;
  description?: string;
}

interface JoinCondition {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  joinType: 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';
}

interface FilterCondition {
  column: string;
  operator: string;
  value: string;
  logicalOperator: 'AND' | 'OR';
  table: string;
}

interface SortCondition {
  column: string;
  order: 'ASC' | 'DESC';
  table: string;
}

interface SelectedColumn {
  name: string;
  alias?: string;
  table: string;
}

interface QueryBuilderState {
  tables: TableInfo[];
  selectedTables: string[];
  selectedColumns: SelectedColumn[];
  joinConditions: JoinCondition[];
  filterConditions: FilterCondition[];
  sortConditions: SortCondition[];
  groupByColumns: string[];
  limit: number;
  offset: number;
  databaseType: string;
  generatedSql: string;
  isLoading: boolean;
  error: string | null;
}

export const SqlBuilder: React.FC<{ connectionId: string }> = ({ connectionId }) => {
  // Simplified theme handling without styles variable
  const theme = 'light'; // Default theme
  const [state, setState] = useState<QueryBuilderState>({
    tables: [],
    selectedTables: [],
    selectedColumns: [],
    joinConditions: [],
    filterConditions: [],
    sortConditions: [],
    groupByColumns: [],
    limit: 100,
    offset: 0,
    databaseType: '',
    generatedSql: '',
    isLoading: false,
    error: null
  });

  // 获取数据库连接信息和表结构
  useEffect(() => {
    const fetchDatabaseInfo = async () => {
      try {
        setState(prev => ({ ...prev, isLoading: true, error: null }));
        
        // 获取数据库类型
        const dbInfo = await ipcRenderer.invoke('get-database-info', { connectionId });
        if (!dbInfo.success) {
          throw new Error(dbInfo.error || '获取数据库信息失败');
        }
        
        // 获取所有表
        const tablesResult = await ipcRenderer.invoke('list-tables', { connectionId });
        if (!tablesResult.success) {
          throw new Error(tablesResult.error || '获取表列表失败');
        }
        
        // 获取每个表的列信息
        const tablesWithColumns: TableInfo[] = [];
        for (const table of tablesResult.data) {
          const columnsResult = await ipcRenderer.invoke('get-table-structure', {
            connectionId,
            tableName: table.name,
            schema: table.schema
          });
          
          if (columnsResult.success) {
            tablesWithColumns.push({
              name: table.name,
              schema: table.schema,
              columns: columnsResult.data
            });
          }
        }
        
        setState(prev => ({
          ...prev,
          tables: tablesWithColumns,
          databaseType: dbInfo.data.type || '',
          isLoading: false
        }));
        
      } catch (error) {
        console.error('加载数据库信息失败:', error);
        setState(prev => ({
          ...prev,
          error: (error as Error).message,
          isLoading: false
        }));
      }
    };
    
    fetchDatabaseInfo();
  }, [connectionId]);

  // 生成SQL查询
  useEffect(() => {
    if (state.selectedTables.length === 0) {
      setState(prev => ({ ...prev, generatedSql: '' }));
      return;
    }
    
    try {
      let sql = 'SELECT ';
      
      // 构建SELECT部分
      if (state.selectedColumns.length === 0) {
        sql += '\n  *';
      } else {
        sql += '\n  ' + state.selectedColumns.map(col => {
          const tableAlias = getTableAlias(col.table);
          const columnRef = `${tableAlias}.${col.name}`;
          return col.alias ? `${columnRef} AS ${col.alias}` : columnRef;
        }).join(',\n  ');
      }
      
      // 构建FROM部分
      sql += '\nFROM\n  ';
      sql += state.selectedTables.map(table => {
        const tableObj = state.tables.find(t => t.name === table);
        const fullName = tableObj?.schema ? `${tableObj.schema}.${table}` : table;
        return `${fullName} ${getTableAlias(table)}`;
      }).join(',\n  ');
      
      // 构建JOIN部分
      if (state.joinConditions.length > 0) {
        state.joinConditions.forEach(join => {
          const targetTableObj = state.tables.find(t => t.name === join.targetTable);
          const targetFullName = targetTableObj?.schema ? `${targetTableObj.schema}.${join.targetTable}` : join.targetTable;
          
          sql += `\n${join.joinType} JOIN\n  ${targetFullName} ${getTableAlias(join.targetTable)}`;
          sql += `\n  ON ${getTableAlias(join.sourceTable)}.${join.sourceColumn} = ${getTableAlias(join.targetTable)}.${join.targetColumn}`;
        });
      }
      
      // 构建WHERE部分
      if (state.filterConditions.length > 0) {
        sql += '\nWHERE';
        state.filterConditions.forEach((filter, index) => {
          if (index > 0) {
            sql += `\n  ${filter.logicalOperator}`;
          }
          
          const tableAlias = getTableAlias(filter.table);
          const columnRef = `${tableAlias}.${filter.column}`;
          let valueStr = '';
          
          // 根据操作符处理值
          if (filter.operator === 'IS NULL' || filter.operator === 'IS NOT NULL') {
            valueStr = '';
          } else if (filter.operator === 'IN' || filter.operator === 'NOT IN') {
            // 处理IN操作符，假设值是以逗号分隔的列表
            const values = filter.value.split(',').map(v => v.trim());
            valueStr = ` (${values.map(v => isNaN(Number(v)) ? `'${v}'` : v).join(', ')})`;
          } else if (filter.operator === 'LIKE' || filter.operator === 'NOT LIKE') {
            valueStr = ` '${filter.value}'`;
          } else {
            // 数字或字符串值
            valueStr = ` ${isNaN(Number(filter.value)) ? `'${filter.value}'` : filter.value}`;
          }
          
          sql += `\n  ${columnRef} ${filter.operator}${valueStr}`;
        });
      }
      
      // 构建GROUP BY部分
      if (state.groupByColumns.length > 0) {
        sql += '\nGROUP BY\n  ';
        sql += state.groupByColumns.map(col => {
          const [table, column] = col.split('.');
          return `${getTableAlias(table)}.${column}`;
        }).join(',\n  ');
      }
      
      // 构建ORDER BY部分
      if (state.sortConditions.length > 0) {
        sql += '\nORDER BY\n  ';
        sql += state.sortConditions.map(sort => {
          const tableAlias = getTableAlias(sort.table);
          return `${tableAlias}.${sort.column} ${sort.order}`;
        }).join(',\n  ');
      }
      
      // 构建LIMIT部分
      if (state.limit > 0) {
        sql += `\nLIMIT ${state.limit}`;
        if (state.offset > 0) {
          // 根据数据库类型处理OFFSET
          if (state.databaseType === 'oracle') {
            // Oracle使用ROWNUM方式，已在前面处理
          } else if (state.databaseType === 'sqlserver') {
            // SQL Server使用OFFSET FETCH语法
            sql = sql.replace(`LIMIT ${state.limit}`, `OFFSET ${state.offset} ROWS FETCH NEXT ${state.limit} ROWS ONLY`);
          } else {
            // MySQL, PostgreSQL, SQLite
            sql += ` OFFSET ${state.offset}`;
          }
        }
      }
      
      setState(prev => ({ ...prev, generatedSql: sql }));
      
    } catch (error) {
      console.error('生成SQL失败:', error);
      setState(prev => ({ ...prev, error: 'SQL生成失败' }));
    }
  }, [state.selectedTables, state.selectedColumns, state.joinConditions, 
    state.filterConditions, state.sortConditions, state.groupByColumns, 
    state.limit, state.offset, state.databaseType, state.tables]);

  // 获取表的别名（使用表名的首字母）
  const getTableAlias = (tableName: string): string => {
    // 处理可能的schema.table格式
    const nameParts = tableName.split('.');
    const shortName = nameParts[nameParts.length - 1];
    
    // 取表名的首字母小写作为别名
    return shortName.charAt(0).toLowerCase();
  };

  // 添加表
  const handleAddTable = (tableName: string) => {
    if (!state.selectedTables.includes(tableName)) {
      setState(prev => ({
        ...prev,
        selectedTables: [...prev.selectedTables, tableName]
      }));
    }
  };

  // 移除表
  const handleRemoveTable = (tableName: string) => {
    setState(prev => ({
      ...prev,
      selectedTables: prev.selectedTables.filter(t => t !== tableName),
      // 同时移除相关的列、连接、过滤和排序条件
      selectedColumns: prev.selectedColumns.filter(col => col.table !== tableName),
      joinConditions: prev.joinConditions.filter(
        j => j.sourceTable !== tableName && j.targetTable !== tableName
      ),
      filterConditions: prev.filterConditions.filter(f => f.table !== tableName),
      sortConditions: prev.sortConditions.filter(s => s.table !== tableName),
      groupByColumns: prev.groupByColumns.filter(
        g => !g.startsWith(`${tableName}.`)
      )
    }));
  };

  // 添加列
  const handleAddColumn = (tableName: string, columnName: string) => {
    const existingIndex = state.selectedColumns.findIndex(
      col => col.table === tableName && col.name === columnName
    );
    
    if (existingIndex === -1) {
      setState(prev => ({
        ...prev,
        selectedColumns: [...prev.selectedColumns, { table: tableName, name: columnName }]
      }));
    }
  };

  // 移除列
  const handleRemoveColumn = (tableName: string, columnName: string) => {
    setState(prev => ({
      ...prev,
      selectedColumns: prev.selectedColumns.filter(
        col => !(col.table === tableName && col.name === columnName)
      )
    }));
  };

  // 添加连接条件
  const handleAddJoin = () => {
    if (state.selectedTables.length < 2) {
      message.warning('请至少选择两个表才能添加连接');
      return;
    }
    
    // 默认添加第一个表和第二个表的连接
    const join: JoinCondition = {
      sourceTable: state.selectedTables[0],
      sourceColumn: state.tables.find(t => t.name === state.selectedTables[0])?.columns[0]?.name || '',
      targetTable: state.selectedTables[1],
      targetColumn: state.tables.find(t => t.name === state.selectedTables[1])?.columns[0]?.name || '',
      joinType: 'INNER'
    };
    
    setState(prev => ({
      ...prev,
      joinConditions: [...prev.joinConditions, join]
    }));
  };

  // 更新连接条件
  const handleUpdateJoin = (index: number, field: keyof JoinCondition, value: string) => {
    setState(prev => {
      const updated = [...prev.joinConditions];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, joinConditions: updated };
    });
  };

  // 移除连接条件
  const handleRemoveJoin = (index: number) => {
    setState(prev => ({
      ...prev,
      joinConditions: prev.joinConditions.filter((_, i) => i !== index)
    }));
  };

  // 添加过滤条件
  const handleAddFilter = () => {
    if (state.selectedTables.length === 0) {
      message.warning('请先选择表');
      return;
    }
    
    const tableName = state.selectedTables[0];
    const column = state.tables.find(t => t.name === tableName)?.columns[0]?.name || '';
    
    const filter: FilterCondition = {
      table: tableName,
      column,
      operator: '=',
      value: '',
      logicalOperator: 'AND'
    };
    
    setState(prev => ({
      ...prev,
      filterConditions: [...prev.filterConditions, filter]
    }));
  };

  // 更新过滤条件
  const handleUpdateFilter = (index: number, field: keyof FilterCondition, value: string) => {
    setState(prev => {
      const updated = [...prev.filterConditions];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, filterConditions: updated };
    });
  };

  // 移除过滤条件
  const handleRemoveFilter = (index: number) => {
    setState(prev => ({
      ...prev,
      filterConditions: prev.filterConditions.filter((_, i) => i !== index)
    }));
  };

  // 添加排序条件
  const handleAddSort = () => {
    if (state.selectedTables.length === 0) {
      message.warning('请先选择表');
      return;
    }
    
    const tableName = state.selectedTables[0];
    const column = state.tables.find(t => t.name === tableName)?.columns[0]?.name || '';
    
    const sort: SortCondition = {
      table: tableName,
      column,
      order: 'ASC'
    };
    
    setState(prev => ({
      ...prev,
      sortConditions: [...prev.sortConditions, sort]
    }));
  };

  // 更新排序条件
  const handleUpdateSort = (index: number, field: keyof SortCondition, value: string) => {
    setState(prev => {
      const updated = [...prev.sortConditions];
      updated[index] = { ...updated[index], [field]: value };
      return { ...prev, sortConditions: updated };
    });
  };

  // 移除排序条件
  const handleRemoveSort = (index: number) => {
    setState(prev => ({
      ...prev,
      sortConditions: prev.sortConditions.filter((_, i) => i !== index)
    }));
  };

  // 更新分页参数
  const handlePaginationChange = (field: 'limit' | 'offset', value: number) => {
    setState(prev => ({ ...prev, [field]: value }));
  };

  // 获取表的所有列
  const getTableColumns = (tableName: string): ColumnInfo[] => {
    const table = state.tables.find(t => t.name === tableName);
    return table?.columns || [];
  };

  // 执行查询
  const handleExecuteQuery = async () => {
    if (!state.generatedSql) {
      message.warning('请先构建SQL查询');
      return;
    }
    
    try {
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      
      const result = await ipcRenderer.invoke('execute-query', {
        connectionId,
        query: state.generatedSql
      });
      
      if (result.success) {
        // 将查询结果发送给查询面板或结果面板
        ipcRenderer.send('sql-builder-execute-result', { result, query: state.generatedSql });
        message.success('查询执行成功');
      } else {
        throw new Error(result.error || '查询执行失败');
      }
      
    } catch (error) {
      console.error('执行查询失败:', error);
      message.error((error as Error).message);
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  };

  // 复制SQL
  const handleCopySql = () => {
    if (!state.generatedSql) return;
    
    navigator.clipboard.writeText(state.generatedSql)
      .then(() => message.success('SQL已复制到剪贴板'))
      .catch(() => message.error('复制失败'));
  };

  // 重置查询构建器
  const handleReset = () => {
    setState({
      tables: state.tables,
      selectedTables: [],
      selectedColumns: [],
      joinConditions: [],
      filterConditions: [],
      sortConditions: [],
      groupByColumns: [],
      limit: 100,
      offset: 0,
      databaseType: state.databaseType,
      generatedSql: '',
      isLoading: false,
      error: null
    });
  };

  // 操作符选项
  const operatorOptions = [
    '=', '!=', '>', '>=', '<', '<=', 'LIKE', 'NOT LIKE',
    'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL'
  ];

  // 连接类型选项
  const joinTypeOptions = ['INNER', 'LEFT', 'RIGHT', 'FULL'];

  return (
    <div className="sql-builder-container">
      <div style={{ padding: '20px', borderBottom: '1px solid #e8e8e8', backgroundColor: '#f5f5f5' }}>
        <h2>SQL查询构建器</h2>
        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
          <Button 
            type="primary" 
            icon={<PlayCircleOutlined />} 
            onClick={handleExecuteQuery}
            loading={state.isLoading}
          >
            执行查询
          </Button>
          <Button 
            icon={<CopyOutlined />} 
            onClick={handleCopySql}
            disabled={!state.generatedSql}
          >
            复制SQL
          </Button>
          <Button 
            icon={<DeleteOutlined />} 
            onClick={handleReset}
          >
            重置
          </Button>
        </div>
      </div>

      {state.error && <div style={{ backgroundColor: '#f5222d', color: 'white', padding: '10px 20px', margin: '10px', borderRadius: '4px', fontSize: '14px' }}>{state.error}</div>}

      <div style={{ display: 'flex', height: 'calc(100vh - 200px)' }}>
        <div style={{ flex: 1, padding: '20px', overflowY: 'auto', borderRight: '1px solid #e8e8e8' }}>
          {/* 表选择区域 */}
          <div style={{ marginBottom: '24px', padding: '16px', borderRadius: '8px', border: '1px solid #e8e8e8', backgroundColor: '#fafafa' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#007BFF' }}>
              <DatabaseOutlined /> 选择表
            </h3>
            <div style={{ marginBottom: '16px' }}>
              <Select 
                mode="multiple" 
                placeholder="选择要查询的表"
                style={{ width: '100%' }}
                value={state.selectedTables}
                onChange={(values) => setState(prev => ({ ...prev, selectedTables: values }))}
              >
                {state.tables.map(table => (
                  <Option key={table.name} value={table.name}>
                    {table.schema ? `${table.schema}.${table.name}` : table.name}
                  </Option>
                ))}
              </Select>
            </div>
          </div>

          {/* 列选择区域 */}
          {state.selectedTables.length > 0 && (
            <div style={{ marginBottom: '24px', padding: '16px', borderRadius: '8px', border: '1px solid #e8e8e8', backgroundColor: '#fafafa' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#007BFF' }}>
                <ColumnWidthOutlined /> 选择列
              </h3>
              {state.selectedTables.map(tableName => (
                <div key={tableName} style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', fontWeight: '500', color: '#007BFF' }}>
                    <span>{tableName}</span>
                    <MinusOutlined onClick={() => handleRemoveTable(tableName)} />
                  </div>
                  <Select 
                    mode="multiple" 
                    style={{ width: '100%', marginBottom: 10 }}
                    placeholder={`选择${tableName}的列`}
                    value={state.selectedColumns
                      .filter(col => col.table === tableName)
                      .map(col => col.name)}
                    onChange={(values) => {
                      // 更新指定表的选中列
                      const otherColumns = state.selectedColumns.filter(col => col.table !== tableName);
                      const newColumns = values.map(colName => ({ table: tableName, name: colName }));
                      setState(prev => ({ ...prev, selectedColumns: [...otherColumns, ...newColumns] }));
                    }}
                  >
                    {getTableColumns(tableName).map(column => (
                      <Option key={column.name} value={column.name}>
                        {column.name} <Tag color="blue">{column.type}</Tag>
                      </Option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          )}

          {/* 连接条件区域 */}
          {state.selectedTables.length > 1 && (
            <div style={{ marginBottom: '24px', padding: '16px', borderRadius: '8px', border: '1px solid #e8e8e8', backgroundColor: '#fafafa' }}>
              <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#007BFF' }}>
                连接条件
              </h3>
              <Button 
                type="dashed" 
                icon={<PlusOutlined />} 
                onClick={handleAddJoin}
                style={{ width: '100%', marginBottom: 10 }}
              >
                添加连接
              </Button>
              {state.joinConditions.map((join, index) => (
                <div key={index} style={{ background: 'rgba(0, 123, 255, 0.05)', padding: '12px', borderRadius: '6px', marginBottom: '10px', borderLeft: '3px solid #007BFF' }}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '10px' }}>
                    <Select 
                      style={{ width: '25%' }}
                      value={join.joinType}
                      onChange={(value) => handleUpdateJoin(index, 'joinType', value)}
                    >
                      {joinTypeOptions.map(type => (
                        <Option key={type} value={type}>{type}</Option>
                      ))}
                    </Select>
                    <span style={{ margin: '0 10px' }}>JOIN</span>
                    <Select 
                      style={{ width: '20%' }}
                      value={join.targetTable}
                      onChange={(value) => handleUpdateJoin(index, 'targetTable', value)}
                    >
                      {state.selectedTables.filter(t => t !== join.sourceTable).map(table => (
                        <Option key={table} value={table}>{table}</Option>
                      ))}
                    </Select>
                    <MinusOutlined 
                      onClick={() => handleRemoveJoin(index)} 
                      style={{ color: '#ff4d4f', cursor: 'pointer', padding: '4px', borderRadius: '4px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: '8px', marginLeft: '10px', flexWrap: 'wrap', gap: '10px' }}>
                    <span>ON</span>
                    <Select 
                      style={{ width: '18%', marginLeft: '10px' }}
                      value={join.sourceTable}
                      onChange={(value) => handleUpdateJoin(index, 'sourceTable', value)}
                    >
                      {state.selectedTables.map(table => (
                        <Option key={table} value={table}>{table}</Option>
                      ))}
                    </Select>
                    <Select 
                      style={{ width: '20%' }}
                      value={join.sourceColumn}
                      onChange={(value) => handleUpdateJoin(index, 'sourceColumn', value)}
                    >
                      {getTableColumns(join.sourceTable).map(col => (
                        <Option key={col.name} value={col.name}>{col.name}</Option>
                      ))}
                    </Select>
                    <span style={{ margin: '0 10px' }}>=</span>
                    <Select 
                      style={{ width: '20%' }}
                      value={join.targetColumn}
                      onChange={(value) => handleUpdateJoin(index, 'targetColumn', value)}
                    >
                      {getTableColumns(join.targetTable).map(col => (
                        <Option key={col.name} value={col.name}>{col.name}</Option>
                      ))}
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 过滤条件区域 */}
          <div style={{ marginBottom: '24px', padding: '16px', borderRadius: '8px', border: '1px solid #e8e8e8', backgroundColor: '#fafafa' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#007BFF' }}>
              <FilterOutlined /> 过滤条件
            </h3>
            <Button 
              type="dashed" 
              icon={<PlusOutlined />} 
              onClick={handleAddFilter}
              style={{ width: '100%', marginBottom: 10 }}
            >
              添加过滤条件
            </Button>
            {state.filterConditions.map((filter, index) => (
              <div key={index} style={{ background: 'rgba(255, 193, 7, 0.05)', padding: '12px', borderRadius: '6px', marginBottom: '10px', borderLeft: '3px solid #ffc107' }}>
                {index > 0 && (
                  <Select 
                    style={{ width: '100px', marginBottom: '5px' }}
                    value={filter.logicalOperator}
                    onChange={(value) => handleUpdateFilter(index, 'logicalOperator', value as 'AND' | 'OR')}
                  >
                    <Option value="AND">AND</Option>
                    <Option value="OR">OR</Option>
                  </Select>
                )}
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                  <Select 
                    style={{ width: '150px' }}
                    value={filter.table}
                    onChange={(value) => handleUpdateFilter(index, 'table', value)}
                  >
                    {state.selectedTables.map(table => (
                      <Option key={table} value={table}>{table}</Option>
                    ))}
                  </Select>
                  <Select 
                    style={{ width: '150px', marginLeft: '10px' }}
                    value={filter.column}
                    onChange={(value) => handleUpdateFilter(index, 'column', value)}
                  >
                    {getTableColumns(filter.table).map(col => (
                      <Option key={col.name} value={col.name}>{col.name}</Option>
                    ))}
                  </Select>
                  <Select 
                    style={{ width: '120px', marginLeft: '10px' }}
                    value={filter.operator}
                    onChange={(value) => handleUpdateFilter(index, 'operator', value)}
                  >
                    {operatorOptions.map(operator => (
                      <Option key={operator} value={operator}>{operator}</Option>
                    ))}
                  </Select>
                  {(filter.operator !== 'IS NULL' && filter.operator !== 'IS NOT NULL') && (
                    <Input 
                      style={{ width: '200px', marginLeft: '10px' }}
                      value={filter.value}
                      onChange={(e) => handleUpdateFilter(index, 'value', e.target.value)}
                      placeholder={filter.operator.includes('IN') ? '输入逗号分隔的值列表' : '输入值'}
                    />
                  )}
                  <MinusOutlined 
                    onClick={() => handleRemoveFilter(index)} 
                    style={{ color: '#ff4d4f', cursor: 'pointer', padding: '4px', borderRadius: '4px' }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* 排序条件区域 */}
          <div style={{ marginBottom: '24px', padding: '16px', borderRadius: '8px', border: '1px solid #e8e8e8', backgroundColor: '#fafafa' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#007BFF' }}>
              <SortAscendingOutlined /> 排序条件
            </h3>
            <Button 
              type="dashed" 
              icon={<PlusOutlined />} 
              onClick={handleAddSort}
              style={{ width: '100%', marginBottom: 10 }}
            >
              添加排序条件
            </Button>
            {state.sortConditions.map((sort, index) => (
              <div key={index} style={{ background: 'rgba(40, 167, 69, 0.05)', padding: '12px', borderRadius: '6px', marginBottom: '10px', borderLeft: '3px solid #28a745', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <Select 
                  style={{ width: '150px' }}
                  value={sort.table}
                  onChange={(value) => handleUpdateSort(index, 'table', value)}
                >
                  {state.selectedTables.map(table => (
                    <Option key={table} value={table}>{table}</Option>
                  ))}
                </Select>
                <Select 
                  style={{ width: '150px', marginLeft: '10px' }}
                  value={sort.column}
                  onChange={(value) => handleUpdateSort(index, 'column', value)}
                >
                  {getTableColumns(sort.table).map(col => (
                    <Option key={col.name} value={col.name}>{col.name}</Option>
                  ))}
                </Select>
                <Select 
                  style={{ width: '100px', marginLeft: '10px' }}
                  value={sort.order}
                  onChange={(value) => handleUpdateSort(index, 'order', value as 'ASC' | 'DESC')}
                >
                  <Option value="ASC">
                    <SortAscendingOutlined /> ASC
                  </Option>
                  <Option value="DESC">
                    <SortDescendingOutlined /> DESC
                  </Option>
                </Select>
                <MinusOutlined 
                  onClick={() => handleRemoveSort(index)} 
                  style={{ cursor: 'pointer', color: '#ff4d4f' }}
                />
              </div>
            ))}
          </div>

          {/* 分页设置 */}
          <div style={{ marginBottom: '24px', padding: '16px', borderRadius: '8px', border: '1px solid #e8e8e8', backgroundColor: '#fafafa' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', fontWeight: '600', color: '#007BFF' }}>分页设置</h3>
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '100px' }}>
                <label>LIMIT:</label>
                <Input 
                  type="number" 
                  min="0" 
                  max="1000000" 
                  value={state.limit}
                  onChange={(e) => handlePaginationChange('limit', parseInt(e.target.value) || 0)}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', minWidth: '100px' }}>
                <label>OFFSET:</label>
                <Input 
                  type="number" 
                  min="0" 
                  value={state.offset}
                  onChange={(e) => handlePaginationChange('offset', parseInt(e.target.value) || 0)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 右侧SQL预览区域 */}
        <div style={{ flex: 1, padding: '20px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600', color: '#007BFF' }}>生成的SQL</h3>
            <div>
              <Tooltip title="复制SQL">
                <Button 
                  icon={<CopyOutlined />} 
                  size="small" 
                  onClick={handleCopySql}
                  disabled={!state.generatedSql}
                />
              </Tooltip>
              <Tooltip title="执行查询">
                <Button 
                  icon={<PlayCircleOutlined />} 
                  type="primary" 
                  size="small" 
                  onClick={handleExecuteQuery}
                  loading={state.isLoading}
                  style={{ marginLeft: '10px' }}
                />
              </Tooltip>
            </div>
          </div>
          <TextArea
            value={state.generatedSql}
            readOnly
            rows={20}
            style={{
              fontFamily: 'monospace',
              fontSize: '14px',
              lineHeight: 1.5,
              backgroundColor: '#f5f5f5',
              border: '1px solid #e8e8e8',
              resize: 'none'
            }}
          />
        </div>
      </div>
    </div>
  );
};