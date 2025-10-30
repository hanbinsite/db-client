import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Input, Space, message, Typography } from 'antd';
import { SearchOutlined, HistoryOutlined, ClearOutlined } from '@ant-design/icons';
import type { DatabaseConnection } from '../../types';
import { execRedisQueuedWithTimeout } from '../../utils/redis-exec-queue';

const { TextArea } = Input;
const { Text } = Typography;

interface Props {
  connection: DatabaseConnection;
  database: string; // e.g. 'db0'
  darkMode?: boolean;
}

interface CommandHistory {
  command: string;
  params: string;
  timestamp: number;
}

const RedisCliPage: React.FC<Props> = ({ connection, database }) => {
  const [input, setInput] = useState<string>('');
  const [terminalOutput, setTerminalOutput] = useState<Array<{type: 'command' | 'result' | 'error' | 'info', content: string}>>([]);
  const [history, setHistory] = useState<CommandHistory[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [loading, setLoading] = useState<boolean>(false);
  const [connected, setConnected] = useState<boolean>(true);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState<number>(-1);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const [showHistoryOverlay, setShowHistoryOverlay] = useState<boolean>(false);
  const maxHistorySize = 100;
  const poolId = connection?.connectionId;
  
  // Redis命令及其描述，用于语法提示
  const redisCommands: {[key: string]: string} = {
    'get': 'GET key - 获取存储在指定键的值',
    'set': 'SET key value [EX seconds|PX milliseconds] - 设置键值对',
    'del': 'DEL key [key ...] - 删除一个或多个键',
    'exists': 'EXISTS key [key ...] - 检查键是否存在',
    'incr': 'INCR key - 将键的值递增1',
    'decr': 'DECR key - 将键的值递减1',
    'expire': 'EXPIRE key seconds - 设置键的过期时间',
    'ttl': 'TTL key - 获取键的剩余过期时间',
    'hget': 'HGET key field - 获取哈希表中指定字段的值',
    'hset': 'HSET key field value [field value ...] - 设置哈希表字段的值',
    'hgetall': 'HGETALL key - 获取哈希表中所有字段和值',
    'hdel': 'HDEL key field [field ...] - 删除哈希表中一个或多个字段',
    'hlen': 'HLEN key - 获取哈希表中字段的数量',
    'lpush': 'LPUSH key value [value ...] - 将值插入到列表头部',
    'rpush': 'RPUSH key value [value ...] - 将值插入到列表尾部',
    'lpop': 'LPOP key - 移除并返回列表的第一个元素',
    'rpop': 'RPOP key - 移除并返回列表的最后一个元素',
    'llen': 'LLEN key - 获取列表长度',
    'lrange': 'LRANGE key start stop - 获取列表中指定范围的元素',
    'sadd': 'SADD key member [member ...] - 向集合添加一个或多个成员',
    'srem': 'SREM key member [member ...] - 从集合移除一个或多个成员',
    'smembers': 'SMEMBERS key - 返回集合中的所有成员',
    'sismember': 'SISMEMBER key member - 判断成员是否在集合中',
    'scard': 'SCARD key - 获取集合的成员数',
    'zadd': 'ZADD key score member [score member ...] - 向有序集合添加成员',
    'zrange': 'ZRANGE key start stop [WITHSCORES] - 获取有序集合指定范围的成员',
    'zrank': 'ZRANK key member - 获取成员在有序集合中的排名',
    'zrem': 'ZREM key member [member ...] - 移除有序集合中的成员',
    'zcard': 'ZCARD key - 获取有序集合的成员数',
    'info': 'INFO [section] - 获取Redis服务器的信息和统计',
    'config': 'CONFIG GET|SET parameter - 获取或设置Redis配置',
    'dbsize': 'DBSIZE - 返回当前数据库的键数量',
    'keys': 'KEYS pattern - 查找所有匹配给定模式的键',
    'flushdb': 'FLUSHDB - 清空当前数据库',
    'flushall': 'FLUSHALL - 清空所有数据库',
    'ping': 'PING - 测试连接',
    'auth': 'AUTH password - 验证密码',
    'select': 'SELECT index - 切换到指定数据库',
    'type': 'TYPE key - 返回键的类型',
    'renamenx': 'RENAMENX oldkey newkey - 仅当新键不存在时重命名键',
    'rename': 'RENAME oldkey newkey - 重命名键',
    'move': 'MOVE key db - 将键移动到另一个数据库',
    'persist': 'PERSIST key - 移除键的过期时间',
    'expireat': 'EXPIREAT key timestamp - 设置键的过期时间戳',
    'pexpire': 'PEXPIRE key milliseconds - 设置键的过期时间（毫秒）',
    'pexpireat': 'PEXPIREAT key ms-timestamp - 设置键的过期时间戳（毫秒）',
    'pttl': 'PTTL key - 获取键的剩余过期时间（毫秒）',
    'mget': 'MGET key [key ...] - 获取多个键的值',
    'mset': 'MSET key value [key value ...] - 设置多个键值对',
    'msetnx': 'MSETNX key value [key value ...] - 仅当键不存在时设置多个键值对',
    'setnx': 'SETNX key value - 仅当键不存在时设置键值对',
    'setex': 'SETEX key seconds value - 设置键值对并指定过期时间',
    'psetex': 'PSETEX key milliseconds value - 设置键值对并指定过期时间（毫秒）',
    'getset': 'GETSET key value - 设置键的值并返回旧值',
    'incrby': 'INCRBY key increment - 将键的值按指定增量递增',
    'incrbyfloat': 'INCRBYFLOAT key increment - 将键的值按指定浮点数递增',
    'decrby': 'DECRBY key decrement - 将键的值按指定减量递减',
    'append': 'APPEND key value - 向字符串追加值',
    'strlen': 'STRLEN key - 获取字符串的长度',
    'getrange': 'GETRANGE key start end - 获取字符串指定范围的子字符串',
    'setrange': 'SETRANGE key offset value - 用指定值覆盖字符串的一部分',
    'hincrby': 'HINCRBY key field increment - 将哈希表字段的值递增指定值',
    'hincrbyfloat': 'HINCRBYFLOAT key field increment - 将哈希表字段的值递增指定浮点数',
    'hkeys': 'HKEYS key - 获取哈希表中的所有字段',
    'hvals': 'HVALS key - 获取哈希表中的所有值',
    'hexists': 'HEXISTS key field - 检查哈希表中字段是否存在',
    'hmget': 'HMGET key field [field ...] - 获取哈希表中多个字段的值',
    'hmset': 'HMSET key field value [field value ...] - 设置哈希表中多个字段的值',
    'hstrlen': 'HSTRLEN key field - 获取哈希表字段值的长度',
    'lpushx': 'LPUSHX key value [value ...] - 仅当列表存在时将值插入到列表头部',
    'rpushx': 'RPUSHX key value [value ...] - 仅当列表存在时将值插入到列表尾部',
    'linsert': 'LINSERT key BEFORE|AFTER pivot value - 在列表中插入元素',
    'lset': 'LSET key index value - 设置列表中指定索引的值',
    'lrem': 'LREM key count value - 从列表中删除指定值的元素',
    'ltrim': 'LTRIM key start stop - 保留列表中指定范围的元素',
    'lindex': 'LINDEX key index - 获取列表中指定索引的元素',
    'lpops': 'LPOPS key [key ...] count - 从多个列表中弹出元素',
    'rpoplpush': 'RPOPLPUSH source destination - 从源列表弹出元素并推入目标列表',
    'blpop': 'BLPOP key [key ...] timeout - 从列表左侧阻塞弹出元素',
    'brpop': 'BRPOP key [key ...] timeout - 从列表右侧阻塞弹出元素',
    'brpoplpush': 'BRPOPLPUSH source destination timeout - 阻塞版本的RPOPLPUSH',
    'sinter': 'SINTER key [key ...] - 返回多个集合的交集',
    'sinterstore': 'SINTERSTORE destination key [key ...] - 将多个集合的交集存储到新集合',
    'sunion': 'SUNION key [key ...] - 返回多个集合的并集',
    'sunionstore': 'SUNIONSTORE destination key [key ...] - 将多个集合的并集存储到新集合',
    'sdiff': 'SDIFF key [key ...] - 返回多个集合的差集',
    'sdiffstore': 'SDIFFSTORE destination key [key ...] - 将多个集合的差集存储到新集合',
    'smove': 'SMOVE source destination member - 将成员从源集合移动到目标集合',
    'spop': 'SPOP key [count] - 移除并返回集合中的随机成员',
    'srandmember': 'SRANDMEMBER key [count] - 返回集合中的随机成员',
    'zincrby': 'ZINCRBY key increment member - 将有序集合成员的分数增加指定值',
    'zscore': 'ZSCORE key member - 获取有序集合中成员的分数',
    'zrevrange': 'ZREVRANGE key start stop [WITHSCORES] - 按分数从高到低获取有序集合成员',
    'zrevrank': 'ZREVRANK key member - 获取成员在有序集合中的排名（分数从高到低）',
    'zrevrangebyscore': 'ZREVRANGEBYSCORE key max min [WITHSCORES] [LIMIT offset count] - 按分数倒序获取有序集合成员',
    'zrangebyscore': 'ZRANGEBYSCORE key min max [WITHSCORES] [LIMIT offset count] - 按分数获取有序集合成员',
    'zcount': 'ZCOUNT key min max - 获取有序集合中分数在指定范围内的成员数',
    'zremember': 'ZREMEMBER key min max - 移除有序集合中分数在指定范围外的成员',
    'zremrangebyrank': 'ZREMRANGEBYRANK key start stop - 移除有序集合中指定排名范围的成员',
    'zremrangebyscore': 'ZREMRANGEBYSCORE key min max - 移除有序集合中分数在指定范围的成员',
    'zinterstore': 'ZINTERSTORE destination numkeys key [key ...] [WEIGHTS weight [weight ...]] [AGGREGATE SUM|MIN|MAX] - 计算多个有序集合的交集',
    'zunionstore': 'ZUNIONSTORE destination numkeys key [key ...] [WEIGHTS weight [weight ...]] [AGGREGATE SUM|MIN|MAX] - 计算多个有序集合的并集',
    'zlexcount': 'ZLEXCOUNT key min max - 计算有序集合中字典序在指定范围内的成员数',
    'zrangebylex': 'ZRANGEBYLEX key min max [LIMIT offset count] - 按字典序获取有序集合成员',
    'zrevrangebylex': 'ZREVRANGEBYLEX key max min [LIMIT offset count] - 按字典序倒序获取有序集合成员',
    'zremrangebylex': 'ZREMRANGEBYLEX key min max - 移除有序集合中字典序在指定范围的成员',
    'publish': 'PUBLISH channel message - 发布消息到指定频道',
    'subscribe': 'SUBSCRIBE channel [channel ...] - 订阅一个或多个频道',
    'unsubscribe': 'UNSUBSCRIBE [channel [channel ...]] - 退订一个或多个频道',
    'psubscribe': 'PSUBSCRIBE pattern [pattern ...] - 订阅一个或多个符合模式的频道',
    'punsubscribe': 'PUNSUBSCRIBE [pattern [pattern ...]] - 退订一个或多个符合模式的频道',
    'monitor': 'MONITOR - 实时监控服务器收到的命令',
    'debug': 'DEBUG OBJECT|SEGFAULT key - 调试相关命令',
    'client': 'CLIENT LIST|KILL|GETNAME|SETNAME|PAUSE|REPLY - 客户端相关命令',
    'slowlog': 'SLOWLOG subcommand [argument] - 慢查询日志相关命令',
    'eval': 'EVAL script numkeys key [key ...] arg [arg ...] - 执行Lua脚本',
    'evalsha': 'EVALSHA sha1 numkeys key [key ...] arg [arg ...] - 使用SHA1执行Lua脚本',
    'script': 'SCRIPT LOAD|EXISTS|FLUSH|KILL|DEBUG script - Lua脚本相关命令',
    'sync': 'SYNC - 用于复制功能的命令',
    'psync': 'PSYNC masterid offset - 部分重同步命令',
    'lastsave': 'LASTSAVE - 返回最近一次成功保存到磁盘的UNIX时间戳',
    'save': 'SAVE - 同步保存数据到磁盘',
    'bgsave': 'BGSAVE - 异步保存数据到磁盘',
    'bgrewriteaof': 'BGREWRITEAOF - 异步重写AOF文件',
    'shutdown': 'SHUTDOWN [NOSAVE|SAVE] - 关闭服务器',
    'slaveof': 'SLAVEOF host port - 设置从服务器',
    'role': 'ROLE - 返回实例的角色信息',
    'config resetstat': 'CONFIG RESETSTAT - 重置服务器统计信息',
    'config rewrite': 'CONFIG REWRITE - 将当前配置重写回配置文件',
    'module': 'MODULE LOAD|UNLOAD|LIST|HELP - 模块相关命令',
    'acl': 'ACL subcommand [argument] - 访问控制列表相关命令',
    'swapdb': 'SWAPDB index1 index2 - 交换两个数据库',
    'memory': 'MEMORY DOCTOR|USAGE|STATS|PUMP|Purge - 内存相关命令',
    'function': 'FUNCTION LOAD|LIST|DELETE|FLUSH|KILL|DEBUG - 函数相关命令'
  };

  // 获取所有命令名称
  const commonCommands = Object.keys(redisCommands);
  
  // 聚焦输入框并确保光标在末尾
  const focusInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      // 确保光标在文本末尾
      const length = inputRef.current.value.length;
      inputRef.current.setSelectionRange(length, length);
    }
  }, []);
  
  // 自动滚动到底部并定位光标
  const scrollToBottom = useCallback(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
      // 聚焦输入框并确保光标在末尾
      setTimeout(() => {
        focusInput();
      }, 0);
    }
  }, [focusInput]);
  
  useEffect(() => {
    // 页面加载时聚焦并定位光标
    setTimeout(() => {
      focusInput();
    }, 100);
  }, [focusInput]);
  
  useEffect(() => {
    // 数据库切换时添加信息提示
    setTerminalOutput(prev => [...prev, {
      type: 'info',
      content: `切换到数据库: ${database}`
    }]);
    ensureDb().catch(err => {
      setTerminalOutput(prev => [...prev, {
        type: 'error',
        content: `数据库切换失败: ${err.message || '未知错误'}`
      }]);
    });
  }, [database]);
  
  useEffect(() => {
    // 当输出更新时，滚动到底部并定位光标
    scrollToBottom();
  }, [terminalOutput, scrollToBottom]);
  
  // 确保选择了正确的数据库
  const ensureDb = async () => {
    try {
      if (!poolId) throw new Error('连接未准备好');
      const m = String(database).match(/db(\d+)/i);
      const dbIndex = m ? parseInt(m[1], 10) : (Number(database) || 0);
      await execRedisQueuedWithTimeout(poolId, 'select', [String(dbIndex)], 3000);
    } catch (err) {
      throw err;
    }
  };
  
  // 解析完整的命令行输入为命令和参数
  const parseCommandLine = (line: string): {command: string, params: string[]} => {
    const parts = line.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const params = parts.slice(1);
    return { command, params };
  };
  
  // 处理命令执行
  const handleExecute = async () => {
    const inputLine = input.trim();
    if (!inputLine) return;
    
    // 添加到历史记录
    const { command, params } = parseCommandLine(inputLine);
    setHistory(prev => {
      const newHistory = [
        { command, params: params.join(' '), timestamp: Date.now() },
        ...prev.filter(h => !(h.command === command && h.params === params.join(' ')))
      ].slice(0, maxHistorySize);
      return newHistory;
    });
    setHistoryIndex(-1);
    
    // 清空输入框
    setInput('');
    
    // 在终端中显示命令
    setTerminalOutput(prev => [...prev, {
      type: 'command',
      content: `redis> ${inputLine}`
    }]);
    
    // 命令执行后滚动到底部并定位光标
    setTimeout(() => {
      scrollToBottom();
    }, 0);
    
    try {
      setLoading(true);
      if (!poolId) throw new Error('连接未准备好');
      
      await ensureDb();
      const res = await execRedisQueuedWithTimeout(poolId, command, params, 30000);
      
      if (res && res.success) {
        let resultText: string;
        
        if (res.data === null) {
          resultText = '(nil)';
        } else if (Array.isArray(res.data)) {
          if (res.data.length === 0) {
            resultText = '(empty array)';
          } else if (res.data.every((item: any) => typeof item === 'string')) {
            // 格式化数组输出，模仿Redis CLI
            resultText = res.data.map((item: string, index: number) => `(${index + 1}) "${item}"`).join('\n');
          } else {
            resultText = JSON.stringify(res.data, null, 2);
          }
        } else if (typeof res.data === 'object') {
          // 格式化对象输出
          const entries = Object.entries(res.data);
          if (entries.length === 0) {
            resultText = '(empty hash)';
          } else {
            resultText = entries.map(([key, value]) => `"${key}" => "${value}"`).join('\n');
          }
        } else {
          resultText = String(res.data);
        }
        
        setTerminalOutput(prev => [...prev, {
          type: 'result',
          content: resultText
        }]);
      } else {
        throw new Error(res?.error || '执行失败');
      }
    } catch (e: any) {
      setTerminalOutput(prev => [...prev, {
        type: 'error',
        content: `错误: ${e?.message || '执行异常'}`
      }]);
    } finally {
      setLoading(false);
      focusInput();
    }
  };
  
  // 获取当前输入行中的命令部分
  const getCurrentCommandPart = (input: string): string => {
    // 如果输入包含空格，取第一个空格前的部分作为命令
    const parts = input.trim().split(/\s+/);
    return parts[0].toLowerCase();
  };

  // 根据输入过滤匹配的命令
  const filterCommands = (input: string): string[] => {
    const trimmedInput = input.trim();
    // 如果输入为空或包含空格，不显示建议
    if (!trimmedInput || trimmedInput.includes(' ')) {
      return [];
    }
    
    const commandPart = trimmedInput.toLowerCase();
    return commonCommands.filter(cmd => cmd.startsWith(commandPart));
  };

  // 处理输入变化，更新提示
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newInput = e.target.value;
    setInput(newInput);
    
    const filtered = filterCommands(newInput);
    if (filtered.length > 0) {
      setSuggestions(filtered);
      setShowSuggestions(true);
      setSelectedSuggestion(0);
    } else {
      setShowSuggestions(false);
      setSelectedSuggestion(-1);
    }
  };

  // 选择提示的命令
  const selectSuggestion = (command: string) => {
    setInput(command + ' ');
    setShowSuggestions(false);
    setSelectedSuggestion(-1);
    focusInput();
  };

  // 处理键盘事件
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions) {
      if (e.key === 'Tab') {
        e.preventDefault();
        if (selectedSuggestion >= 0 && selectedSuggestion < suggestions.length) {
          selectSuggestion(suggestions[selectedSuggestion]);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        setSelectedSuggestion(-1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (suggestions.length > 0) {
          setSelectedSuggestion(prev => 
            prev <= 0 ? suggestions.length - 1 : prev - 1
          );
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (suggestions.length > 0) {
          setSelectedSuggestion(prev => 
            prev >= suggestions.length - 1 ? 0 : prev + 1
          );
        }
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (selectedSuggestion >= 0 && selectedSuggestion < suggestions.length) {
          // 如果有选中的建议，先选择建议而不是直接执行
          selectSuggestion(suggestions[selectedSuggestion]);
        } else {
          // 没有选中的建议时才执行命令
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
    return `${connection.host}:${connection.port} | DB: ${database}`;
  };
  
  // 渲染终端行
  const renderTerminalLine = (line: {type: string, content: string}, index: number) => {
    let style: React.CSSProperties = {};
    
    switch (line.type) {
      case 'command':
        style = { color: '#58A6FF' }; // Xshell7命令蓝色
        break;
      case 'result':
        style = { color: '#F0F6FC' }; // Xshell7结果白色
        break;
      case 'error':
        style = { color: '#F85149' }; // Xshell7错误红色
        break;
      case 'info':
        style = { color: '#3FB950' }; // Xshell7信息绿色
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
      backgroundColor: '#0D1117', // Xshell7深色背景
      fontFamily: 'Consolas, Monaco, "Courier New", monospace',
      fontSize: '14px',
      borderRadius: '0',
      overflow: 'hidden',
      border: '1px solid #30363D',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)'
    }}>
      {/* 标题栏 - 模仿Xshell7 */}
      <div style={{
        backgroundColor: '#161B22', // Xshell7标题栏颜色
        padding: '7px 15px',
        borderBottom: '1px solid #30363D',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ color: '#F0F6FC', fontWeight: 'bold', fontSize: '13px' }}>
          Redis CLI - {connection?.name || '连接'}
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
        <div style={{ color: '#3FB950', marginBottom: '10px' }}>欢迎使用DB-CLIENT命令工具。</div>
        {terminalOutput.map(renderTerminalLine)}
        
        {/* 命令提示符和输入区域 */}
          <div style={{ display: 'flex', alignItems: 'flex-start', position: 'relative' }}>
            <Text style={{ color: '#569CD6', marginRight: '8px' }}>redis&gt;</Text>
            <TextArea
              ref={inputRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              autoSize={{ minRows: 1, maxRows: 5 }}
              placeholder="输入Redis命令..."
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
              className="redis-cli-input"
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
                        {redisCommands[cmd]?.split(' - ')[0] || ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
      </div>
      
      {/* 状态栏 - 模仿Xshell7 */}
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

export default RedisCliPage;