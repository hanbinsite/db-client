import type { DatabaseConnection } from '../../types';
import { BaseDbUtils } from './base';
import type { DatabaseItem } from '../database-utils';

export interface MySqlUser {
  user: string;
  host: string;
  privileges: string;
  created?: string;
  max_connections?: number;
}

export interface CreateUserParams {
  username: string;
  host: string;
  password: string;
}

export interface UpdateUserParams {
  username: string;
  host: string;
  newPassword: string;
}

export class MySqlDbUtils extends BaseDbUtils {
  async getDatabases(connection: DatabaseConnection): Promise<DatabaseItem[]> {
    try {
      if (!window.electronAPI || !connection) return [];
      const poolId = connection.connectionId || connection.id;
      if (!poolId) return [];
      const res = await window.electronAPI.listDatabases(poolId);
      if (res && res.success && Array.isArray(res.data)) {
        return res.data.map((name: string) => ({ name, tables: [], views: [], procedures: [], functions: [], schemas: [] }));
      }
      const fallback = await window.electronAPI.executeQuery(poolId, 'SHOW DATABASES');
      if (fallback && fallback.success && Array.isArray(fallback.data)) {
        return fallback.data.map((row: any) => ({ name: String(row.Database || Object.values(row)[0]), tables: [], views: [], procedures: [], functions: [], schemas: [] }));
      }
      return [];
    } catch {
      return [];
    }
  }

  async getTables(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const sql = `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`;
    const res = await window.electronAPI.executeQuery(poolId, sql, [databaseName]);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data.map((row: any) => row.TABLE_NAME || Object.values(row)[0]);
    }
    return [];
  }

  async getViews(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const sql = `SELECT TABLE_NAME FROM information_schema.views WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`;
    const res = await window.electronAPI.executeQuery(poolId, sql, [databaseName]);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data.map((row: any) => row.TABLE_NAME || Object.values(row)[0]);
    }
    return [];
  }

  async getProcedures(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const sql = `SELECT ROUTINE_NAME FROM information_schema.routines WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'PROCEDURE' ORDER BY ROUTINE_NAME`;
    const res = await window.electronAPI.executeQuery(poolId, sql, [databaseName]);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data.map((row: any) => row.ROUTINE_NAME || Object.values(row)[0]);
    }
    return [];
  }

  async getFunctions(connection: DatabaseConnection, databaseName: string): Promise<string[]> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) return [];
    const sql = `SELECT ROUTINE_NAME FROM information_schema.routines WHERE ROUTINE_SCHEMA = ? AND ROUTINE_TYPE = 'FUNCTION' ORDER BY ROUTINE_NAME`;
    const res = await window.electronAPI.executeQuery(poolId, sql, [databaseName]);
    if (res && res.success && Array.isArray(res.data)) {
      return res.data.map((row: any) => row.ROUTINE_NAME || Object.values(row)[0]);
    }
    return [];
  }

  async getSchemas(connection: DatabaseConnection): Promise<string[]> {
    // MySQL的schema即database，前端已在数据库维度展示，此处返回空
    return [];
  }

  async getUsers(connection: DatabaseConnection): Promise<MySqlUser[]> {
    try {
      const poolId = connection.connectionId || connection.id;
      if (!window.electronAPI || !poolId) {
        console.error('连接无效或未初始化');
        return [];
      }

      console.log('开始获取MySQL用户列表...');
      
      // 核心策略：优先使用能够获取所有用户的查询方式
      let usersResult;
      
      // 尝试多种查询方式，按优先级顺序
      const queryMethods = [
        {
          name: '直接查询mysql.user表',
          query: "SELECT user, host, created FROM mysql.user ORDER BY user, host"
        },
        {
          name: '查询information_schema.user_privileges表(完整)',
          query: "SELECT DISTINCT SUBSTRING_INDEX(SUBSTRING_INDEX(grantee, '\\'', 2), '\\'', -1) as user, SUBSTRING_INDEX(SUBSTRING_INDEX(grantee, '\\'', -2), '\\'', 1) as host FROM information_schema.user_privileges ORDER BY user, host"
        },
        {
          name: '查询mysql.user的user和host字段',
          query: "SELECT DISTINCT user, host FROM mysql.user ORDER BY user, host"
        },
        {
          name: '使用SHOW GRANTS FOR ALL命令(如果支持)',
          query: "SHOW GRANTS FOR ALL"
        }
      ];
      
      // 尝试每种查询方式，直到成功获取用户数据
      for (const method of queryMethods) {
        try {
          console.log(`尝试查询方式: ${method.name}`);
          usersResult = await window.electronAPI.executeQuery(poolId, method.query);
          console.log(`${method.name} 结果:`, usersResult);
          
          // 检查结果是否有效且包含数据
          if (usersResult && usersResult.success && Array.isArray(usersResult.data) && usersResult.data.length > 0) {
            console.log(`成功使用 ${method.name} 获取到 ${usersResult.data.length} 个用户`);
            break;
          }
        } catch (e) {
          console.warn(`${method.name} 查询失败:`, e);
          // 继续尝试下一种方法
        }
      }
      
      // 特殊处理：如果是SHOW GRANTS FOR ALL结果，需要解析grants来提取用户名
      if (usersResult && usersResult.data && Array.isArray(usersResult.data)) {
        // 检查结果是否是SHOW GRANTS格式
        const firstRow = usersResult.data[0];
        const grantKey = firstRow ? Object.keys(firstRow).find(key => key.toLowerCase().includes('grant')) : null;
        
        if (grantKey) {
          // 解析SHOW GRANTS结果来提取所有用户
          const userSet = new Set<string>();
          usersResult.data.forEach((row: any) => {
            const grant = row[grantKey] as string;
            if (grant) {
              // 匹配GRANT ... ON ... TO 'user'@'host'
              const match = grant.match(/TO\s+['"]([^'"]+)['"]@['"]([^'"]+)['"]/i);
              if (match && match[1] && match[2]) {
                userSet.add(`${match[1]}@${match[2]}`);
              }
            }
          });
          
          // 转换为标准格式
          if (userSet.size > 0) {
            usersResult.data = Array.from(userSet).map(userHost => {
              const [user, host] = userHost.split('@');
              return { user, host };
            });
          }
        }
      }
      
      // 如果所有查询都没有返回多个用户，记录警告
      if (!usersResult || !usersResult.success || !Array.isArray(usersResult.data) || usersResult.data.length <= 1) {
        console.warn('获取用户列表有限或为空，可能是权限问题:', usersResult);
        
        // 只有在完全没有用户数据时才使用备选方案
        if (!usersResult || !usersResult.data || usersResult.data.length === 0) {
          console.log('使用当前连接用户作为基础');
          const basicUsers = [{
            user: connection.username,
            host: connection.host
          }];
          usersResult = { success: true, data: basicUsers };
        }
      }

      console.log('最终获取到的用户数据:', usersResult);
      
      // 处理用户数据
      const usersWithPrivileges = usersResult.data.map((userRow: any) => {
        try {
          // 安全地提取用户和主机信息
          let user = userRow.user || '';
          let host = userRow.host || '';
          
          // 如果数据来自grantee字段，进行解析
          if (!user && userRow.grantee) {
            const grantee = userRow.grantee;
            // 解析 'user'@'host' 格式
            const userMatch = grantee.match(/^['"](.*)['"]@['"](.*)['"]$/);
            if (userMatch) {
              user = userMatch[1];
              host = userMatch[2];
            }
          }
          
          // 确保user和host有值
          user = user || '未知用户';
          host = host || '%';
          
          // 为用户添加基本信息
          return {
            user,
            host,
            privileges: '权限信息',
            created: userRow.created ? new Date(userRow.created).toLocaleString() : undefined,
            max_connections: undefined
          };
        } catch (err) {
          console.warn('处理用户数据时出错:', err);
          return {
            user: '未知',
            host: '%',
            privileges: '',
            created: undefined,
            max_connections: undefined
          };
        }
      });
      
      // 去重，防止同一用户多次出现
      const uniqueUsers = usersWithPrivileges.filter((user: MySqlUser, index: number, self: MySqlUser[]) =>
        index === self.findIndex((u: MySqlUser) => u.user === user.user && u.host === user.host)
      );
      
      console.log('处理后的唯一用户列表数量:', uniqueUsers.length);
      console.log('处理后的用户列表:', uniqueUsers);
      
      return uniqueUsers;
    } catch (error) {
      console.error('获取MySQL用户信息失败:', error);
      
      // 错误情况下也返回当前连接用户
      if (connection.username) {
        return [{
          user: connection.username,
          host: connection.host,
          privileges: '当前连接用户',
          created: undefined,
          max_connections: undefined
        }];
      }
      return [];
    }
  }

  async createUser(connection: DatabaseConnection, username: string, host: string, password: string): Promise<void> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) {
      throw new Error('连接无效或未初始化');
    }
    const sql = `CREATE USER '${username}'@'${host}' IDENTIFIED BY '${password}'`;
    await window.electronAPI.executeQuery(poolId, sql);
  }

  async updateUser(connection: DatabaseConnection, username: string, host: string, newPassword: string): Promise<void> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId || !newPassword) {
      throw new Error('连接无效或未初始化，或未提供新密码');
    }
    const sql = `ALTER USER '${username}'@'${host}' IDENTIFIED BY '${newPassword}'`;
    await window.electronAPI.executeQuery(poolId, sql);
  }

  async deleteUser(connection: DatabaseConnection, username: string, host: string): Promise<void> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) {
      throw new Error('连接无效或未初始化');
    }
    const sql = `DROP USER '${username}'@'${host}'`;
    await window.electronAPI.executeQuery(poolId, sql);
  }

  async updateUserPrivileges(connection: DatabaseConnection, username: string, host: string, privileges: string[]): Promise<void> {
    const poolId = connection.connectionId || connection.id;
    if (!window.electronAPI || !poolId) {
      throw new Error('连接无效或未初始化');
    }
    
    // 先撤销所有权限
    await window.electronAPI.executeQuery(poolId, `REVOKE ALL PRIVILEGES ON *.* FROM '${username}'@'${host}'`);
    
    // 如果有权限需要授予
    if (privileges && privileges.length > 0) {
      const privilegesStr = privileges.join(', ');
      await window.electronAPI.executeQuery(poolId, 
        `GRANT ${privilegesStr} ON *.* TO '${username}'@'${host}'`);
    }
    
    // 刷新权限
    await window.electronAPI.executeQuery(poolId, 'FLUSH PRIVILEGES');
  }
}