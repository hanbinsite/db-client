import { app, BrowserWindow, Menu, nativeImage, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseService } from './services/DatabaseService';
import { ConnectionStoreService } from './services/ConnectionStoreService';
import { autoUpdater } from 'electron-updater';
import { DatabaseConnectionFactory } from './services/DatabaseService';

class DBClientApp {
  private mainWindow: BrowserWindow | null = null;
  private databaseService: DatabaseService = new DatabaseService();
  private connectionStoreService: ConnectionStoreService = new ConnectionStoreService();

  constructor() {
    // 仅注册IPC处理器，窗口创建在app ready后进行
    this.setupIpcHandlers();

    app.on('ready', () => {
      this.setupApp();
      this.createMenu();
      this.initAutoUpdate();
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.setupApp();
      }
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });
  }

  private setupApp(): void {
    // 禁用自动可访问性检测，解决"Only a single encoding of text content should be cached"警告
    app.commandLine.appendSwitch('disable-features', 'RendererCodeIntegrity');
    
    // 为Windows设置应用程序用户模型ID，确保任务栏图标正确显示
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.dbclient.app');
    }
    
    // 确定图标路径并设置应用程序图标（按平台选择best格式）
    const iconBase = path.join(process.cwd(), 'assets', 'database-icon');
    const iconPath = process.platform === 'win32'
      ? (fs.existsSync(iconBase + '.ico') ? iconBase + '.ico' : (fs.existsSync(iconBase + '.png') ? iconBase + '.png' : iconBase + '.svg'))
      : (fs.existsSync(iconBase + '.icns') ? iconBase + '.icns' : (fs.existsSync(iconBase + '.png') ? iconBase + '.png' : iconBase + '.svg'));
    const icon = nativeImage.createFromPath(iconPath);

    // 避免重复创建窗口
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      return;
    }

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
      title: 'db-client',
      icon: icon,
      fullscreenable: true,
      autoHideMenuBar: false
    });

    if (process.env.NODE_ENV === 'development') {
      this.mainWindow.loadURL('http://localhost:3000');
      this.mainWindow.webContents.openDevTools();
    } else {
      // 确保加载dist目录下的index.html
      const indexPath = path.resolve(__dirname, '../dist/index.html');
      this.mainWindow.loadFile(indexPath);
    }

    // 捕获加载失败，避免空白窗口无信息
    this.mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      console.error('Renderer 加载失败:', { errorCode, errorDescription, validatedURL, isMainFrame });
    });

    this.mainWindow.webContents.on('did-finish-load', () => {
      console.log('Renderer 加载完成');
    });

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.maximize();
      this.mainWindow?.show();
    });
  }

  private createMenu(): void {
    // 隐藏应用程序菜单
    Menu.setApplicationMenu(null);
  }

  private initAutoUpdate(): void {
    try {
      if (!app.isPackaged) {
        return;
      }
      autoUpdater.autoDownload = true;
      autoUpdater.on('checking-for-update', () => {
        console.log('[AutoUpdate] 正在检查更新...');
      });
      autoUpdater.on('update-available', (info) => {
        console.log('[AutoUpdate] 发现可用更新:', info.version);
      });
      autoUpdater.on('update-not-available', () => {
        console.log('[AutoUpdate] 暂无更新');
      });
      autoUpdater.on('error', (err) => {
        console.error('[AutoUpdate] 更新错误:', (err && (err as any).message) ? (err as any).message : err);
      });
      autoUpdater.on('download-progress', (progress) => {
        console.log('[AutoUpdate] 下载进度:', Math.round(progress.percent), '%');
      });
      autoUpdater.on('update-downloaded', () => {
        console.log('[AutoUpdate] 更新下载完成，准备安装');
        autoUpdater.quitAndInstall();
      });
      autoUpdater.checkForUpdatesAndNotify();
    } catch (e) {
      console.error('[AutoUpdate] 初始化失败', e);
    }
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
        const dayjs = require('dayjs');
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
          // 使用xlsx库创建Excel文件，增加类型推断与统一格式
          const XLSX = require('xlsx');
          // dayjs 已在上方声明，可复用
          
          if (data && data.length > 0) {
            const headers = Object.keys(data[0]);
            
            // 列类型推断：number/date/boolean/string
            const inferColumnTypes = (rows: any[], headers: string[]) => {
              const types: Record<string, { type: 'number'|'date'|'boolean'|'string', format?: string }> = {};
              for (const header of headers) {
                let isNumber = true;
                let hasDecimal = false;
                let isBoolean = true;
                let isDate = true;
                let sawNonNull = false;
                let sawTime = false;
                
                for (let i = 0; i < Math.min(rows.length, 200); i++) {
                  const raw = rows[i][header];
                  if (raw === null || raw === undefined || raw === '') continue;
                  sawNonNull = true;
                  const valStr: any = typeof raw === 'string' ? raw.trim() : raw;
                  
                  // 先检查布尔
                  const boolLike = typeof valStr === 'boolean' || (typeof valStr === 'string' && (valStr.toLowerCase() === 'true' || valStr.toLowerCase() === 'false'));
                  if (!boolLike) isBoolean = false;
                  
                  // 检查数字
                  const num = Number(valStr);
                  if (isNaN(num)) {
                    isNumber = false;
                  } else {
                    if (!Number.isInteger(num)) hasDecimal = true;
                  }
                  
                  // 检查日期（支持yyyy-mm-dd、yyyy/mm/dd、yyyy-mm-dd HH:mm:ss）
                  if (typeof valStr === 'string') {
                    const datePatterns = [/^\d{4}[-/]\d{2}[-/]\d{2}$/];
                    const dateTimePatterns = [/^\d{4}[-/]\d{2}[-/]\d{2}\s+\d{2}:\d{2}:\d{2}$/];
                    if (!datePatterns.some((re: RegExp) => re.test(valStr)) && !dateTimePatterns.some((re: RegExp) => re.test(valStr))) {
                      isDate = false;
                    } else {
                      if (dateTimePatterns.some((re: RegExp) => re.test(valStr))) {
                        sawTime = true;
                      }
                    }
                  } else if (!(valStr instanceof Date)) {
                    isDate = false;
                  }
                }
                
                if (sawNonNull) {
                  if (isBoolean) types[header] = { type: 'boolean' };
                  else if (isDate) types[header] = { type: 'date', format: sawTime ? 'yyyy-mm-dd hh:mm:ss' : 'yyyy-mm-dd' };
                  else if (isNumber) types[header] = { type: 'number', format: hasDecimal ? '0.00' : '0' };
                  else types[header] = { type: 'string' };
                } else {
                  types[header] = { type: 'string' };
                }
              }
              return types;
            };
            
            const types = inferColumnTypes(data, headers);
            const worksheetData: any[] = [headers];
            
            for (const row of data) {
              const values = headers.map(header => {
                const t = types[header].type;
                const v = row[header];
                if (t === 'number') return Number(v);
                if (t === 'boolean') return (typeof v === 'boolean') ? v : String(v).toLowerCase() === 'true';
                if (t === 'date') return typeof v === 'string' ? new Date(v) : v;
                return v == null ? '' : String(v);
              });
              worksheetData.push(values);
            }
            
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.aoa_to_sheet(worksheetData);
            XLSX.utils.book_append_sheet(wb, ws, `导出_${dayjs().format('YYYYMMDD_HHmmss')}`);
            XLSX.writeFile(wb, filePath);
          }
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

    // 新增：批量执行（保持同一连接、对 MySQL 走串行队列原子化）
    ipcMain.handle('execute-batch', async (event, { connectionId, queries }) => {
      return await this.handleExecuteBatch(connectionId, queries);
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

    // Redis 发布/订阅：订阅与取消订阅
    ipcMain.handle('redis-subscribe', async (event, { connectionId, channels, isPattern }) => {
      try {
        const ok = await this.databaseService.redisSubscribe(connectionId, channels || [], !!isPattern);
        return { success: ok };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    });

    ipcMain.handle('redis-unsubscribe', async (event, { connectionId, channels, isPattern }) => {
      try {
        const ok = await this.databaseService.redisUnsubscribe(connectionId, channels || [], !!isPattern);
        return { success: ok };
      } catch (e: any) {
        return { success: false, error: e?.message || String(e) };
      }
    });

    // Redis 发布/订阅：主进程转发消息到渲染进程
    this.databaseService.on('redisPubSubMessage', (connectionId: string, channel: string, message: string) => {
      try {
        this.mainWindow?.webContents.send('redis-pubsub-message', { connectionId, channel, message, ts: Date.now() });
      } catch (e) {
        console.error('Failed to send redis-pubsub-message:', e);
      }
    });

    // 新增：获取连接池配置（用于渲染端动态并发）
    ipcMain.handle('get-connection-pool-config', async (event, connectionId) => {
      try {
        const cfg = this.databaseService.getConnectionPoolConfig(connectionId);
        if (cfg) return { success: true, config: cfg };
        return { success: false, message: '连接池不存在' };
      } catch (e: any) {
        return { success: false, message: e?.message || String(e) };
      }
    });

    // 连接测试处理器
    ipcMain.handle('test-connection', async (event, config) => {
      return await this.handleTestConnection(config);
    });

    // 关闭测试连接池处理器
    ipcMain.handle('close-test-connection', async (event, config) => {
      return await this.handleCloseTestConnection(config);
    });

    // 手动检查更新
    ipcMain.handle('check-for-updates', async () => {
      if (!app.isPackaged) {
        return { ok: false, message: '开发模式不检查更新' };
      }
      try {
        const result = await autoUpdater.checkForUpdates();
        return { ok: true, result };
      } catch (e: any) {
        return { ok: false, message: e?.message || String(e) };
      }
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

  // 新增：批量执行（保持同一连接、对 MySQL 走串行队列原子化）
  private async handleExecuteBatch(connectionId: string, queries: Array<{query: string, params?: any[]}>): Promise<any> {
    try {
      const results = await this.databaseService.executeBatch(connectionId, queries || []);
      return { success: true, results };
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
    try {
      // 验证配置
      const validation = DatabaseConnectionFactory.validateConnectionConfig(config);
      if (!validation.valid) {
        return { success: false, message: `配置验证失败: ${validation.errors.join(', ')}` };
      }
  
      // 使用临时连接进行测试，不创建或注册连接池
      const factory = new DatabaseConnectionFactory();
      const tempConn = factory.createConnection(config);
      await tempConn.connect();
      await tempConn.disconnect();
  
      return {
        success: true,
        message: '连接测试成功',
        data: { success: true }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, message: errorMessage, error: errorMessage };
    }
  }

  private async handleCloseTestConnection(config: any): Promise<any> {
    try {
      // 与DatabaseService.ts中generatePoolId方法保持一致的ID生成逻辑
      const databaseName = config.database || ''; // 不使用默认数据库名，只使用配置中指定的数据库名
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

// 启动应用
new DBClientApp();