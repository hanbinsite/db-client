import React, { useState, useRef, useEffect, useCallback } from 'react';
import { message, Space } from 'antd';
import { ClearOutlined, HistoryOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import { Input } from 'antd';

const { Text } = Typography;
const { TextArea } = Input;
import type { DatabaseConnection } from '../../types';

interface Props {
  connection: DatabaseConnection;
  database: string;
  darkMode?: boolean;
  onDatabaseChange?: (database: string) => void;
}

interface TerminalLine {
  type: 'command' | 'result' | 'error' | 'info';
  content: string;
}

interface CommandHistory {
  command: string;
  params: string;
  timestamp: number;
}

// MySQL常用命令提示字典
const mysqlCommands: Record<string, string> = {
  // 数据定义语言(DDL)
  'CREATE': '创建数据库对象',
  'ALTER': '修改数据库对象',
  'DROP': '删除数据库对象',
  'TRUNCATE': '清空表数据',
  'RENAME': '重命名数据库对象',
  
  // 数据操作语言(DML)
  'SELECT': '查询数据',
  'INSERT': '插入数据',
  'UPDATE': '更新数据',
  'DELETE': '删除数据',
  'REPLACE': '替换数据',
  
  // 数据控制语言(DCL)
  'GRANT': '授予权限',
  'REVOKE': '撤销权限',
  'COMMIT': '提交事务',
  'ROLLBACK': '回滚事务',
  'SAVEPOINT': '设置保存点',
  
  // 事务控制
  'SET': '设置系统变量',
  'START': '开始事务',
  'BEGIN': '开始事务',
  'LOCK': '锁定表',
  'UNLOCK': '解锁表',
  
  // 实用命令
  'USE': '选择数据库',
  'SHOW': '显示数据库信息',
  'DESCRIBE': '描述表结构',
  'EXPLAIN': '解释查询执行计划',
  'HELP': '获取帮助信息',
  'QUIT': '退出MySQL',
  'EXIT': '退出MySQL',
  'STATUS': '显示连接状态',
  
  // 常用SHOW子命令
  'SHOW DATABASES': '列出所有数据库',
  'SHOW TABLES': '列出当前数据库中的所有表',
  'SHOW COLUMNS': '显示表的列信息',
  'SHOW INDEX': '显示表的索引信息',
  'SHOW PROCESSLIST': '显示当前服务器进程',
  'SHOW VARIABLES': '显示系统变量',
  'SHOW STATUS': '显示服务器状态',
  'SHOW GRANTS': '显示用户权限',
  'SHOW ERRORS': '显示错误信息',
  'SHOW WARNINGS': '显示警告信息',
  
  // 常用函数
  'SELECT * FROM': '查询表中所有数据',
  'COUNT': '计算行数',
  'SUM': '求和',
  'AVG': '平均值',
  'MAX': '最大值',
  'MIN': '最小值',
  'NOW': '当前日期时间',
  'DATE': '日期函数',
  'TIME': '时间函数',
  'CONCAT': '连接字符串',
  'SUBSTRING': '子字符串',
  'UPPER': '转换大写',
  'LOWER': '转换小写',
  'LENGTH': '字符串长度',
  
  // 其他常用命令
  'SET NAMES': '设置字符集',
  'ANALYZE': '分析表',
  'OPTIMIZE': '优化表',
  'CHECK': '检查表',
  'REPAIR': '修复表',
  'FLUSH': '刷新缓存',
  'KILL': '终止进程',
  'INSTALL': '安装插件',
  'UNINSTALL': '卸载插件',
  
  // 事务隔离级别
  'READ UNCOMMITTED': '读未提交',
  'READ COMMITTED': '读已提交',
  'REPEATABLE READ': '可重复读',
  'SERIALIZABLE': '串行化'
};

// 提取所有命令名称作为公共命令列表
const commonCommands = Object.keys(mysqlCommands);

const MySqlCliPage: React.FC<Props> = ({ connection, database, darkMode = false, onDatabaseChange }) => {
  const [input, setInput] = useState('');
  const [terminalOutput, setTerminalOutput] = useState<TerminalLine[]>([]);
  const [history, setHistory] = useState<CommandHistory[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(connection?.isConnected || false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const [showHistoryOverlay, setShowHistoryOverlay] = useState(false);
  // 内部保存当前选中的数据库，用于正确执行USE命令后的查询
  const [currentDatabase, setCurrentDatabase] = useState(database || '');
  
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  // 新增：切库中的状态，避免父组件旧值回写与本页的预切库造成竞争
  const isSwitchingDbRef = useRef(false);
  // 新增：避免并发执行命令造成会话竞争
  const isExecutingRef = useRef(false);
  // 新增：当用户在CLI中手动切库时，暂时锁定本页的会话库所有权，阻止父组件覆盖
  const cliOwnsSessionRef = useRef(false);
  // 新增：是否向父组件传播CLI页面的数据库切换（默认关闭，避免其他面板触发刷新）
  const propagateCliDbChange = false;
  
  // 规范化数据库名：去掉末尾分号与包裹引号/反引号
  const normalizeDatabaseName = useCallback((raw: string) => {
    let name = (raw || '').trim();
    // 去掉结尾的分号与空格
    name = name.replace(/;+\s*$/g, '');
    // 如果以相同的引号或反引号包裹，去掉包裹
    if (name.length >= 2) {
      const first = name[0];
      const last = name[name.length - 1];
      if ((first === '`' || first === '"' || first === '\'') && last === first) {
        name = name.substring(1, name.length - 1);
      }
    }
    return name;
  }, []);
  // 对数据库名进行反引号安全包裹（转义内部反引号）
  const quoteDbIdent = useCallback((name: string) => {
    const safe = (name || '').replace(/`/g, '``');
    return `\`${safe}\``;
  }, []);
  // 验证当前会话的数据库（从服务器侧返回），并同步到状态栏
  const verifyActiveDatabase = useCallback(async (poolId: string, expected?: string) => {
    try {
      const res = await window.electronAPI.executeQuery(poolId, 'SELECT DATABASE() AS db');
      const rows = Array.isArray(res?.data) ? res.data : [];
      const actual = rows?.[0]?.db ?? rows?.[0]?.DB ?? rows?.[0]?.Database;
      if (typeof actual === 'string') {
        setCurrentDatabase(actual);
        if (expected && actual !== expected) {
          const warnLine: TerminalLine = {
            type: 'error',
            content: `警告: 期望切换到 ${expected}，但实际会话数据库为 ${actual}`
          };
          setTerminalOutput(prev => [...prev, warnLine]);
        }
        return actual;
      }
    } catch {}
    return undefined;
  }, [setCurrentDatabase]);
  // 输入框聚焦并将光标定位到最新一行
  const focusInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      
      // 安全地尝试设置光标位置，使用类型保护
      try {
        // 使用类型断言来安全地访问 setSelectionRange 方法
        const inputElement = inputRef.current as HTMLTextAreaElement & { setSelectionRange?: Function };
        
        // 检查方法是否存在
        if (typeof inputElement.setSelectionRange === 'function') {
          const value = (inputElement.value || '') as string;
          const length = value.length;
          inputElement.setSelectionRange(length, length);
        }
      } catch (error) {
        // 忽略光标设置错误，确保至少输入框获得了焦点
        console.log('光标定位失败，但输入框已聚焦');
      }
    }
  }, []);
  
  // 滚动终端到底部
  const scrollToBottom = useCallback(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, []);
  
  // 监听连接状态变化
  useEffect(() => {
    if (connection) {
      setConnected(connection.isConnected || false);
      // 连接改变时显示信息
      if (connection.isConnected) {
        const infoLine: TerminalLine = {
          type: 'info',
          content: `已连接到 ${connection.host}:${connection.port} | 数据库: ${database}`
        };
        setTerminalOutput(prev => [...prev, infoLine]);
      }
    }
  }, [connection, database]);
  
  // 监听数据库变化，更新内部数据库状态
  useEffect(() => {
    if (!database) return;
    // 避免在本页正在执行手动切库或锁定期时被父组件旧值覆盖
    if (isSwitchingDbRef.current || cliOwnsSessionRef.current) return;
    setCurrentDatabase(database);
  }, [database]);
  
  // 页面加载时聚焦输入框
  useEffect(() => {
    focusInput();
  }, [focusInput]);
  
  // 当终端输出更新时，滚动到底部
  useEffect(() => {
    scrollToBottom();
  }, [terminalOutput, scrollToBottom]);
  
  // 解析命令行
  const parseCommandLine = (line: string): { command: string; params: string } => {
    const parts = line.trim().split(/\s+/);
    if (parts.length === 0 || !parts[0]) {
      return { command: '', params: '' };
    }
    
    const command = parts[0].toUpperCase(); // MySQL命令通常大写
    const params = parts.slice(1).join(' ');
    
    return { command, params };
  };
  
  // 执行MySQL命令
  const handleExecute = async () => {
    if (isExecutingRef.current) {
      setTerminalOutput(prev => [...prev, { type: 'info', content: '上一条命令尚未完成，请稍后再试...' } as TerminalLine]);
      return;
    }
    isExecutingRef.current = true; // 开始执行，防止并发
      const commandLine = input.trim();
      if (!commandLine) return;
      
      const { command, params } = parseCommandLine(commandLine);
      
      // 添加到历史记录
      const historyItem: CommandHistory = {
        command,
        params,
        timestamp: Date.now()
      };
      setHistory(prev => [historyItem, ...prev].slice(0, 100)); // 保留最近100条历史
      setHistoryIndex(-1);
      
      // 清空输入
      setInput('');
      
      // 在终端显示命令
      const commandLineOutput: TerminalLine = {
        type: 'command',
        content: `mysql> ${commandLine}`
      };
      setTerminalOutput(prev => [...prev, commandLineOutput]);
      
      // 检查连接
      if (!connection || !connection.isConnected) {
        const errorLine: TerminalLine = {
          type: 'error',
          content: '错误: 未连接到MySQL服务器'
        };
        setTerminalOutput(prev => [...prev, errorLine]);
        return;
      }
      
      setLoading(true);
      
      try {
        const poolId = connection.connectionId || connection.id;
        if (!poolId) {
          throw new Error('连接池ID不存在');
        }
        
        // 特殊处理USE命令，更新当前数据库
        let sqlToExecute = commandLine;
        if (command === 'USE' && params) {
          // 解析并规范化数据库名
          const dbName = normalizeDatabaseName(params);
          // 标记切库过程开始，避免其他地方用旧值覆盖
          isSwitchingDbRef.current = true;
          cliOwnsSessionRef.current = true; // 锁定本页会话库所有权

          // 原子化执行：在同一连接、同一队列任务中顺序执行 USE + SELECT DATABASE() 用于验证
          const queries = [
            { query: `USE ${quoteDbIdent(dbName)}` },
            { query: 'SELECT DATABASE() AS db' }
          ];
          const batchRes = await window.electronAPI.executeBatch(poolId, queries);
          // 切库结束，短暂保留锁定期以吸收异步回写
          isSwitchingDbRef.current = false;
          setTimeout(() => { cliOwnsSessionRef.current = false; }, 1500);

          if (!batchRes || !batchRes.success) {
            const errorLine: TerminalLine = {
              type: 'error',
              content: `切换数据库失败: ${batchRes?.message || '未知错误'}`
            };
            setTerminalOutput(prev => [...prev, errorLine]);
            return;
          }
          const verify = batchRes.results[batchRes.results.length - 1];
          const actual = Array.isArray(verify?.data) && verify.data[0] ? (verify.data[0]['db'] || verify.data[0]['DATABASE()'] || verify.data[0][Object.keys(verify.data[0])[0]]) : undefined;
          if (actual && actual === dbName) {
            // 切库成功后才更新本地状态
            setCurrentDatabase(dbName);
            // 可选：向父组件传播变更（默认关闭，避免其他面板触发刷新与竞争）
            if (propagateCliDbChange && onDatabaseChange) {
              onDatabaseChange(dbName);
            }
            const resultLine: TerminalLine = {
              type: 'result',
              content: `数据库已切换到 ${dbName}`
            };
            setTerminalOutput(prev => [...prev, resultLine]);
          } else {
            // 切库未成功，保持或同步为实际会话库
            if (typeof actual === 'string') {
              setCurrentDatabase(actual);
              const warnLine: TerminalLine = {
                type: 'info',
                content: `警告: 期望切换到 ${dbName}，但实际会话数据库为 ${actual}`
              };
              setTerminalOutput(prev => [...prev, warnLine]);
            } else {
              const warnLine: TerminalLine = {
                type: 'info',
                content: `警告: 切库后无法验证当前库，可能被其他面板重置。`
              };
              setTerminalOutput(prev => [...prev, warnLine]);
            }
          }
        } else if (command === 'HELP' || command === '\\?') {
          // 处理HELP命令
          const helpContent = `MySQL命令行帮助:\n` +
                          `- SHOW DATABASES; 列出所有数据库\n` +
                          `- USE database_name; 切换数据库\n` +
                          `- SHOW TABLES; 列出当前数据库中的表\n` +
                          `- DESCRIBE table_name; 显示表结构\n` +
                          `- SELECT * FROM table_name; 查询表数据\n` +
                          `- INSERT INTO table_name VALUES (...); 插入数据\n` +
                          `- UPDATE table_name SET ...; 更新数据\n` +
                          `- DELETE FROM table_name WHERE ...; 删除数据\n` +
                          `- EXIT 或 QUIT; 退出MySQL`;
          const helpLine: TerminalLine = {
            type: 'info',
            content: helpContent
          };
          setTerminalOutput(prev => [...prev, helpLine]);
        } else if (command === 'EXIT' || command === 'QUIT' || command === '\q') {
          // 处理退出命令
          const exitLine: TerminalLine = {
            type: 'info',
            content: 'Bye!'
          };
          setTerminalOutput(prev => [...prev, exitLine]);
        } else {
          // 执行SQL查询：不再在每次查询前隐式执行 USE，避免与其他面板切换数据库造成冲突
          // 在存在当前库的情况下，将 SHOW TABLES 重写为显式指定数据库，消除会话上下文依赖
          if (command === 'SHOW' && /^SHOW\s+TABLES\b/i.test(sqlToExecute) && currentDatabase) {
            sqlToExecute = `SHOW TABLES FROM ${quoteDbIdent(currentDatabase)}`;
          }
          // 优先使用批量原子化：在同一连接中先 USE 当前库再执行查询，避免会话被并发重置
          let result: any;
          if (currentDatabase) {
            const queries = [
              { query: `USE ${quoteDbIdent(currentDatabase)}` },
              { query: sqlToExecute }
            ];
            const batchRes = await window.electronAPI.executeBatch(poolId, queries);
            if (!batchRes || !batchRes.success) {
              const errorLine: TerminalLine = {
                type: 'error',
                content: `ERROR ${batchRes?.message || '批量执行失败'}`
              };
              setTerminalOutput(prev => [...prev, errorLine]);
              return;
            }
            result = batchRes.results[batchRes.results.length - 1];
          } else {
            // 无当前库时直接执行
            result = await window.electronAPI.executeQuery(poolId, sqlToExecute);
          }
          
          if (result && result.success) {
            let resultContent = '';
            
            // 检查是否为SELECT查询结果（即使是空结果集）
            if (result.data && Array.isArray(result.data)) {
              const rows = result.data;
              
              // 获取列信息
              let columns: string[] = [];
              if (result.columns && result.columns.length > 0) {
                columns = result.columns;
              } else if (rows.length > 0) {
                columns = Object.keys(rows[0]);
              }
              
              // 特殊处理数据库列表和表列表，让每个数据库/表名单独显示一行
              // 检测是否为数据库列表或表列表（通常只有一列，列名包含'Database'或'Tables_in'）
              const isDatabaseOrTableList = columns.length === 1 && 
                                           (columns[0].includes('Database') || 
                                            columns[0].includes('Tables_in'));
              
              if (isDatabaseOrTableList) {
                // 显示列名 - 使用\r\n确保Windows系统上正确换行
                resultContent += columns[0] + '\r\n';
                resultContent += '-'.repeat(columns[0].length) + '\r\n';
                
                // 每个数据库/表名单独显示一行
                rows.forEach((row: Record<string, any>) => {
                  const value = row[columns[0]];
                  const valueStr = value === null ? 'NULL' : 
                                 (typeof value === 'object' ? JSON.stringify(value) : String(value));
                  resultContent += valueStr + '\r\n';
                });
                resultContent += '\r\n';
              } else if (columns.length > 0) {
                // 对于普通查询结果，使用表格格式显示
                // 计算每列的最大宽度
                const columnWidths = columns.map(col => col.length);
                
                // 计算数据行中每列的最大宽度
                rows.forEach((row: Record<string, any>) => {
                  columns.forEach((col, index) => {
                    const value = row[col];
                    const valueStr = value === null ? 'NULL' : 
                                   (typeof value === 'object' ? JSON.stringify(value) : String(value));
                    columnWidths[index] = Math.max(columnWidths[index], valueStr.length);
                  });
                });
                
                // 生成表格顶部边框
                resultContent += '+';
                columnWidths.forEach(width => {
                  resultContent += '-'.repeat(width + 2) + '+';
                });
                resultContent += '\r\n';
                
                // 生成表头行
                resultContent += '|';
                columns.forEach((col, index) => {
                  resultContent += ` ${col.padEnd(columnWidths[index])} |`;
                });
                resultContent += '\r\n';
                
                // 生成分隔线
                resultContent += '+';
                columnWidths.forEach(width => {
                  resultContent += '-'.repeat(width + 2) + '+';
                });
                resultContent += '\r\n';
                
                // 生成数据行
                rows.forEach((row: Record<string, any>) => {
                  resultContent += '|';
                  columns.forEach((col, index) => {
                    const value = row[col];
                    const valueStr = value === null ? 'NULL' : 
                                   (typeof value === 'object' ? JSON.stringify(value) : String(value));
                    resultContent += ` ${valueStr.padEnd(columnWidths[index])} |`;
                  });
                  resultContent += '\r\n';
                });
                
                // 生成表格底部边框
                resultContent += '+';
                columnWidths.forEach(width => {
                  resultContent += '-'.repeat(width + 2) + '+';
                });
                resultContent += '\r\n';
                
                // 在表之间增加换行，使结果更易于阅读
                resultContent += '\r\n';
              }
              
              // 打印总行数 - 使用\r\n确保Windows系统上正确换行
              resultContent += `\r\n${rows.length} row${rows.length !== 1 ? 's' : ''} in set (${result.executionTime || 0} ms)`;
            } else if (result.rowCount !== undefined) {
              // 对于非查询语句，显示受影响的行数
              resultContent = `Query OK, ${result.rowCount} row${result.rowCount !== 1 ? 's' : ''} affected (${result.executionTime || 0} ms)`;
            } else {
              // 其他情况
              resultContent = 'Query OK';
            }
            
            const resultLine: TerminalLine = {
              type: 'result',
              content: resultContent
            };
            setTerminalOutput(prev => [...prev, resultLine]);
          } else {
            const errorLine: TerminalLine = {
              type: 'error',
              content: `ERROR ${result?.error || '未知错误'}`
            };
            setTerminalOutput(prev => [...prev, errorLine]);
          }
        }
      } catch (error) {
        const errorLine: TerminalLine = {
          type: 'error',
          content: `ERROR ${(error as Error)?.message || '未知错误'}`
        };
        setTerminalOutput(prev => [...prev, errorLine]);
      } finally {
        isExecutingRef.current = false; // 允许下一条命令执行
        setLoading(false);
        // 使用setTimeout确保DOM更新完成后再聚焦，避免React状态更新的异步问题
        setTimeout(() => {
          focusInput();
        }, 0);
      }
    };
    
    // 获取当前命令部分（用于提示）
    const getCurrentCommandPart = () => {
      const trimmedInput = input.trim();
      // 如果输入为空或以空格结尾，则返回空字符串
      if (!trimmedInput || trimmedInput.endsWith(' ')) {
        return '';
      }
      
      // 获取最后一个空格后的部分作为当前命令部分
      const parts = trimmedInput.split(/\s+/);
      return parts[parts.length - 1].toUpperCase();
    };
    
    // 过滤命令提示
    const filterCommands = (input: string) => {
      if (!input) {
        return commonCommands;
      }
      
      const inputUpper = input.toUpperCase();
      return commonCommands.filter(cmd => 
        cmd.toUpperCase().startsWith(inputUpper)
      );
    };
    
    // 处理输入变化
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      setInput(newValue);
      
      // 更新命令提示
      const commandPart = getCurrentCommandPart();
      const filtered = filterCommands(commandPart);
      
      if (filtered.length > 0) {
        setSuggestions(filtered);
        setShowSuggestions(true);
        setSelectedSuggestion(-1);
      } else {
        setShowSuggestions(false);
        setSuggestions([]);
      }
    };
    
    // 选择命令提示
    const selectSuggestion = (suggestion: string) => {
      const trimmedInput = input.trim();
      const parts = trimmedInput.split(/\s+/);
      
      let newInput = '';
      if (parts.length > 1) {
        // 替换最后一个部分
        const newParts = [...parts];
        newParts[newParts.length - 1] = suggestion;
        newInput = newParts.join(' ') + ' ';
      } else {
        // 如果只有一个部分或没有部分，直接使用建议
        newInput = suggestion + ' ';
      }
      
      setInput(newInput);
      setShowSuggestions(false);
      focusInput();
    };
    
    // 处理键盘事件
    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showSuggestions && suggestions.length > 0) {
        // 处理方向键选择提示
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedSuggestion(prev => 
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedSuggestion(prev => 
            prev <= 0 ? suggestions.length - 1 : prev - 1
          );
        } else if (e.key === 'Tab') {
          e.preventDefault();
          if (selectedSuggestion >= 0) {
            selectSuggestion(suggestions[selectedSuggestion]);
          } else if (suggestions.length > 0) {
            selectSuggestion(suggestions[0]);
          }
        } else if (e.key === 'Escape') {
          setShowSuggestions(false);
          setSelectedSuggestion(-1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (selectedSuggestion >= 0 && selectedSuggestion < suggestions.length) {
            selectSuggestion(suggestions[selectedSuggestion]);
          } else {
            setShowSuggestions(false);
            handleExecute();
          }
        }
      } else {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleExecute();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (history.length > 0) {
            setHistoryIndex(prev => {
              const newIndex = prev < history.length - 1 ? prev + 1 : 0;
              const histItem = history[newIndex];
              setInput(`${histItem.command} ${histItem.params}`.trim());
              return newIndex;
            });
          }
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (history.length > 0) {
            setHistoryIndex(prev => {
              if (prev <= 0) {
                setInput('');
                return -1;
              }
              const newIndex = prev - 1;
              const histItem = history[newIndex];
              setInput(`${histItem.command} ${histItem.params}`.trim());
              return newIndex;
            });
          }
        }
      }
    };
    
    // 处理点击其他区域关闭提示
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (suggestionsRef.current && !suggestionsRef.current.contains(event.target as Node) &&
            inputRef.current && !inputRef.current.contains(event.target as Node)) {
          setShowSuggestions(false);
          setSelectedSuggestion(-1);
        }
        if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
          setShowHistoryOverlay(false);
        }
      };
    
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }, []);
    
    // 历史面板控制与工具函数
    const toggleHistory = () => {
      setShowHistoryOverlay(prev => !prev);
    };
    const formatTime = (ts: number) => {
      try {
        return new Date(ts).toLocaleTimeString();
      } catch {
        return '';
      }
    };
    const pickHistory = (h: CommandHistory) => {
      setInput(`${h.command} ${h.params}`.trim());
      setShowHistoryOverlay(false);
      focusInput();
    };
    
    // 清空终端输出
    const clearTerminal = () => {
      setTerminalOutput([]);
      focusInput();
    };
    
    // 获取连接状态信息
    const getConnectionInfo = () => {
      if (!connection) return '未连接';
      return `${connection.host}:${connection.port} | DB: ${currentDatabase || database || ''}`;
    };
    
    // 渲染终端行
    const renderTerminalLine = (line: TerminalLine, index: number) => {
      let style: React.CSSProperties = {
        whiteSpace: 'pre-wrap', // 保留换行符和空格
        wordBreak: 'break-all'  // 确保长文本能够换行
      };
      
      switch (line.type) {
        case 'command':
          style.color = '#58A6FF'; // 命令蓝色
          break;
        case 'result':
          style.color = '#F0F6FC'; // 结果白色
          break;
        case 'error':
          style.color = '#F85149'; // 错误红色
          break;
        case 'info':
          style.color = '#3FB950'; // 信息绿色
          break;
      }
      
      return (
        <div key={index} style={style}>
          {line.content}
        </div>
      );
    };
  
    return (
      <div style={{ 
        height: 'calc(100vh - 180px)', 
        display: 'flex', 
        flexDirection: 'column',
        backgroundColor: '#0D1117', // 深色背景
        fontFamily: 'Consolas, Monaco, "Courier New", monospace',
        fontSize: '14px',
        borderRadius: '0',
        overflow: 'hidden',
        border: '1px solid #30363D',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
      }}>
        {/* 标题栏 */}
        <div style={{
          backgroundColor: '#161B22', // 标题栏颜色
          padding: '7px 15px',
          borderBottom: '1px solid #30363D',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ color: '#F0F6FC', fontWeight: 'bold', fontSize: '13px' }}>
            MySQL CLI - {connection?.name || '连接'}
          </div>
          <Space size="small">
            <div style={{ color: connected ? '#3FB950' : '#F85149', fontSize: '12px' }}>
              {connected ? '已连接' : '未连接'}
            </div>
          </Space>
        </div>
        
        {/* 终端输出区域 */}
        <div 
          ref={terminalRef}
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '15px',
            backgroundColor: '#0D1117',
            lineHeight: '1.4'
          }}
        >
          <div style={{ color: '#3FB950', marginBottom: '10px' }}>欢迎使用DB-CLIENT MySQL命令行工具。</div>
          {terminalOutput.map(renderTerminalLine)}
          
          {/* 命令提示符和输入区域 */}
            <div style={{ display: 'flex', alignItems: 'flex-start', position: 'relative' }}>
              <Text style={{ color: '#569CD6', marginRight: '8px' }}>mysql&gt;</Text>
              <TextArea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                autoSize={{ minRows: 1, maxRows: 5 }}
                placeholder="输入MySQL命令（如: SHOW DATABASES;）..."
                style={{
                  flex: 1,
                  backgroundColor: 'transparent',
                  border: 'none',
                  outline: 'none',
                  boxShadow: 'none',
                  color: '#F0F6FC',
                  padding: 0,
                  margin: 0,
                  resize: 'none',
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  fontSize: '14px'
                }}
                disabled={loading}
                className="mysql-cli-input"
              />
              
              {/* 命令提示框 */}
              {showSuggestions && suggestions.length > 0 && (
                <div
                  ref={suggestionsRef}
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: '45px', // 与提示符对齐
                    right: 0,
                    backgroundColor: '#161B22',
                    border: '1px solid #30363D',
                    borderRadius: '4px',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    zIndex: 1000,
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)'
                  }}
                >
                  {suggestions.map((cmd, index) => {
                    const isSelected = index === selectedSuggestion;
                    return (
                      <div
                        key={cmd}
                        style={{
                          padding: '8px 12px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          backgroundColor: isSelected ? '#21262D' : 'transparent',
                          color: isSelected ? '#58A6FF' : '#F0F6FC',
                          borderLeft: isSelected ? '3px solid #58A6FF' : '3px solid transparent',
                          transition: 'all 0.2s ease',
                          fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                          fontSize: '13px'
                        }}
                        onClick={() => selectSuggestion(cmd)}
                        onMouseEnter={() => setSelectedSuggestion(index)}
                      >
                        <span style={{ fontWeight: 'bold' }}>{cmd}</span>
                        <span style={{ fontSize: '11px', color: '#8B949E', marginLeft: '10px', flex: 1, textAlign: 'right' }}>
                          {mysqlCommands[cmd] || ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
        </div>
        
        {/* 状态栏 */}
        <div style={{
          backgroundColor: '#161B22',
          padding: '5px 15px',
          borderTop: '1px solid #30363D',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '12px',
          color: '#8B949E',
          position: 'relative'
        }}>
          <div>{getConnectionInfo()}</div>
          <Space size="small">
            <button 
              onClick={clearTerminal}
              style={{
                background: 'none',
                border: 'none',
                color: '#8B949E',
                cursor: 'pointer',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                padding: '3px 8px',
                borderRadius: '3px',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#21262D';
                e.currentTarget.style.color = '#F0F6FC';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#8B949E';
              }}
            >
              <ClearOutlined style={{ marginRight: '2px', fontSize: '12px' }} />
              清空
            </button>
            <button 
              onClick={toggleHistory}
              style={{
                background: 'none',
                border: 'none',
                color: '#8B949E',
                cursor: 'pointer',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                padding: '3px 8px',
                borderRadius: '3px',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = '#21262D';
                e.currentTarget.style.color = '#F0F6FC';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = '#8B949E';
              }}
            >
              <HistoryOutlined style={{ marginRight: '2px', fontSize: '12px' }} />
              历史
            </button>
          </Space>
          {showHistoryOverlay && (
            <div
              ref={historyRef}
              style={{
                position: 'absolute',
                right: '15px',
                bottom: '32px',
                width: '280px',
                maxHeight: '240px',
                overflowY: 'auto',
                backgroundColor: '#161B22',
                border: '1px solid #30363D',
                borderRadius: '4px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
                zIndex: 1000
              }}
            >
              {history.length === 0 ? (
                <div style={{ padding: '8px 10px', color: '#8B949E' }}>暂无历史</div>
              ) : (
                history.map((h, i) => (
                  <div
                    key={`${h.timestamp}-${i}`}
                    style={{
                      padding: '8px 10px',
                      cursor: 'pointer',
                      color: '#F0F6FC',
                      borderBottom: '1px solid #21262D'
                    }}
                    onClick={() => pickHistory(h)}
                  >
                    <div style={{ fontSize: '11px', color: '#8B949E' }}>{formatTime(h.timestamp)}</div>
                    <div style={{
                      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}>
                      {h.command} {h.params}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    );
};

export default MySqlCliPage;