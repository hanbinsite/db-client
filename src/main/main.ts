import { app, BrowserWindow, ipcMain, Menu, nativeImage } from 'electron';
import * as path from 'path';
import { DatabaseService } from './services/DatabaseService';
import { ConnectionStoreService } from './services/ConnectionStoreService';

class DBClientApp {
  private mainWindow: BrowserWindow | null = null;
  private databaseService: DatabaseService = new DatabaseService();
  private connectionStoreService: ConnectionStoreService = new ConnectionStoreService();

  constructor() {
    this.setupApp();
    this.setupIpcHandlers();
  }

  private setupApp(): void {
    // 为Windows设置应用程序用户模型ID，确保任务栏图标正确显示
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.dbclient.app');
    }
    
    // 确定图标路径并设置应用程序图标
    const iconPath = path.join(process.cwd(), 'assets', 'database-icon.svg');
    const icon = nativeImage.createFromPath(iconPath);
    app.dock?.setIcon(icon); // macOS
    
    app.whenReady().then(() => {
      this.createMainWindow();
      this.createMenu();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createMainWindow();
      }
    });
  }

  private createMainWindow(): void {
    // 确定图标路径 - 使用绝对路径确保正确加载
    const iconPath = path.join(process.cwd(), 'assets', 'database-icon.svg');
    
    // 使用nativeImage加载SVG图标
    const icon = nativeImage.createFromPath(iconPath);

    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1200,
      minHeight: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      titleBarStyle: 'default',
      show: false,
      title: 'DB-CLIENT',
      icon: icon
    });

    if (process.env.NODE_ENV === 'development') {
      this.mainWindow.loadURL('http://localhost:3000');
      this.mainWindow.webContents.openDevTools();
    } else {
      // 确保加载dist目录下的index.html
      const indexPath = path.resolve(__dirname, '../dist/index.html');
      this.mainWindow.loadFile(indexPath);
    }

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
    });
  }

  private createMenu(): void {
    // 隐藏应用程序菜单
    Menu.setApplicationMenu(null);
  }

  private setupIpcHandlers(): void {
    // 连接存储相关处理器
    ipcMain.handle('get-all-connections', async () => {
      return await this.handleGetAllConnections();
    });

    ipcMain.handle('save-connection', async (event, connection) => {
      return await this.handleSaveConnection(connection);
    });

    ipcMain.handle('delete-connection', async (event, connectionId) => {
      return await this.handleDeleteConnection(connectionId);
    });

    // 数据库连接相关处理器
    ipcMain.handle('connect-database', async (event, config) => {
      return await this.handleDatabaseConnection(config);
    });

    ipcMain.handle('disconnect-database', async (event, connectionId) => {
      return await this.handleDatabaseDisconnection(connectionId);
    });

    ipcMain.handle('execute-query', async (event, { connectionId, query, params }) => {
      return await this.handleQueryExecution(connectionId, query, params);
    });

    ipcMain.handle('get-database-info', async (event, connectionId) => {
      return await this.handleGetDatabaseInfo(connectionId);
    });

    ipcMain.handle('get-table-structure', async (event, { connectionId, tableName }) => {
      return await this.handleGetTableStructure(connectionId, tableName);
    });

    ipcMain.handle('list-tables', async (event, connectionId) => {
      return await this.handleListTables(connectionId);
    });

    ipcMain.handle('list-databases', async (event, connectionId) => {
      return await this.handleListDatabases(connectionId);
    });

    // 连接测试处理器
    ipcMain.handle('test-connection', async (event, config) => {
      return await this.handleTestConnection(config);
    });

    // 关闭测试连接池处理器
    ipcMain.handle('close-test-connection', async (event, config) => {
      return await this.handleCloseTestConnection(config);
    });
  }

  private async handleDatabaseConnection(config: any): Promise<any> {
    try {
      const connectionId = await this.databaseService.createConnectionPool(config);
      
      // 更新连接状态为已连接
      if (config.id) {
        await this.connectionStoreService.updateConnectionStatus(config.id, true);
      }
      
      return { 
        success: true, 
        message: '连接成功',
        connectionId: connectionId
      };
    } catch (error) {
      return { 
        success: false, 
        message: (error as Error).message 
      };
    }
  }

  private async handleGetAllConnections(): Promise<any> {
    try {
      const connections = await this.connectionStoreService.getAllConnections();
      return { success: true, connections };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  private async handleSaveConnection(connection: any): Promise<any> {
    try {
      await this.connectionStoreService.saveConnection(connection);
      return { success: true, message: '连接保存成功' };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  private async handleDeleteConnection(connectionId: string): Promise<any> {
    try {
      // 先断开连接（如果存在）
      try {
        await this.databaseService.disconnect(connectionId);
      } catch (disconnectError) {
        console.debug('断开连接失败，但继续删除操作:', disconnectError);
      }
      
      await this.connectionStoreService.deleteConnection(connectionId);
      return { success: true, message: '连接删除成功' };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  private async handleDatabaseDisconnection(connectionId: string): Promise<any> {
    try {
      await this.databaseService.disconnect(connectionId);
      
      // 更新连接状态为未连接
      await this.connectionStoreService.updateConnectionStatus(connectionId, false);
      
      return { success: true, message: '断开连接成功' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, message: errorMessage };
    }
  }

  private async handleQueryExecution(connectionId: string, query: string, params?: any[]): Promise<any> {
    try {
      const result = await this.databaseService.executeQuery(connectionId, query, params);
      return result;
    } catch (error: any) {
      return { success: false, message: error.message };
    }
  }

  private async handleGetDatabaseInfo(connectionId: string): Promise<any> {
    try {
      const info = await this.databaseService.getDatabaseInfo(connectionId);
      return { success: true, info };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  private async handleGetTableStructure(connectionId: string, tableName: string): Promise<any> {
    try {
      const structure = await this.databaseService.getTableStructure(connectionId, tableName);
      return { success: true, structure };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  private async handleListTables(connectionId: string): Promise<any> {
    try {
      const tables = await this.databaseService.listTables(connectionId);
      return { success: true, tables };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  private async handleListDatabases(connectionId: string): Promise<any> {
    try {
      const databases = await this.databaseService.listDatabases(connectionId);
      return { success: true, data: databases };
    } catch (error) {
      return { success: false, message: (error as Error).message };
    }
  }

  private async handleTestConnection(config: any): Promise<any> {
    let poolId: string | undefined;
    // 与DatabaseService.ts中generatePoolId方法保持一致的ID生成逻辑
    const databaseName = config.database || (config.type === 'postgresql' ? 'postgres' : '');
    const generatedPoolId = `${config.type}_${config.host}_${config.port}_${databaseName}`;
    
    try {
      // 记录连接参数（不记录密码）以帮助诊断
      console.log('开始测试数据库连接:', {
        type: config.type,
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.username,
        timeout: config.timeout,
        ssl: config.ssl
      });

      // 使用连接池测试连接 - 增加超时时间，改进测试连接配置
      console.log('正在创建连接池...');
      poolId = await this.databaseService.createConnectionPool(config, {
        maxConnections: 2, // 增加一个连接以避免单点问题
        minConnections: 1,
        acquireTimeout: 60000, // 增加到60秒以适应较慢的连接
        idleTimeout: 30000,
        testOnBorrow: true
      });

      console.log('连接池创建成功，准备执行测试查询...');
      // 根据数据库类型选择适合的测试查询语句
      let testQuery = 'SELECT 1 as test_value';
      if (config.type === 'postgresql' && !config.database) {
        // PostgreSQL在没有指定数据库时使用'postgres'作为默认数据库
        config.database = 'postgres';
      }

      const result = await this.databaseService.executeQuery(poolId, testQuery);

      console.log('连接测试成功，查询结果:', result);
      return { 
        success: true, 
        message: '连接测试成功',
        data: result
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : '';
      // 记录详细的错误信息到控制台
      console.error('连接测试失败:', errorMessage);
      console.error('错误堆栈:', errorStack);
      
      // 提供更详细的错误信息和建议
      let detailedMessage = errorMessage;
      if (errorMessage.includes('获取连接超时')) {
        if (config.type === 'postgresql') {
          detailedMessage = '连接PostgreSQL数据库超时：请检查网络连接、防火墙设置、数据库服务器状态以及连接配置是否正确。\n\n可能的解决方案：\n1. 确认PostgreSQL服务器正在运行并监听指定端口（默认5432）\n2. 检查防火墙设置是否允许连接\n3. 验证主机名、端口、用户名、密码和数据库名是否正确\n4. 确认PostgreSQL用户有足够的权限\n5. 检查网络连接稳定性';
        } else {
          detailedMessage = '连接数据库超时：请检查网络连接、防火墙设置、数据库服务器状态以及连接配置是否正确。\n\n可能的解决方案：\n1. 确认MySQL服务器正在运行并监听指定端口\n2. 检查防火墙设置是否允许连接\n3. 验证主机名、端口、用户名、密码和数据库名是否正确\n4. 确认MySQL用户有足够的权限\n5. 检查网络连接稳定性';
        }
      } else if (errorMessage.includes('连接池已存在')) {
        detailedMessage = '连接池已存在：正在清理残留连接，请稍后重试。';
      }
      
      return { 
        success: false, 
        error: detailedMessage 
      };
    } finally {
      // 无论成功与否，都尝试断开连接池
      try {
        console.log('正在清理测试连接池...');
        // 优先使用实际创建的poolId，如果没有则使用生成的poolId
        await this.databaseService.disconnect(poolId || generatedPoolId);
        console.log('测试连接池清理完成');
      } catch (disconnectError) {
        console.debug('断开测试连接池失败:', disconnectError);
        // 静默忽略断开错误，不影响测试结果
      }
    }
  }

  private async handleCloseTestConnection(config: any): Promise<any> {
    try {
      // 与DatabaseService.ts中generatePoolId方法保持一致的ID生成逻辑
      const databaseName = config.database || (config.type === 'postgresql' ? 'postgres' : '');
      const poolId = `${config.type}_${config.host}_${config.port}_${databaseName}`;
      
      // 检查连接池是否存在并断开
      await this.databaseService.disconnect(poolId);
      
      return { 
        success: true, 
        message: '测试连接池已关闭'
      };
    } catch (error) {
      return { 
        success: false, 
        message: (error as Error).message 
      };
    }
  }
}

new DBClientApp();