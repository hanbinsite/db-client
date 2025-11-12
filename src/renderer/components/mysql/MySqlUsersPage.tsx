import React, { useState, useEffect } from 'react';
import { Card, Table, Empty, Typography, Spin, Tag, Button, Modal, Form, Input, Checkbox, message, Space, Popconfirm, Select, TreeSelect } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { DatabaseConnection } from '../../types';
import { getDbUtils } from '../../utils/db';
import type { MySqlDbUtils } from '../../utils/db/mysql';
import './MySqlUsersPage.css';
import { PlusOutlined, EditOutlined, DeleteOutlined, KeyOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;
const { Option } = Select;

interface MySqlUsersPageProps {
  connection: DatabaseConnection;
  database: string;
  darkMode?: boolean;
}

interface UserData {
  key: string;
  username: string;
  host: string;
  privileges: string;
  password?: string;
  created?: string;
  max_connections?: number;
}

interface Privilege {
  name: string;
  description: string;
  category: string;
}

interface DatabasePrivilege {
  database: string;
  privileges: string[];
}

interface DatabaseInfo {
  name: string;
  tables?: string[];
}

const MySqlUsersPage: React.FC<MySqlUsersPageProps> = ({ connection, database, darkMode }) => {
  const [userData, setUserData] = useState<UserData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddModalVisible, setIsAddModalVisible] = useState<boolean>(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState<boolean>(false);
  const [isPrivilegeModalVisible, setIsPrivilegeModalVisible] = useState<boolean>(false);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [form] = Form.useForm();
  const [privilegeForm] = Form.useForm(); // 专门用于权限编辑的表单实例
  const [privileges, setPrivileges] = useState<Privilege[]>([]);
  const [selectedPrivileges, setSelectedPrivileges] = useState<string[]>([]);
  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [selectedDatabase, setSelectedDatabase] = useState<string>('*'); // 默认选择所有数据库
  const [serverPrivileges, setServerPrivileges] = useState<string[]>([]);
  const [databasePrivileges, setDatabasePrivileges] = useState<DatabasePrivilege[]>([]);
  const [userDatabasePrivileges, setUserDatabasePrivileges] = useState<DatabasePrivilege[]>([]); // 用户拥有权限的数据库列表
  const [isServerPrivilegeMode, setIsServerPrivilegeMode] = useState<boolean>(false);
  const [showPrivilegeList, setShowPrivilegeList] = useState<boolean>(false); // 是否显示具体权限列表
  const [currentEditDatabase, setCurrentEditDatabase] = useState<string | null>(null); // 当前编辑的数据库
  const [isDeleting, setIsDeleting] = useState(false); // 删除权限的加载状态
  const [isSaving, setIsSaving] = useState(false); // 保存权限的加载状态
  const [originalPrivileges, setOriginalPrivileges] = useState<string[]>([]); // 原始权限，用于比较变化
  const [availableDatabases, setAvailableDatabases] = useState<string[]>([]); // 可用数据库列表，用于添加权限时选择

  // 获取用户列表
  const fetchUsers = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const dbUtils = getDbUtils('mysql') as MySqlDbUtils;
        const users = await dbUtils.getUsers(connection);
        
        if (users.length > 0) {
          const formattedUsers: UserData[] = users.map((user, index) => ({
            key: `${user.user}@${user.host}`,
            username: user.user,
            host: user.host,
            privileges: user.privileges || '无权限',
          }));
          setUserData(formattedUsers);
        }
      } catch (err) {
        console.error('获取MySQL用户信息失败:', err);
        setError('获取用户信息失败，请检查连接权限');
      } finally {
      setLoading(false);
    }
  };
  
  // 获取数据库列表
  const fetchDatabases = async () => {
    try {
      const dbUtils = getDbUtils('mysql') as MySqlDbUtils;
      const dbItems = await dbUtils.getDatabases(connection);
      const formattedDatabases = dbItems.map(dbItem => ({ name: dbItem.name }));
      setDatabases(formattedDatabases);
    } catch (err) {
      console.error('获取数据库列表失败:', err);
      message.error('获取数据库列表失败');
    }
  };
  
  // 加载可用数据库列表（用于权限选择）
  const loadAvailableDatabases = async () => {
    try {
      // 使用已有的databases状态，如果为空则重新获取
      if (databases.length === 0) {
        await fetchDatabases();
      }
      
      // 过滤掉系统数据库，只显示用户数据库
      const userDatabases = databases
        .map(db => db.name)
        .filter(db => !['information_schema', 'mysql', 'performance_schema', 'sys'].includes(db));
      
      setAvailableDatabases(userDatabases);
    } catch (err) {
      console.error('加载权限选择数据库列表失败:', err);
      // 作为备选方案，直接查询数据库
      try {
        const poolId = connection.connectionId || connection.id;
        const result = await window.electronAPI.executeQuery(poolId, 
          "SHOW DATABASES WHERE `Database` NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')"
        );
        const databases = result.rows.map((row: any) => row.Database);
        setAvailableDatabases(databases);
      } catch (fallbackErr) {
        console.error('备选方案获取数据库失败:', fallbackErr);
        message.error('加载数据库列表失败');
      }
    }
  };
  
  // 获取用户在指定数据库上的权限
  const fetchDatabasePrivileges = async (username: string, host: string, database: string) => {
    console.log(`=== 开始获取权限: username=${username}, host=${host}, database=${database} ===`);
    try {
      const poolId = connection.connectionId || connection.id;
      console.log(`连接池ID: ${poolId}`);
      
      // 关键改进：对于服务器权限，直接查询mysql.user表获取更准确的权限信息
      if (database === '*') {
        console.log('处理服务器级别权限查询');
        // 先尝试直接查询mysql.user表
        const serverPrivilegesSql = `SELECT * FROM mysql.user WHERE user = '${username}' AND host = '${host}'`;
        try {
          console.log(`执行SQL查询: ${serverPrivilegesSql}`);
          const userResult = await window.electronAPI.executeQuery(poolId, serverPrivilegesSql);
          
          console.log('查询结果:', JSON.stringify(userResult));
          if (userResult && userResult.success && Array.isArray(userResult.data) && userResult.data.length > 0) {
            const userRow = userResult.data[0];
            console.log('用户行数据中权限字段:', JSON.stringify(Object.keys(userRow).filter(key => key.endsWith('_priv') || key.endsWith('_PRIV'))));
            const privilegesSet = new Set<string>();
            const allDefinedPrivileges = getMysqlPrivileges().map(p => p.name);
            console.log('定义的所有权限:', JSON.stringify(allDefinedPrivileges));
            
            // 直接检查用户表中的权限字段
            allDefinedPrivileges.forEach(privilege => {
              console.log(`检查权限: ${privilege}`);
              // 特殊处理ALL权限
              if (privilege === 'ALL') {
                // 检查Super_priv是否为Y，作为ALL权限的判断依据
                console.log(`检查ALL权限 - Super_priv=${userRow['Super_priv']}, SUPER_PRIV=${userRow['SUPER_PRIV']}`);
                if (userRow['Super_priv'] === 'Y' || userRow['SUPER_PRIV'] === 'Y') {
                  privilegesSet.add('ALL');
                  console.log('添加ALL权限');
                }
              } else {
                // 将权限名转换为mysql.user表中的字段名格式
                const fieldNameBase = privilege.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
                // 尝试多种可能的字段名格式，增加更多变体以确保CREATE等权限能被正确识别
                const possibleFieldNames = [
                  fieldNameBase + '_priv',
                  fieldNameBase.toLowerCase() + '_priv',
                  fieldNameBase.toUpperCase() + '_priv',
                  privilege.toUpperCase() + '_PRIV',
                  privilege.toLowerCase() + '_priv',
                  // 为CREATE权限添加特定的字段名变体
                  privilege.toUpperCase() + '_priv',
                  // 增加额外的常见格式
                  privilege.toUpperCase() + '_PRIVILEGE',
                  privilege.toLowerCase() + '_privilege'
                ];
                
                console.log(`尝试的字段名格式: ${JSON.stringify(possibleFieldNames)}`);
                // 检查是否有任何一个可能的字段名存在且值为Y
                let found = false;
                for (const fieldName of possibleFieldNames) {
                  if (fieldName in userRow) {
                    console.log(`字段 ${fieldName} 存在，值: ${userRow[fieldName]}`);
                    if (userRow[fieldName] === 'Y') {
                      privilegesSet.add(privilege);
                      console.log(`添加权限 ${privilege}`);
                      found = true;
                      break;
                    }
                  }
                }
                if (!found) {
                  console.log(`权限 ${privilege} 的所有字段名都不存在或值不为Y`);
                }
              }
            });
            
            console.log(`从用户表获取的原始权限集合: ${JSON.stringify(Array.from(privilegesSet))}`);
            
            // 处理权限列表，应用与checkbox组件中相同的宽松匹配逻辑
            const allPrivileges = getMysqlPrivileges();
            console.log('用于匹配的所有权限:', JSON.stringify(allPrivileges.map(p => p.name)));
            
            const matchedPrivileges = allPrivileges
              .map(privilege => privilege.name)
              .filter(itemName => {
                console.log(`匹配检查项: ${itemName}`);
                // 检查是否有权限匹配
                const matched = Array.from(privilegesSet).some(priv => {
                  console.log(`  与权限 ${priv} 比较`);
                  // 1. 如果是ALL权限，匹配所有权限
                  if (priv.toUpperCase() === 'ALL') {
                    console.log(`  匹配成功: ALL权限`);
                    return true;
                  }
                  // 2. 检查权限名称的包含关系，双向匹配
                  const privUpper = priv.toUpperCase();
                  const itemNameUpper = itemName.toUpperCase();
                  const exactMatch = privUpper === itemNameUpper;
                  const privIncludesItem = privUpper.includes(itemNameUpper);
                  const itemIncludesPriv = itemNameUpper.includes(privUpper);
                  console.log(`  精确匹配: ${exactMatch}, priv包含item: ${privIncludesItem}, item包含priv: ${itemIncludesPriv}`);
                  
                  const matchResult = exactMatch || privIncludesItem || itemIncludesPriv;
                  if (matchResult) {
                    console.log(`  匹配成功: ${priv} 匹配 ${itemName}`);
                  }
                  return matchResult;
                });
                console.log(`  最终匹配结果: ${matched}`);
                return matched;
              });
            
            console.log('数据库匹配后的权限列表:', JSON.stringify(matchedPrivileges));
            console.log('权限列表长度:', matchedPrivileges.length);
            setSelectedPrivileges(matchedPrivileges);
            console.log('=== 权限获取完成，返回匹配的权限列表 ===');
            return matchedPrivileges;
          }
        } catch (userErr) {
          console.error('查询mysql.user表失败，将回退到SHOW GRANTS方式:', userErr);
        }
      }
      
      // 回退方案：使用SHOW GRANTS查询
      console.log('使用SHOW GRANTS方式查询权限');
      // 修复SQL语法错误：移除LIKE子句，SHOW GRANTS不支持直接使用LIKE
      const sql = `SHOW GRANTS FOR '${username}'@'${host}'`;
      
      console.log(`执行SHOW GRANTS查询: ${sql}`);
      const result = await window.electronAPI.executeQuery(poolId, sql);
      console.log('SHOW GRANTS查询结果:', JSON.stringify(result));
      const privilegesSet = new Set<string>();
      const allDefinedPrivileges = getMysqlPrivileges().map(p => p.name);
      console.log('定义的所有权限:', JSON.stringify(allDefinedPrivileges));
      
      if (result && result.success && Array.isArray(result.data)) {
        console.log(`处理 ${result.data.length} 条权限记录`);
        result.data.forEach((row: any, index: number) => {
          console.log(`处理第 ${index + 1} 条记录:`, JSON.stringify(row));
          const grantKey = Object.keys(row).find(key => key.toLowerCase().includes('grant'));
          if (grantKey) {
            console.log(`找到GRANT关键字段: ${grantKey}`);
            const grantStr = row[grantKey] as string;
            console.log(`GRANT语句: ${grantStr}`);
            
            // 关键修复：添加数据库名称过滤，只处理与当前数据库相关的权限
            let isRelevantGrant = false;
            if (database === '*') {
              // 服务器级别权限，检查是否为全局权限 (ON *.*)
              isRelevantGrant = grantStr.toUpperCase().includes('ON *.*');
            } else {
              // 数据库级别权限，检查是否匹配当前数据库
              // 支持两种格式：`db_name`.* 和 db_name.*
              const dbPattern1 = `ON \`${database}\`.*`;
              const dbPattern2 = `ON ${database}.*`;
              isRelevantGrant = grantStr.toUpperCase().includes(dbPattern1.toUpperCase()) || 
                              grantStr.toUpperCase().includes(dbPattern2.toUpperCase());
            }
            
            console.log(`数据库过滤 - 当前数据库: ${database}, 是否相关: ${isRelevantGrant}`);
            
            if (isRelevantGrant) {
              // 检查ALL权限
              if (grantStr.toUpperCase().includes('ALL PRIVILEGES') || grantStr.toUpperCase().includes('ALL')) {
                console.log('检测到ALL/ALL PRIVILEGES权限');
                privilegesSet.add('ALL');
              }
              
              // 对每个预定义的权限进行宽松匹配
              allDefinedPrivileges.forEach(privilege => {
                if (privilege === 'ALL') return; // 已经处理过
                
                console.log(`检查权限: ${privilege}`);
                // 优先检查精确匹配
                if (grantStr.toUpperCase().includes(privilege.toUpperCase())) {
                  console.log(`  精确匹配成功，添加权限: ${privilege}`);
                  privilegesSet.add(privilege);
                  return;
                }
                
                // 如果没有精确匹配，尝试单词级匹配
                const words = privilege.split(/\s+/);
                console.log(`  单词分解: ${JSON.stringify(words)}`);
                const allWordsFound = words.every(word => {
                  const found = grantStr.toUpperCase().includes(word.toUpperCase());
                  console.log(`    检查单词: ${word} - 找到: ${found}`);
                  return found;
                });
                
                if (allWordsFound) {
                  console.log(`  单词级匹配成功，添加权限: ${privilege}`);
                  privilegesSet.add(privilege);
                } else {
                  console.log(`  未找到权限: ${privilege}`);
                }
              });
            } else {
              console.log(`跳过不相关的权限记录: ${grantStr}`);
            }
          } else {
            console.log('未找到包含grant的字段');
          }
        });
      } else {
        console.log('SHOW GRANTS查询结果为空或格式不正确');
      }
      console.log(`从SHOW GRANTS获取的原始权限集合: ${JSON.stringify(Array.from(privilegesSet))}`);
      
      // 处理权限列表，应用与checkbox组件中相同的宽松匹配逻辑
      const allPrivileges = getMysqlPrivileges();
      console.log('用于匹配的所有权限:', JSON.stringify(allPrivileges.map(p => p.name)));
      
      const matchedPrivileges = allPrivileges
        .map(privilege => privilege.name)
        .filter(itemName => {
          console.log(`SHOW GRANTS方式匹配检查项: ${itemName}`);
          // 检查是否有权限匹配
          const matched = Array.from(privilegesSet).some(priv => {
            console.log(`  与权限 ${priv} 比较`);
            // 1. 如果是ALL权限，匹配所有权限
            if (priv.toUpperCase() === 'ALL') {
              console.log(`  匹配成功: ALL权限`);
              return true;
            }
            // 2. 检查权限名称的包含关系，双向匹配
            const privUpper = priv.toUpperCase();
            const itemNameUpper = itemName.toUpperCase();
            const exactMatch = privUpper === itemNameUpper;
            const privIncludesItem = privUpper.includes(itemNameUpper);
            const itemIncludesPriv = itemNameUpper.includes(privUpper);
            console.log(`  精确匹配: ${exactMatch}, priv包含item: ${privIncludesItem}, item包含priv: ${itemIncludesPriv}`);
            
            const matchResult = exactMatch || privIncludesItem || itemIncludesPriv;
            if (matchResult) {
              console.log(`  匹配成功: ${priv} 匹配 ${itemName}`);
            }
            return matchResult;
          });
          console.log(`  最终匹配结果: ${matched}`);
          return matched;
        });
      
      console.log('数据库匹配后的权限列表:', JSON.stringify(matchedPrivileges));
      console.log('权限列表长度:', matchedPrivileges.length);
      setSelectedPrivileges(matchedPrivileges);
      console.log('=== 权限获取完成，返回匹配的权限列表 ===');
      return matchedPrivileges;
    } catch (err) {
      console.error(`获取用户在数据库 ${database} 上的权限失败:`, err);
      setSelectedPrivileges([]);
      console.log('=== 权限获取失败，返回空列表 ===');
      return [];
    }
  };
  
  // 获取用户的服务器级别权限
  const fetchServerPrivileges = async (username: string, host: string) => {
    console.log(`获取服务器权限 - 用户名: ${username}, 主机: ${host}`);
    const privileges = await fetchDatabasePrivileges(username, host, '*');
    console.log(`服务器权限获取完成，权限列表:`, privileges);
    return privileges;
  };

  useEffect(() => {
    fetchUsers();
    fetchDatabases();
  }, [connection]);
  
  useEffect(() => {
    // 当选择的数据库改变时，重新加载该数据库的权限
    if (selectedUser && !isServerPrivilegeMode) {
      loadDatabasePrivileges();
    }
  }, [selectedDatabase, selectedUser, isServerPrivilegeMode]);

  // 数据库级别权限更新功能将在后续实现

  // 处理新增用户
  const handleAddUser = async (values: any) => {
    try {
      const dbUtils = getDbUtils('mysql') as MySqlDbUtils;
      await dbUtils.createUser(connection, values.username, values.host, values.password);
      message.success('用户创建成功');
        setIsAddModalVisible(false);
        form.resetFields();
        fetchUsers();
    } catch (err) {
      console.error('创建用户失败:', err);
      message.error('创建用户失败，请检查权限');
    }
  };

  // 处理编辑用户
  const handleEditUser = async (values: any) => {
    if (!selectedUser) return;
    
    try {
      const dbUtils = getDbUtils('mysql') as MySqlDbUtils;
      
      // 如果主机发生变化，需要先创建新用户再删除旧用户
      if (values.host && values.host !== selectedUser.host) {
        // 创建新用户
        await dbUtils.createUser(connection, selectedUser.username, values.host, values.password);
        // 复制权限（如果有）
        if (selectedUser.privileges && selectedUser.privileges !== '权限信息') {
          const privileges = selectedUser.privileges.split(',').map(p => p.trim()).filter(p => p);
          await dbUtils.updateUserPrivileges(connection, selectedUser.username, values.host, privileges);
        }
        // 删除旧用户
        await dbUtils.deleteUser(connection, selectedUser.username, selectedUser.host);
      } else if (values.password) {
        // 只更新密码
        await dbUtils.updateUser(connection, selectedUser.username, selectedUser.host, values.password);
      }
      message.success('用户更新成功');
        setIsEditModalVisible(false);
        form.resetFields();
        fetchUsers();
    } catch (err) {
      console.error('更新用户失败:', err);
      message.error('更新用户失败，请检查权限');
    }
  };

  // 处理删除用户
  const handleDeleteUser = async (user: UserData) => {
    try {
      const dbUtils = getDbUtils('mysql') as MySqlDbUtils;
      await dbUtils.deleteUser(connection, user.username, user.host);
      message.success('用户删除成功');
        fetchUsers();
    } catch (err) {
      console.error('删除用户失败:', err);
      message.error('删除用户失败，请检查权限');
    }
  };

  // 数据库级别权限分类
  const getMysqlPrivileges = (): Privilege[] => {
    return [
      { name: 'SELECT', description: '允许从表中查询数据', category: '数据操作' },
      { name: 'INSERT', description: '允许向表中插入数据', category: '数据操作' },
      { name: 'UPDATE', description: '允许更新表中的数据', category: '数据操作' },
      { name: 'DELETE', description: '允许删除表中的数据', category: '数据操作' },
      { name: 'CREATE', description: '允许创建数据库和表', category: '结构管理' },
      { name: 'DROP', description: '允许删除数据库和表', category: '结构管理' },
      { name: 'ALTER', description: '允许修改表结构', category: '结构管理' },
      { name: 'INDEX', description: '允许创建和删除索引', category: '结构管理' },
      { name: 'REFERENCES', description: '允许创建外键约束', category: '结构管理' },
      { name: 'CREATE USER', description: '允许创建新用户', category: '用户管理' },
      { name: 'DROP USER', description: '允许删除用户', category: '用户管理' },
      { name: 'RELOAD', description: '允许使用FLUSH命令', category: '服务器管理' },
      { name: 'SHUTDOWN', description: '允许关闭MySQL服务器', category: '服务器管理' },
      { name: 'PROCESS', description: '允许查看所有进程', category: '服务器管理' },
      { name: 'FILE', description: '允许在服务器上读写文件', category: '服务器管理' },
      { name: 'GRANT OPTION', description: '允许授予他人权限', category: '权限管理' },
      { name: 'REFERENCES', description: '允许创建外键', category: '数据约束' },
      { name: 'ALL', description: '所有权限', category: '全部权限' },
      { name: 'SUPER', description: '超级用户权限', category: '全部权限' }
    ];
  };

  // 加载数据库权限
  const loadDatabasePrivileges = async () => {
    if (!selectedUser) return;
    
    try {
      const privilegesList = await fetchDatabasePrivileges(selectedUser.username, selectedUser.host, selectedDatabase);
      setSelectedPrivileges(privilegesList);
    } catch (err) {
      console.error('加载数据库权限失败:', err);
      setSelectedPrivileges([]);
    }
  };
  
  // 获取用户对所有数据库的权限
  const fetchUserDatabasePrivileges = async (username: string, host: string) => {
    try {
      const poolId = connection.connectionId || connection.id;
      const sql = `SHOW GRANTS FOR '${username}'@'${host}'`;
      const result = await window.electronAPI.executeQuery(poolId, sql);
      
      const privilegeMap = new Map<string, Set<string>>();
      const allDefinedPrivileges = getMysqlPrivileges().map(p => p.name);
      
      if (result && result.success && Array.isArray(result.data)) {
        result.data.forEach((row: any) => {
          const grantKey = Object.keys(row).find(key => key.toLowerCase().includes('grant'));
          if (grantKey) {
            const grantStr = row[grantKey] as string;
            // 提取数据库名
            const dbMatch = grantStr.match(/ON\s+`?([^`\\.]+)`?\.`?([^`]+)?`?/i);
            if (dbMatch) {
              const database = dbMatch[1];
              if (!privilegeMap.has(database)) {
                privilegeMap.set(database, new Set<string>());
              }
              
              // 检查ALL权限
              if (grantStr.toUpperCase().includes('ALL PRIVILEGES') || grantStr.toUpperCase().includes('ALL')) {
                privilegeMap.get(database)?.add('ALL');
              }
              
              // 匹配具体权限
              allDefinedPrivileges.forEach(privilege => {
                if (privilege === 'ALL') return;
                if (grantStr.toUpperCase().includes(privilege.toUpperCase())) {
                  privilegeMap.get(database)?.add(privilege);
                }
              });
            }
          }
        });
      }
      
      // 转换为数组格式
      const privilegesArray: DatabasePrivilege[] = Array.from(privilegeMap.entries())
        .map(([database, privileges]) => ({
          database,
          privileges: Array.from(privileges)
        }));
      
      return privilegesArray;
    } catch (err) {
      console.error('获取用户数据库权限失败:', err);
      return [];
    }
  };
  
  // 加载服务器权限
  const loadServerPrivileges = async () => {
    if (!selectedUser) return;
    
    try {
      console.log(`开始加载服务器权限，选中用户:`, selectedUser);
      const privilegesList = await fetchServerPrivileges(selectedUser.username, selectedUser.host);
      console.log(`设置服务器权限状态:`, privilegesList);
      setServerPrivileges(privilegesList);
    } catch (err) {
      console.error('加载服务器权限失败:', err);
      setServerPrivileges([]);
    }
  };
  
  // 处理权限变更
  const handlePrivilegeChange = async () => {
    if (!selectedUser) return;
    
    try {
      const dbUtils = getDbUtils('mysql') as MySqlDbUtils;
      const poolId = connection.connectionId || connection.id;
      
      if (isServerPrivilegeMode) {
        // 服务器级别权限 - 使用现有的updateUserPrivileges方法
        await dbUtils.updateUserPrivileges(connection, selectedUser.username, selectedUser.host, serverPrivileges);
      } else {
        // 数据库级别权限 - 手动执行GRANT/REVOKE语句
        
        // 先撤销该数据库上的所有权限
        await window.electronAPI.executeQuery(poolId, 
          `REVOKE ALL PRIVILEGES ON ${selectedDatabase}.* FROM '${selectedUser.username}'@'${selectedUser.host}'`);
        
        // 如果有权限需要授予
        if (selectedPrivileges.length > 0) {
          const privilegesStr = selectedPrivileges.join(', ');
          await window.electronAPI.executeQuery(poolId, 
            `GRANT ${privilegesStr} ON ${selectedDatabase}.* TO '${selectedUser.username}'@'${selectedUser.host}'`);
        }
        
        // 刷新权限
        await window.electronAPI.executeQuery(poolId, 'FLUSH PRIVILEGES');
      }
      
      message.success('权限更新成功');
      setIsPrivilegeModalVisible(false);
      fetchUsers();
    } catch (err) {
      console.error('更新权限失败:', err);
      message.error('更新权限失败，请检查权限');
    }
  };

  // 处理数据库权限选择变化
  const onPrivilegeChange = (checkedValues: string[]) => {
    setSelectedPrivileges(checkedValues);
  };
  
  // 处理服务器权限选择变化
  const onServerPrivilegeChange = (checkedValues: string[]) => {
    setServerPrivileges(checkedValues);
  };

  const columns: ColumnsType<UserData> = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      width: 150,
      render: (text) => <Text strong>{text}</Text>,
    },
    {
      title: '主机',
      dataIndex: 'host',
      key: 'host',
      width: 150,
      render: (text) => (
        <Tag color="processing" className="text-xs">
          {text}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created',
      key: 'created',
      width: 180,
      render: (text) => <Text type="secondary">{text || '-'}</Text>,
    },
    {
      title: '最大连接数',
      dataIndex: 'max_connections',
      key: 'max_connections',
      width: 120,
      render: (text) => <Text>{text || '无限制'}</Text>,
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      fixed: 'right',
      render: (_, record) => (
        <Space size="middle">
          <Button 
            type="link" 
            icon={<KeyOutlined />} 
            onClick={async () => {
              setSelectedUser(record);
              setSelectedRowKeys([record.key]);
              // 只在首次需要时获取权限列表，避免重复设置
              if (privileges.length === 0) {
                setPrivileges(getMysqlPrivileges());
              }
              setIsServerPrivilegeMode(false);
              setSelectedDatabase('*'); // 默认选择所有数据库
              
              // 先加载用户所有数据库权限，再显示弹窗
              try {
                setShowPrivilegeList(false);
                setCurrentEditDatabase(null);
                // 获取用户对所有数据库的权限
                const userPrivileges = await fetchUserDatabasePrivileges(record.username, record.host);
                setUserDatabasePrivileges(userPrivileges);
                // 权限加载完成后再显示弹窗
                setIsPrivilegeModalVisible(true);
              } catch (err) {
                console.error('加载数据库权限失败:', err);
                setUserDatabasePrivileges([]);
                setIsPrivilegeModalVisible(true);
              }
            }}
            size="small"
          >
            权限
          </Button>
          <Button 
            type="link" 
            icon={<EditOutlined />} 
            onClick={() => {
              setSelectedUser(record);
              form.setFieldsValue({ password: '' });
              setIsEditModalVisible(true);
            }}
            size="small"
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除该用户吗？"
            onConfirm={() => handleDeleteUser(record)}
            okText="确定"
            cancelText="取消"
          >
            <Button 
              type="link" 
              icon={<DeleteOutlined />} 
              danger
              size="small"
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 12 }}>
      <Card 
        title={<Title level={4}>MySQL 用户管理</Title>} 
        className={`mysql-users-page ${darkMode ? 'dark-mode' : ''}`}
        extra={
          <Space>
            <Text type="secondary" className="text-sm">
              共 {userData.length} 个用户
            </Text>
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                setIsAddModalVisible(true);
              }}
            >
              新增用户
            </Button>
            <Button 
              icon={<KeyOutlined />}
              onClick={async () => {
                // 检查是否有选中的用户
                if (!selectedUser) {
                  message.warning('请先选择一个用户');
                  return;
                }
                
                console.log('点击服务器权限按钮，选中用户:', selectedUser);
                
                // 设置为服务器权限模式
                setIsServerPrivilegeMode(true);
                // 只在首次需要时获取权限列表，避免重复设置
                if (privileges.length === 0) {
                  setPrivileges(getMysqlPrivileges());
                }
                
                // 先加载权限，再显示弹窗
                try {
                  console.log('开始获取服务器权限...');
                  const privilegesList = await fetchServerPrivileges(selectedUser.username, selectedUser.host);
                  console.log('服务器权限获取完成，设置权限状态:', privilegesList);
                  
                  // 处理权限列表，应用与checkbox组件中相同的宽松匹配逻辑
                  const allPrivileges = getMysqlPrivileges();
                  const matchedPrivileges = allPrivileges
                    .map(privilege => privilege.name)
                    .filter(itemName => {
                      // 检查是否有权限匹配
                      return privilegesList.some(priv => {
                        // 1. 如果是ALL权限，匹配所有权限
                        if (priv.toUpperCase() === 'ALL') {
                          return true;
                        }
                        // 2. 检查权限名称的包含关系，双向匹配
                        const privUpper = priv.toUpperCase();
                        const itemNameUpper = itemName.toUpperCase();
                        return privUpper === itemNameUpper || 
                               privUpper.includes(itemNameUpper) || 
                               itemNameUpper.includes(privUpper);
                      });
                    });
                  
                  console.log('匹配后的权限列表:', matchedPrivileges);
                  setServerPrivileges(matchedPrivileges);
                  
                  // 权限加载完成后再显示弹窗
                  console.log('打开权限弹窗，服务器权限模式');
                  setIsPrivilegeModalVisible(true);
                } catch (err) {
                  console.error('加载服务器权限失败:', err);
                  setServerPrivileges([]);
                  setIsPrivilegeModalVisible(true);
                }
              }}
            >
              服务器权限
            </Button>
          </Space>
        }
        bordered={!darkMode}
        size="default"
      >
        <Spin spinning={loading}>
          {error ? (
            <Empty
              description={
                <Text type="danger">{error}</Text>
              }
            />
          ) : (
            <Table
              columns={columns}
              dataSource={userData}
              pagination={{
                pageSize: 10,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total) => `共 ${total} 个用户`,
              }}
              locale={{
                emptyText: (
                  <Empty
                    description={
                      <>
                        <Text type="secondary">当前连接下未找到用户信息</Text>
                      </>
                    }
                  />
                ),
              }}
              rowHoverable={true}
              scroll={{ x: 'max-content' }}
              size="small"
              rowSelection={{
                type: 'radio',
                selectedRowKeys,
                onChange: (newSelectedRowKeys, selectedRows) => {
                  setSelectedRowKeys(newSelectedRowKeys);
                  setSelectedUser(selectedRows.length > 0 ? selectedRows[0] : null);
                },
                onSelect: (record) => {
                  setSelectedUser(record);
                }
              }}
            />
          )}
        </Spin>
      </Card>

      {/* 新增用户弹窗 */}
      <Modal
        title="新增MySQL用户"
        open={isAddModalVisible}
        onCancel={() => {
          form.resetFields();
          setIsAddModalVisible(false);
        }}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleAddUser}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item
            name="host"
            label="主机"
            rules={[{ required: true, message: '请输入主机地址' }]}
          >
            <Input placeholder="例如: localhost 或 %" defaultValue="localhost" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码长度至少为6位' }
            ]}
          >
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入密码" />
          </Form.Item>
          <Form.Item>
            <Space style={{ float: 'right' }}>
              <Button onClick={() => {
                form.resetFields();
                setIsAddModalVisible(false);
              }}>取消</Button>
              <Button type="primary" htmlType="submit">确定</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑用户弹窗 */}
      <Modal
        title="编辑MySQL用户"
        open={isEditModalVisible}
        onCancel={() => {
          form.resetFields();
          setIsEditModalVisible(false);
        }}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleEditUser}
        >
          <Form.Item label="当前用户">
            <Text strong>{selectedUser?.username}@{selectedUser?.host}</Text>
          </Form.Item>
          <Form.Item
            name="host"
            label="主机"
            initialValue={selectedUser?.host}
            tooltip="修改主机将创建新用户并删除旧用户"
          >
            <Input placeholder="例如: localhost 或 %" />
          </Form.Item>
          <Form.Item
            name="password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码长度至少为6位' }
            ]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入密码" />
          </Form.Item>
          <Form.Item>
            <Space style={{ float: 'right' }}>
              <Button onClick={() => {
                form.resetFields();
                setIsEditModalVisible(false);
              }}>取消</Button>
              <Button type="primary" htmlType="submit">确定</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 权限管理弹窗 - 支持数据库级别和服务器级别 */}
      <Modal
        title={isServerPrivilegeMode 
          ? `${selectedUser?.username}@${selectedUser?.host} 服务器级别权限管理`
          : `${selectedUser?.username}@${selectedUser?.host} 数据库级别权限管理`}
        open={isPrivilegeModalVisible}
        onCancel={() => setIsPrivilegeModalVisible(false)}
        footer={null}
        width={900}
      >
        {/* 数据库级别权限管理 */}
        {!isServerPrivilegeMode && (
          <>
            {/* 只在权限列表页面显示添加权限按钮 */}
            {!showPrivilegeList && (
              <div style={{ marginBottom: 20, textAlign: 'right' }}>
                <Space>
                  <Button 
                    type="primary" 
                    onClick={() => {
                      // 添加新数据库权限的逻辑
                      setCurrentEditDatabase(null);
                      setShowPrivilegeList(true);
                      // 加载可用数据库列表
                      loadAvailableDatabases();
                      // 清空当前权限，准备添加新权限
                      setSelectedPrivileges([]);
                      setOriginalPrivileges([]);
                    }}
                  >
                    添加权限
                  </Button>
                </Space>
              </div>
            )}
              
              {!showPrivilegeList ? (
              // 显示有权限的数据库列表
              <div style={{ padding: '10px 0', maxHeight: 500, overflowY: 'auto' }}>
                {userDatabasePrivileges.length === 0 ? (
                  <Empty description="当前用户没有数据库权限" />
                ) : (
                  <Table
                    columns={[
                      {
                        title: '数据库',
                        dataIndex: 'database',
                        key: 'database',
                      },
                      {
                        title: '权限',
                        dataIndex: 'privileges',
                        key: 'privileges',
                        render: (privileges: string[]) => (
                          <>
                            {privileges.map(priv => (
                              <Tag key={priv} color="blue" style={{ marginRight: 5, marginBottom: 5 }}>
                                {priv}
                              </Tag>
                            ))}
                          </>
                        ),
                      },
                      {
                        title: '操作',
                        key: 'action',
                        render: (_, record: DatabasePrivilege) => (
                          <Space size="middle">
                            <Button 
                              type="link" 
                              onClick={async () => {
                                // 首先设置当前编辑的数据库
                                setCurrentEditDatabase(record.database);
                                // 重置权限表单
                                privilegeForm.resetFields();
                                // 加载可用的数据库列表，确保选择框中有目标数据库选项
                                await loadAvailableDatabases();
                                // 然后确保在设置showPrivilegeList为true之前，权限数据已经准备好
                                if (selectedUser) {
                                  // 先保存原始权限，用于后续比较
                                  const currentPrivileges = await fetchDatabasePrivileges(selectedUser.username, selectedUser.host, record.database);
                                  setOriginalPrivileges([...currentPrivileges]);
                                  // 设置当前选中的权限，这样权限复选框会正确显示
                                  setSelectedPrivileges([...currentPrivileges]);
                                }
                                
                                // 使用setTimeout确保所有异步操作完成
                                setTimeout(() => {
                                  // 切换到权限编辑界面
                                  setShowPrivilegeList(true);
                                  
                                  // 使用另一个setTimeout确保UI渲染完成后，通过form实例明确设置数据库选择值
                                  setTimeout(() => {
                                    // 再次确保currentEditDatabase状态已设置
                                    setCurrentEditDatabase(record.database);
                                    // 关键修复：通过form.setFieldsValue明确设置数据库字段值
                                    privilegeForm.setFieldsValue({ database: record.database });
                                  }, 100); // 增加延迟确保DOM已更新
                                }, 0);
                              }}
                            >
                              编辑权限
                            </Button>
                            <Popconfirm
                              title={`确定要删除用户 ${selectedUser?.username}@${selectedUser?.host} 对数据库 ${record.database} 的所有权限吗？`}
                              description="此操作将撤销该数据库上的所有权限，且无法撤销。"
                              onConfirm={async () => {
                                // 删除权限的逻辑
                                if (selectedUser) {
                                  try {
                                    setIsDeleting(true);
                                    const poolId = connection.connectionId || connection.id;
                                    
                                    // 先检查权限是否存在
                                    const existingPrivileges = userDatabasePrivileges.find(priv => priv.database === record.database);
                                    if (!existingPrivileges) {
                                      message.warning('该数据库权限不存在');
                                      return;
                                    }
                                    
                                    // 撤销该数据库上的所有权限
                                    await window.electronAPI.executeQuery(poolId, 
                                      `REVOKE ALL PRIVILEGES ON ${record.database}.* FROM '${selectedUser.username}'@'${selectedUser.host}'`);
                                    
                                    // 刷新权限
                                    await window.electronAPI.executeQuery(poolId, 'FLUSH PRIVILEGES');
                                    
                                    message.success(`数据库 ${record.database} 的权限删除成功`);
                                    
                                    // 重新获取用户权限列表
                                    const userPrivileges = await fetchUserDatabasePrivileges(selectedUser.username, selectedUser.host);
                                    setUserDatabasePrivileges(userPrivileges);
                                  } catch (err: any) {
                                    console.error('删除权限失败:', err);
                                    message.error(`删除权限失败: ${err.message || '未知错误'}`);
                                  } finally {
                                    setIsDeleting(false);
                                  }
                                }
                              }}
                              okText="确定"
                              cancelText="取消"
                              okButtonProps={{ loading: isDeleting }}
                            >
                              <Button type="link" danger disabled={isDeleting}>删除权限</Button>
                            </Popconfirm>
                          </Space>
                        ),
                      },
                    ]}
                    dataSource={userDatabasePrivileges}
                    rowKey="database"
                    pagination={false}
                    size="small"
                  />
                )}
              </div>
            ) : (
              // 显示权限编辑界面
              <>
                <div style={{ marginBottom: 20 }}>
                  <Form 
                    form={privilegeForm} 
                    layout="vertical"
                  >
                    <Form.Item 
                      label="数据库" 
                      name="database"
                      rules={[{ required: true, message: '请选择要授权的数据库' }]}
                      initialValue={currentEditDatabase}
                    >
                      <Select 
                        placeholder="请选择要授权的数据库" 
                        style={{ maxWidth: '150px' }}
                        onChange={async (value) => {
                          setCurrentEditDatabase(value);
                          // 当用户切换数据库选择时，自动加载该数据库已有的权限
                          if (selectedUser && value) {
                            try {
                              // 获取该数据库的已有权限
                              const currentPrivileges = await fetchDatabasePrivileges(selectedUser.username, selectedUser.host, value);
                              // 更新选中的权限，这样权限复选框会正确显示
                              setOriginalPrivileges([...currentPrivileges]);
                              setSelectedPrivileges([...currentPrivileges]);
                            } catch (err) {
                              console.error('加载数据库权限失败:', err);
                              // 加载失败时清空权限
                              setOriginalPrivileges([]);
                              setSelectedPrivileges([]);
                            }
                          } else {
                            // 如果没有选中用户或数据库，清空权限
                            setOriginalPrivileges([]);
                            setSelectedPrivileges([]);
                          }
                        }}
                      >
                        {availableDatabases.map(db => (
                          <Option key={db} value={db}>{db}</Option>
                        ))}
                      </Select>
                    </Form.Item>
                  </Form>
                </div>
                
                {/* 提示信息 */}
                {!currentEditDatabase && (
                  <div className="ant-alert ant-alert-info" style={{ marginBottom: 16 }}>
                    <div className="ant-alert-message">请先选择要添加权限的数据库</div>
                  </div>
                )}
                
                <div style={{ padding: '10px 0', maxHeight: 400, overflowY: 'auto' }}>
                  <Checkbox.Group 
                    value={selectedPrivileges} 
                    onChange={onPrivilegeChange}
                    style={{ width: '100%' }}
                  >
                    {privileges.reduce((acc, privilege) => {
                      const categoryIndex = acc.findIndex(item => item.category === privilege.category);
                      if (categoryIndex === -1) {
                        acc.push({
                          category: privilege.category,
                          items: [privilege]
                        });
                      } else {
                        acc[categoryIndex].items.push(privilege);
                      }
                      return acc;
                    }, [] as { category: string; items: Privilege[] }[]).map(group => (
                      <div key={group.category} style={{ marginBottom: 16 }}>
                        <Typography.Title level={5} style={{ marginBottom: 8 }}>
                          {group.category}
                        </Typography.Title>
                        <div style={{ paddingLeft: 16 }}>
                          {group.items.map(item => (
                            <div key={item.name} style={{ marginBottom: 8 }}>
                              <Checkbox 
                                value={item.name}
                              >
                                <span>
                                  <strong>{item.name}</strong>
                                  <Text type="secondary"> - {item.description}</Text>
                                </span>
                              </Checkbox>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </Checkbox.Group>
                </div>
                
                <div style={{ marginTop: 16, textAlign: 'right' }}>
                  <Space>
                    <Button onClick={() => setShowPrivilegeList(false)}>返回</Button>
                    <Button 
                      type="primary" 
                      disabled={!currentEditDatabase || isSaving}
                      loading={isSaving}
                      onClick={async () => {
                      // 保存权限的逻辑
                      if (!selectedUser || !currentEditDatabase) return;
                      
                      try {
                        setIsSaving(true);
                        const poolId = connection.connectionId || connection.id;
                        
                        // 比较新旧权限，只在有变化时才执行操作
                        const hasChanged = JSON.stringify(originalPrivileges.sort()) !== JSON.stringify(selectedPrivileges.sort());
                        
                        if (!hasChanged) {
                          message.info('未修改任何权限');
                          return;
                        }
                        
                        // 检查该数据库是否已有权限记录
                        const existingPrivileges = userDatabasePrivileges.find(priv => priv.database === currentEditDatabase);
                        
                        // 如果有现有权限或者选择了新权限，则需要更新
                        if (existingPrivileges || selectedPrivileges.length > 0) {
                          // 分情况处理，只修改需要操作的权限
                          if (selectedPrivileges.length === 0) {
                            // 完全移除该数据库的所有权限
                            await window.electronAPI.executeQuery(poolId, 
                              `REVOKE ALL PRIVILEGES ON ${currentEditDatabase}.* FROM '${selectedUser.username}'@'${selectedUser.host}'`);
                            message.success(`已撤销对数据库 ${currentEditDatabase} 的所有权限`);
                          } else {
                            // 对于编辑现有权限的情况，先撤销所有权限，然后重新授予
                            if (existingPrivileges) {
                              await window.electronAPI.executeQuery(poolId, 
                                `REVOKE ALL PRIVILEGES ON ${currentEditDatabase}.* FROM '${selectedUser.username}'@'${selectedUser.host}'`);
                            }
                            
                            // 授予新的权限集合
                            const privilegesStr = selectedPrivileges.join(', ');
                            await window.electronAPI.executeQuery(poolId, 
                              `GRANT ${privilegesStr} ON ${currentEditDatabase}.* TO '${selectedUser.username}'@'${selectedUser.host}'`);
                            message.success(`数据库 ${currentEditDatabase} 的权限更新成功`);
                          }
                          
                          // 刷新权限
                          await window.electronAPI.executeQuery(poolId, 'FLUSH PRIVILEGES');
                        } else {
                          // 如果没有选择任何权限且不是编辑现有权限，则不做任何操作
                          message.warning('请至少选择一个权限');
                          return;
                        }
                        
                        // 重新获取用户权限列表
                        const userPrivileges = await fetchUserDatabasePrivileges(selectedUser.username, selectedUser.host);
                        setUserDatabasePrivileges(userPrivileges);
                        
                        // 返回数据库列表
                        setShowPrivilegeList(false);
                      } catch (err: any) {
                        console.error('更新权限失败:', err);
                        message.error(`更新权限失败: ${err.message || '未知错误'}`);
                      } finally {
                        setIsSaving(false);
                      }
                    }}>
                      保存权限
                    </Button>
                  </Space>
                </div>
              </>
            )}
          </>
        )}
        
        {/* 服务器级别权限管理 */}
        {isServerPrivilegeMode && (
          <>
            <div style={{ padding: '10px 0', maxHeight: 500, overflowY: 'auto' }}>
              <Checkbox.Group 
                value={serverPrivileges} 
                onChange={onServerPrivilegeChange}
                style={{ width: '100%' }}
              >
                {privileges.reduce((acc, privilege) => {
                  const categoryIndex = acc.findIndex(item => item.category === privilege.category);
                  if (categoryIndex === -1) {
                    acc.push({
                      category: privilege.category,
                      items: [privilege]
                    });
                  } else {
                    acc[categoryIndex].items.push(privilege);
                  }
                  return acc;
                }, [] as { category: string; items: Privilege[] }[]).map(group => (
                  <div key={group.category} style={{ marginBottom: 16 }}>
                    <Typography.Title level={5} style={{ marginBottom: 8 }}>
                      {group.category}
                    </Typography.Title>
                    <div style={{ paddingLeft: 16 }}>
                      {group.items.map(item => (
                        <div key={item.name} style={{ marginBottom: 8 }}>
                          <Checkbox 
                            value={item.name}
                          >
                            <span>
                              <strong>{item.name}</strong>
                              <Text type="secondary"> - {item.description}</Text>
                            </span>
                          </Checkbox>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </Checkbox.Group>
            </div>
            
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <Space>
                <Button onClick={() => setIsPrivilegeModalVisible(false)}>取消</Button>
                <Button type="primary" onClick={handlePrivilegeChange}>
                  保存权限
                </Button>
              </Space>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
};

export default MySqlUsersPage;