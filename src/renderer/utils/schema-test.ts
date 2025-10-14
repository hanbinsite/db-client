import { getSchemaList } from './database-utils';
import { DatabaseConnection, DatabaseType } from '../types';

/**
 * 测试getSchemaList函数的工具
 * 这个文件用于直接验证getSchemaList函数能否正确获取所有模式列表，包括以pg_开头的系统模式
 */

// 模拟数据库连接对象
const mockConnection: DatabaseConnection = {
  id: 'test-connection',
  name: 'Test PostgreSQL Connection',
  type: 'postgresql' as DatabaseType,
  isConnected: true,
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  password: 'password',
  database: 'postgres',
  ssl: false,
  connectionId: 'test-pool-id',
  lastConnectTime: new Date()
};

/**
 * 运行测试，直接调用getSchemaList函数
 */
export const runSchemaTest = async (): Promise<void> => {
  console.log('==== 开始模式列表测试 ====');
  try {
    // 覆盖window.electronAPI，模拟查询结果
    (window as any).electronAPI = {
      executeQuery: async (poolId: string, query: string, params: any[]): Promise<any> => {
        console.log(`模拟执行查询: ${query}`, `参数:`, params);
        
        // 模拟PostgreSQL数据库的所有模式
        if (query.includes('information_schema.schemata')) {
          // 包含系统模式和自定义模式
          return {
            success: true,
            data: [
              { schema_name: 'public', catalog_name: 'postgres' },
              { schema_name: 'pg_catalog', catalog_name: 'postgres' },
              { schema_name: 'information_schema', catalog_name: 'postgres' },
              { schema_name: 'pg_toast', catalog_name: 'postgres' },
              { schema_name: 'pg_temp_1', catalog_name: 'postgres' },
              { schema_name: 'pg_toast_temp_1', catalog_name: 'postgres' },
              { schema_name: 'test_schema', catalog_name: 'postgres' },
              { schema_name: 'pg_my_custom_schema', catalog_name: 'postgres' }
            ]
          };
        } else if (query.includes('pg_catalog.pg_namespace')) {
          // 包含系统模式和自定义模式
          return {
            success: true,
            data: [
              { schema_name: 'public' },
              { schema_name: 'pg_catalog' },
              { schema_name: 'information_schema' },
              { schema_name: 'pg_toast' },
              { schema_name: 'pg_temp_1' },
              { schema_name: 'pg_toast_temp_1' },
              { schema_name: 'test_schema' },
              { schema_name: 'pg_my_custom_schema' }
            ]
          };
        }
        
        return { success: false, error: '未知查询' };
      }
    };
    
    // 调用getSchemaList函数
    const schemas = await getSchemaList(mockConnection, 'postgres');
    
    console.log('\n测试结果:');
    console.log(`获取到的模式数量: ${schemas.length}`);
    console.log('获取到的模式列表:', schemas);
    
    // 检查是否包含以pg_开头的模式
    const pgSchemas = schemas.filter(schema => schema.startsWith('pg_'));
    console.log(`\n以pg_开头的模式数量: ${pgSchemas.length}`);
    console.log('以pg_开头的模式列表:', pgSchemas);
    
    console.log('\n==== 测试完成 ====');
  } catch (error) {
    console.error('测试过程中发生错误:', error);
  }
};

// 如果直接运行这个文件（在开发环境中），自动执行测试
if (typeof window !== 'undefined') {
  console.log('自动运行模式列表测试...');
  setTimeout(() => {
    runSchemaTest();
  }, 1000);
}