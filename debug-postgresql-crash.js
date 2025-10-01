// PostgreSQL连接崩溃调试脚本 - 简化版

// 强制使用TypeScript编译并运行
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'CommonJS',
    target: 'ES2019'
  }
});

// 导入必要的模块
const fs = require('fs');
const path = require('path');

// 确保logs目录存在
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs');
}

// 重定向console.log到文件以便稍后分析
const logFile = fs.createWriteStream(path.join('logs', 'postgresql-debug.log'), { flags: 'w' });
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleDebug = console.debug;

console.log = (...args) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] INFO: ${args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ')}\n`;
  logFile.write(logMessage);
  originalConsoleLog.apply(console, args);
};

console.error = (...args) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ERROR: ${args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ')}\n`;
  logFile.write(logMessage);
  originalConsoleError.apply(console, args);
};

console.debug = (...args) => {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] DEBUG: ${args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ')}\n`;
  logFile.write(logMessage);
  originalConsoleDebug.apply(console, args);
};

// 直接导入TypeScript源代码
const { DatabaseService } = require('./src/main/services/DatabaseService.ts');

class PostgresDebugger {
  constructor() {
    console.log('=== PostgreSQL连接崩溃调试器初始化 ===');
    this.dbService = new DatabaseService();
  }

  // 模拟DatabaseService中的配置验证逻辑
  validateConnectionConfig(config) {
    const errors = [];
    
    if (!config.type) {
      errors.push('数据库类型不能为空');
    }
    
    if (!config.host) {
      errors.push('主机名不能为空');
    }
    
    if (!config.port || isNaN(config.port) || config.port < 1 || config.port > 65535) {
      errors.push('端口必须是1-65535之间的数字');
    }
    
    if (!config.username) {
      errors.push('用户名不能为空');
    }
    
    // PostgreSQL允许空密码
    if (config.type !== 'postgresql' && !config.password) {
      errors.push('密码不能为空');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  // 运行基本的PostgreSQL连接测试
  async runBasicConnectionTest(config) {
    let poolId = null;
    
    try {
      console.log('\n=== 运行PostgreSQL基本连接测试 ===');
      console.log('连接配置:', { ...config, password: '******' });

      // 1. 验证配置
      console.log('1. 验证配置...');
      const validation = this.validateConnectionConfig(config);
      console.log('配置验证结果:', validation);
      
      if (!validation.valid) {
        throw new Error(`配置验证失败: ${validation.errors.join(', ')}`);
      }

      // 2. 生成连接池ID (模拟DatabaseService中的逻辑)
      console.log('2. 生成连接池ID...');
      const databaseName = config.database || (config.type === 'postgresql' ? 'postgres' : '');
      const expectedPoolId = `${config.type}_${config.host}_${config.port}_${databaseName}`;
      console.log(`预期的连接池ID: ${expectedPoolId}`);

      // 3. 尝试创建连接池
      console.log('3. 创建连接池...');
      poolId = await this.dbService.createConnectionPool(config, {
        maxConnections: 2,
        minConnections: 1,
        acquireTimeout: 60000,
        idleTimeout: 30000,
        testOnBorrow: true
      });
      console.log(`连接池创建成功，实际ID: ${poolId}`);

      // 4. 获取连接池状态
      console.log('4. 获取连接池状态...');
      const status = this.dbService.getConnectionPoolStatus(poolId);
      console.log('连接池状态:', status);

      // 5. 尝试执行简单查询
      console.log('5. 执行简单查询...');
      const queryResult = await this.dbService.executeQuery(poolId, 'SELECT 1 as test_value');
      console.log('查询结果:', queryResult);

      // 6. 尝试获取数据库信息
      console.log('6. 获取数据库信息...');
      const dbInfo = await this.dbService.getDatabaseInfo(poolId);
      console.log('数据库信息:', dbInfo);

      // 7. 尝试获取表列表
      console.log('7. 获取表列表...');
      const tables = await this.dbService.listTables(poolId);
      console.log('表列表:', tables);

      return {
        success: true,
        poolId,
        message: '基本连接测试成功完成'
      };
    } catch (error) {
      console.error('基本连接测试失败:', error);
      console.error('错误堆栈:', error.stack);
      
      return {
        success: false,
        error: error.message,
        stack: error.stack
      };
    } finally {
      // 无论成功与否，都尝试断开连接池
      if (poolId) {
        try {
          console.log('8. 断开连接池...');
          await this.dbService.disconnect(poolId);
          console.log('连接池已断开');
        } catch (disconnectError) {
          console.error('断开连接池失败:', disconnectError);
        }
      }
      
      console.log('=== PostgreSQL基本连接测试完成 ===\n');
    }
  }

  // 测试不同错误场景
  async runErrorScenarios(baseConfig) {
    console.log('\n=== 运行PostgreSQL错误场景测试 ===');
    
    const scenarios = [
      {
        name: '无效凭据',
        type: 'invalid-credentials',
        config: {
          ...baseConfig,
          password: 'invalid-password'
        }
      },
      {
        name: '无效主机',
        type: 'invalid-host',
        config: {
          ...baseConfig,
          host: 'non-existent-host-12345.com'
        }
      },
      {
        name: '空数据库名',
        type: 'empty-database',
        config: {
          ...baseConfig,
          database: ''
        }
      },
      {
        name: '无效端口',
        type: 'invalid-port',
        config: {
          ...baseConfig,
          port: 99999 // 超出有效端口范围
        }
      }
    ];
    
    const results = [];
    
    for (const scenario of scenarios) {
      console.log(`\n--- 测试场景: ${scenario.name} ---`);
      console.log('配置:', { ...scenario.config, password: scenario.type === 'invalid-credentials' ? 'invalid-password' : '******' });
      
      try {
        const validation = this.validateConnectionConfig(scenario.config);
        if (!validation.valid) {
          console.log('配置验证失败 (预期):', validation.errors);
          results.push({
            scenario: scenario.name,
            outcome: '配置验证失败 (预期)',
            details: validation.errors
          });
          continue;
        }
        
        const poolId = await this.dbService.createConnectionPool(scenario.config);
        console.log(`连接池创建成功 (${scenario.name})`);
        
        // 如果成功创建了连接池，尝试断开
        await this.dbService.disconnect(poolId);
        console.log(`连接池已断开 (${scenario.name})`);
        
        results.push({
          scenario: scenario.name,
          outcome: '意外成功',
          details: '在预期失败的场景中成功创建了连接池'
        });
      } catch (error) {
        console.log(`场景 ${scenario.name} 失败 (${error.message.substring(0, 50)}...)`);
        results.push({
          scenario: scenario.name,
          outcome: '预期失败',
          details: error.message
        });
      }
    }
    
    console.log('\n=== 错误场景测试结果摘要 ===');
    console.log(JSON.stringify(results, null, 2));
    console.log('=== 错误场景测试完成 ===');
    
    return results;
  }

  // 运行完整的调试会话
  async runFullDebugSession() {
    console.log('\n=== PostgreSQL连接崩溃完整调试会话开始 ===');
    
    // 测试配置（可以根据实际环境修改）
    const testConfig = {
      type: 'postgresql',
      host: '101.126.8.48',
      port: 5432,
      username: 'hanBin',
      password: 'Han147258!',
      database: 'dev-db',
      timeout: 30,
      ssl: false,
      id: 'test-pg-connection',
      name: '测试PostgreSQL连接',
      isConnected: false
    };
    
    // 1. 运行基本连接测试
    const basicTestResult = await this.runBasicConnectionTest(testConfig);
    
    // 2. 运行错误场景测试
    const errorScenarioResults = await this.runErrorScenarios(testConfig);
    
    // 3. 尝试多次快速连接/断开测试
    console.log('\n=== 运行连接池稳定性测试 ===');
    const stabilityResults = await this.runStabilityTest(testConfig);
    
    console.log('\n=== PostgreSQL连接崩溃完整调试会话结束 ===');
    
    return {
      basicTest: basicTestResult,
      errorScenarios: errorScenarioResults,
      stabilityTest: stabilityResults
    };
  }

  // 运行连接池稳定性测试
  async runStabilityTest(config) {
    const iterations = 5;
    const results = [];
    
    for (let i = 0; i < iterations; i++) {
      console.log(`\n--- 稳定性测试迭代 ${i + 1}/${iterations} ---`);
      
      try {
        // 创建连接池
        const poolId = await this.dbService.createConnectionPool(config);
        console.log(`连接池 ${i + 1} 创建成功: ${poolId}`);
        
        // 执行简单查询
        const queryResult = await this.dbService.executeQuery(poolId, 'SELECT 1 as test_value, \'' + i + '\' as iteration');
        console.log(`查询 ${i + 1} 执行成功`);
        
        // 断开连接池
        await this.dbService.disconnect(poolId);
        console.log(`连接池 ${i + 1} 断开成功`);
        
        results.push({
          iteration: i + 1,
          success: true
        });
      } catch (error) {
        console.error(`稳定性测试迭代 ${i + 1} 失败:`, error);
        results.push({
          iteration: i + 1,
          success: false,
          error: error.message
        });
        break; // 如果失败，停止测试
      }
    }
    
    return results;
  }
}

// 主函数
async function main() {
  console.log('启动PostgreSQL连接崩溃调试工具...');
  
  try {
    const debuggerInstance = new PostgresDebugger();
    
    // 运行完整的调试会话
    const debugResults = await debuggerInstance.runFullDebugSession();
    
    // 将结果保存到文件
    const resultsFile = path.join('logs', 'postgresql-debug-results.json');
    fs.writeFileSync(resultsFile, JSON.stringify(debugResults, null, 2));
    console.log(`调试结果已保存到: ${resultsFile}`);
    
    // 保存日志文件路径
    console.log(`调试日志已保存到: ${path.join('logs', 'postgresql-debug.log')}`);
    
  } catch (error) {
    console.error('调试过程中发生严重错误:', error);
    console.error('错误堆栈:', error.stack);
  } finally {
    // 确保日志文件被关闭
    logFile.end();
    console.log('调试工具已退出');
  }
}

// 运行主函数
if (require.main === module) {
  main().catch(console.error);
}

// 导出用于其他脚本调用
module.exports = { PostgresDebugger };