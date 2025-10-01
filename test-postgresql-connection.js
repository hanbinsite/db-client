// PostgreSQL连接测试脚本
const { DatabaseService, DatabaseConnectionFactory } = require('./dist/main/services/DatabaseService');

async function testPostgreSQLConnection() {
  console.log('=== PostgreSQL连接测试开始 ===');
  
  const dbService = new DatabaseService();
  
  // PostgreSQL测试配置（请根据实际环境修改）
  const testConfig = {
    type: 'postgresql',
    host: 'localhost',
    port: 5432,
    username: 'postgres',
    password: 'password',
    database: 'postgres', // PostgreSQL默认数据库
    timeout: 30,
    ssl: false,
    id: 'test-pg-connection',
    name: '测试PostgreSQL连接',
    isConnected: false
  };
  
  // 连接池配置
  const poolConfig = {
    maxConnections: 2,
    minConnections: 1,
    acquireTimeout: 60000,
    idleTimeout: 30000,
    testOnBorrow: true
  };
  
  try {
    console.log('1. 验证配置...');
    const validation = DatabaseConnectionFactory.validateConnectionConfig(testConfig);
    console.log('配置验证结果:', validation);
    
    if (!validation.valid) {
      throw new Error(`配置验证失败: ${validation.errors.join(', ')}`);
    }
    
    console.log('2. 创建连接池...');
    const poolId = await dbService.createConnectionPool(testConfig, poolConfig);
    console.log(`连接池创建成功，ID: ${poolId}`);
    
    console.log('3. 获取连接池状态...');
    const status = dbService.getConnectionPoolStatus(poolId);
    console.log('连接池状态:', status);
    
    console.log('4. 执行简单查询测试...');
    const queryResult = await dbService.executeQuery(poolId, 'SELECT 1 as test_value');
    console.log('查询结果:', queryResult);
    
    console.log('5. 获取数据库信息...');
    const dbInfo = await dbService.getDatabaseInfo(poolId);
    console.log('数据库信息:', dbInfo);
    
    console.log('6. 获取数据库列表...');
    const databases = await dbService.listDatabases(poolId);
    console.log('数据库列表:', databases);
    
    console.log('7. 断开连接池...');
    await dbService.disconnect(poolId);
    console.log('连接池已断开');
    
    console.log('=== PostgreSQL连接测试完成 ===');
    
  } catch (error) {
    console.error('测试过程中发生错误:', error.message);
    console.error('错误堆栈:', error.stack);
  }
}

// 运行测试
if (require.main === module) {
  testPostgreSQLConnection().catch(console.error);
}

module.exports = { testPostgreSQLConnection };