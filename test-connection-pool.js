// 数据库连接池测试脚本
const { DatabaseService } = require('./src/main/services/DatabaseService');

async function testConnectionPool() {
  console.log('=== 数据库连接池测试开始 ===');
  
  const dbService = new DatabaseService();
  
  // 测试配置
  const testConfig = {
    type: 'mysql',
    host: 'localhost',
    port: 3306,
    username: 'root',
    password: 'password',
    database: 'test_db',
    timeout: 30,
    ssl: false
  };
  
  // 连接池配置
  const poolConfig = {
    maxConnections: 5,
    minConnections: 2,
    acquireTimeout: 30000,
    idleTimeout: 60000,
    testOnBorrow: true
  };
  
  try {
    console.log('1. 创建连接池...');
    const poolId = await dbService.createConnectionPool(testConfig, poolConfig);
    console.log(`连接池创建成功，ID: ${poolId}`);
    
    console.log('2. 获取连接池状态...');
    const status = dbService.getConnectionPoolStatus(poolId);
    console.log('连接池状态:', status);
    
    console.log('3. 执行简单查询测试...');
    const queryResult = await dbService.executeQuery(poolId, 'SELECT 1 as test_value');
    console.log('查询结果:', queryResult);
    
    console.log('4. 获取数据库信息...');
    const dbInfo = await dbService.getDatabaseInfo(poolId);
    console.log('数据库信息:', dbInfo);
    
    console.log('5. 测试事务执行...');
    const transactionQueries = [
      { query: 'CREATE TABLE IF NOT EXISTS test_table (id INT, name VARCHAR(50))' },
      { query: 'INSERT INTO test_table VALUES (1, \'test\')' }
    ];
    const transactionResult = await dbService.executeTransaction(poolId, transactionQueries);
    console.log(`事务执行${transactionResult ? '成功' : '失败'}`);
    
    console.log('6. 获取表列表...');
    const tables = await dbService.listTables(poolId);
    console.log('表列表:', tables);
    
    console.log('7. 断开连接池...');
    await dbService.disconnect(poolId);
    console.log('连接池已断开');
    
    console.log('=== 数据库连接池测试完成 ===');
    
  } catch (error) {
    console.error('测试过程中发生错误:', error.message);
    console.error('错误堆栈:', error.stack);
  }
}

// 运行测试
if (require.main === module) {
  testConnectionPool().catch(console.error);
}

module.exports = { testConnectionPool };