import { app, BrowserWindow, Menu, nativeImage, ipcMain, dialog } from 'electron';
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
    // 禁用自动可访问性检测，解决"Only a single encoding of text content should be cached"警告
    app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity');
    
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
        preload: path.join(process.cwd(), 'dist', 'preload.js')
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
    // 文件保存对话框处理器
    ipcMain.handle('show-save-dialog', async (event, options) => {
      try {
        // 构建保存对话框选项，确保默认文件名和过滤器正确设置
        const dialogOptions = {
          title: '导出数据',
          defaultPath: options.defaultFileName,
          filters: [
            {
              name: `${options.format.toUpperCase()}文件`,
              extensions: [options.format]
            }
          ],
          properties: ['createDirectory' as const, 'showOverwriteConfirmation' as const]
        };
        
        const result = await dialog.showSaveDialog(this.mainWindow!, dialogOptions);
        return result;
      } catch (error) {
        console.error('显示保存对话框失败:', error);
        return { canceled: true };
      }
    });

    // 导出查询结果处理器
    ipcMain.handle('export-query-result', async (event, { connectionId, query, format }) => {
      try {
        // 执行查询获取数据
        const result = await this.databaseService.executeQuery(connectionId, query);
        
        if (!result.success) {
          throw new Error(result.error || '查询执行失败');
        }
        
        return { success: true, data: result.data };
      } catch (error) {
        console.error('导出查询结果失败:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    // 文件写入处理器
    ipcMain.handle('write-export-file', async (event, { filePath, data, format, dbType }) => {
      try {
        // 确保目录存在
        const fs = require('fs');
        const path = require('path');
        const directory = path.dirname(filePath);
        
        if (!fs.existsSync(directory)) {
          fs.mkdirSync(directory, { recursive: true });
        }
        
        // 根据格式格式化数据并写入文件
        if (format === 'json') {
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        } else if (format === 'csv') {
          // 简单的CSV格式化，添加BOM头解决中文乱码问题
          if (data && data.length > 0) {
            const headers = Object.keys(data[0]);
            const csvRows = [headers.join(',')];
            
            for (const row of data) {
              const values = headers.map(header => {
                const value = row[header];
                // 处理包含逗号或引号的值
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                  return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
              });
              csvRows.push(values.join(','));
            }
            
            // 添加BOM头确保中文显示正常
            const csvContent = '\uFEFF' + csvRows.join('\n');
            fs.writeFileSync(filePath, csvContent, 'utf8');
          }
        } else if (format === 'xlsx') {
          // 使用xlsx库创建Excel文件
          const XLSX = require('xlsx');
          
          if (data && data.length > 0) {
            // 创建工作簿
            const workbook = XLSX.utils.book_new();
            
            // 转换数据为工作表
            const worksheet = XLSX.utils.json_to_sheet(data);
            
            // 添加工作表到工作簿
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
            
            // 生成Excel文件内容
            const excelBuffer = XLSX.write(workbook, {
              bookType: 'xlsx',
              type: 'buffer'
            });
            
            // 使用Node.js的fs写入文件
            fs.writeFileSync(filePath, excelBuffer);
          }
        } else if (format === 'sql') {
          // SQL格式处理：根据数据库类型生成INSERT语句
          if (data && data.length > 0) {
            const headers = Object.keys(data[0]);
            const baseName = path.basename(filePath, '.sql');
            // 解析文件名，将"database-table"格式转换为"database.table"格式
            const tableName = baseName.includes('-') ? baseName.replace('-', '.') : baseName;
            const sqlInserts: string[] = [];
            
            // 根据数据库类型选择合适的SQL语法
            for (const row of data) {
              const values = headers.map(header => {
                let value = row[header];
                
                // 处理NULL值
                if (value === null || value === undefined) {
                  return 'NULL';
                }
                
                // 根据数据库类型处理字符串值
                if (typeof value === 'string') {
                  // 转义单引号
                  value = value.replace(/'/g, "''");
                  
                  // 根据数据库类型添加引号
                  return `'${value}'`;
                }
                
                // 处理日期时间类型
                if (value instanceof Date) {
                  if (dbType === 'oracle' || dbType === 'gaussdb') {
                    return `TO_DATE('${value.toISOString().slice(0, 19).replace('T', ' ')}', 'YYYY-MM-DD HH24:MI:SS')`;
                  } else {
                    return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
                  }
                }
                
                // 处理布尔类型
                if (typeof value === 'boolean') {
                  if (dbType === 'mysql') {
                    return value ? '1' : '0';
                  } else if (dbType === 'postgresql' || dbType === 'gaussdb') {
                    return value ? 'TRUE' : 'FALSE';
                  } else {
                    return value ? '1' : '0';
                  }
                }
                
                // 其他类型直接返回
                return String(value);
              });
              
              // 生成INSERT语句
              let insertStatement = `INSERT INTO ${tableName} (${headers.join(', ')}) VALUES (${values.join(', ')});`;
              
              // 根据数据库类型添加特定语法
              if (dbType === 'postgresql' || dbType === 'gaussdb') {
                // PostgreSQL支持ON CONFLICT语法
                insertStatement += ' ON CONFLICT DO NOTHING';
              }
              
              sqlInserts.push(insertStatement);
            }
            
            // 合并所有INSERT语句并写入文件
            const sqlContent = sqlInserts.join('\n');
            fs.writeFileSync(filePath, sqlContent, 'utf8');
          }
        } else if (format === 'xml') {
          // XML格式处理：生成符合标准的XML文件
          if (data && data.length > 0) {
            // 获取根节点名称（从文件名推断）
            const baseName = path.basename(filePath, '.xml');
            const rootElement = baseName.includes('-') ? baseName.replace('-', '_') : baseName;
            const headers = Object.keys(data[0]);
            
            // 构建XML文档
            let xmlContent = '<?xml version="1.0" encoding="UTF-8"?>' + '\n';
            xmlContent += `<${rootElement}>` + '\n';
            
            // 遍历数据生成XML元素
            for (const row of data) {
              xmlContent += '  <record>' + '\n';
              
              for (const header of headers) {
                const value = row[header];
                const safeHeader = header.replace(/[^a-zA-Z0-9_]/g, '_');
                
                if (value === null || value === undefined) {
                  xmlContent += `    <${safeHeader} xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>` + '\n';
                } else if (typeof value === 'string') {
                  // 转义XML特殊字符
                  const escapedValue = value
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&apos;');
                  xmlContent += `    <${safeHeader}>${escapedValue}</${safeHeader}>` + '\n';
                } else if (value instanceof Date) {
                  xmlContent += `    <${safeHeader}>${value.toISOString()}</${safeHeader}>` + '\n';
                } else {
                  xmlContent += `    <${safeHeader}>${String(value)}</${safeHeader}>` + '\n';
                }
              }
              
              xmlContent += '  </record>' + '\n';
            }
            
            xmlContent += `</${rootElement}>`;
            
            // 写入XML文件
            fs.writeFileSync(filePath, xmlContent, 'utf8');
          }
        } else {
          // 默认为JSON格式
          fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        }
        
        return { success: true };
      } catch (error) {
        console.error('写入导出文件失败:', error);
        return { success: false, error: (error as Error).message };
      }
    });

    // 导出表数据处理器
    ipcMain.handle('export-table-data', async (event, { connectionId, tableName, format }) => {
      try {
        // 构建查询语句获取整个表的数据
        const query = `SELECT * FROM ${tableName}`;
        
        // 执行查询获取数据
        const result = await this.databaseService.executeQuery(connectionId, query);
        
        if (!result.success) {
          throw new Error(result.error || '查询执行失败');
        }
        
        // 这里返回查询结果，实际的文件保存逻辑由渲染进程处理
        return { success: true, data: result.data };
      } catch (error) {
        console.error('导出表数据失败:', error);
        return { success: false, error: (error as Error).message };
      }
    });

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
    const databaseName = config.database || 
      (config.type === 'postgresql' ? 'postgres' : 
       (config.type === 'mysql' ? 'performance_schema' : ''));
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

      // 首先检查连接池是否已经存在
      if (this.databaseService.getConnectionPool(generatedPoolId)) {
        console.log('连接池已存在，直接使用现有连接池进行测试');
        poolId = generatedPoolId;
      } else {
        // 使用连接池测试连接 - 增加超时时间，改进测试连接配置
        console.log('正在创建连接池...');
        poolId = await this.databaseService.createConnectionPool(config, {
          maxConnections: 2, // 增加一个连接以避免单点问题
          minConnections: 1,
          acquireTimeout: 60000, // 增加到60秒以适应较慢的连接
          idleTimeout: 30000,
          testOnBorrow: true
        });
      }

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