import { app, BrowserWindow, Menu, nativeImage, ipcMain, dialog } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseService } from './services/DatabaseService';
import { ConnectionStoreService } from './services/ConnectionStoreService';
import { autoUpdater } from 'electron-updater';

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
    
    // 确定图标路径并设置应用程序图标（按平台选择best格式）
    const iconBase = path.join(process.cwd(), 'assets', 'database-icon');
    const iconPath = process.platform === 'win32'
      ? (fs.existsSync(iconBase + '.ico') ? iconBase + '.ico' : (fs.existsSync(iconBase + '.png') ? iconBase + '.png' : iconBase + '.svg'))
      : (fs.existsSync(iconBase + '.icns') ? iconBase + '.icns' : (fs.existsSync(iconBase + '.png') ? iconBase + '.png' : iconBase + '.svg'));
    const appIcon = nativeImage.createFromPath(iconPath);
    app.dock?.setIcon(appIcon); // macOS
    
    app.whenReady().then(() => {
      this.createMainWindow();
      this.createMenu();
      this.initAutoUpdate();
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
    // 确定图标路径 - 使用绝对路径确保正确加载（按平台选择best格式）
    const iconBase = path.join(process.cwd(), 'assets', 'database-icon');
    const iconPath = process.platform === 'win32'
      ? (fs.existsSync(iconBase + '.ico') ? iconBase + '.ico' : (fs.existsSync(iconBase + '.png') ? iconBase + '.png' : iconBase + '.svg'))
      : (fs.existsSync(iconBase + '.icns') ? iconBase + '.icns' : (fs.existsSync(iconBase + '.png') ? iconBase + '.png' : iconBase + '.svg'));
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
                  
                  // 数字检测
                  const num = typeof valStr === 'number' ? valStr : parseFloat(valStr);
                  const numOk = typeof num === 'number' && isFinite(num) && !(typeof valStr === 'string' && valStr === '');
                  if (!numOk) {
                    isNumber = false;
                  } else {
                    if (String(valStr).includes('.')) hasDecimal = true;
                  }
                  
                  // 日期检测：常见格式用 dayjs 解析
                  let dateOk = false;
                  if ((valStr as any) instanceof Date) {
                    dateOk = true;
                    if (valStr.getHours() || valStr.getMinutes() || valStr.getSeconds()) sawTime = true;
                  } else if (typeof valStr === 'string') {
                    const candidates = [
                      'YYYY-MM-DD',
                      'YYYY/MM/DD',
                      'YYYY-MM-DD HH:mm:ss',
                      'YYYY/MM/DD HH:mm:ss'
                    ];
                    // 宽松：允许 dayjs 自动解析 ISO/UTC
                    const d = dayjs(valStr);
                    if (d.isValid()) {
                      dateOk = true;
                      if (!(valStr.length <= 10)) sawTime = true; // 粗略判断是否包含时间
                    } else {
                      // 尝试指定格式
                      for (const fmt of candidates) {
                        const dd = dayjs(valStr, fmt, true);
                        if (dd.isValid()) { dateOk = true; if (fmt.includes('HH')) sawTime = true; break; }
                      }
                    }
                  } else if (typeof valStr === 'number') {
                    // Excel序列或时间戳（毫秒级）不强行当日期
                    dateOk = false;
                  }
                  if (!dateOk) isDate = false;
                  
                  // 早停优化
                  if (!isNumber && !isBoolean && !isDate) break;
                }
                
                if (!sawNonNull) {
                  types[header] = { type: 'string' };
                } else if (isBoolean) {
                  types[header] = { type: 'boolean' };
                } else if (isDate) {
                  types[header] = { type: 'date', format: sawTime ? 'yyyy-mm-dd hh:mm:ss' : 'yyyy-mm-dd' };
                } else if (isNumber) {
                  types[header] = { type: 'number', format: hasDecimal ? '0.00' : '0' };
                } else {
                  types[header] = { type: 'string' };
                }
              }
              return types;
            };
            
            const columnTypes = inferColumnTypes(data, headers);
            
            // 构建 AOA（数组的数组）：首行表头，其后数据行
            const aoa: any[][] = [headers];
            for (const row of data) {
              const line = headers.map(h => row[h]);
              aoa.push(line);
            }
            
            // 创建工作簿与工作表
            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.aoa_to_sheet(aoa);
            
            // 应用每列的类型和格式
            for (let c = 0; c < headers.length; c++) {
              const header = headers[c];
              const colType = columnTypes[header];
              for (let r = 1; r < aoa.length; r++) { // 从第2行开始是数据
                const addr = XLSX.utils.encode_cell({ c, r });
                const cell = worksheet[addr];
                if (!cell) continue; // 空单元格
                const raw: any = aoa[r][c];
                
                if (colType.type === 'date') {
                  // 将可解析日期转为 Date 并设置格式
                  let d: Date | null = null;
                  if ((raw as any) instanceof Date) {
                    d = raw as Date;
                  } else if (typeof raw === 'string') {
                    const parsed = dayjs(raw);
                    d = parsed.isValid() ? parsed.toDate() : null;
                  }
                  if (d) {
                    cell.v = d;
                    cell.t = 'd';
                    cell.z = colType.format || 'yyyy-mm-dd hh:mm:ss';
                  } else {
                    // 保留为字符串
                    cell.v = raw == null ? '' : String(raw);
                    cell.t = 's';
                  }
                } else if (colType.type === 'number') {
                  const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
                  if (typeof num === 'number' && isFinite(num)) {
                    cell.v = num;
                    cell.t = 'n';
                    cell.z = colType.format || '0';
                  } else {
                    cell.v = raw == null ? '' : String(raw);
                    cell.t = 's';
                  }
                } else if (colType.type === 'boolean') {
                  let b: boolean | null = null;
                  if (typeof raw === 'boolean') b = raw;
                  else if (typeof raw === 'string') {
                    const s = raw.toLowerCase();
                    if (s === 'true') b = true; else if (s === 'false') b = false;
                  }
                  if (b === null) {
                    cell.v = raw == null ? '' : String(raw);
                    cell.t = 's';
                  } else {
                    cell.v = b;
                    cell.t = 'b';
                  }
                } else {
                  cell.v = raw == null ? '' : String(raw);
                  cell.t = 's';
                }
                worksheet[addr] = cell;
              }
            }
            
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
                  return `'${String(value).replace(/'/g, "''")}'`;
                }
                
                if (typeof value === 'number') {
                  return String(value);
                }
                
                if (typeof value === 'boolean') {
                  return value ? (dbType === 'postgresql' ? 'TRUE' : '1') : (dbType === 'postgresql' ? 'FALSE' : '0');
                }
                
                if ((value as any) instanceof Date) {
                  const formatted = dayjs(value).format('YYYY-MM-DD HH:mm:ss');
                  return `'${formatted}'`;
                }
                
                // 其他类型统一转字符串
                return `'${String(value)}'`;
              });
              
              const sql = `INSERT INTO ${tableName} (${headers.map(h => `\`${h}\``).join(', ')}) VALUES (${values.join(', ')});`;
              sqlInserts.push(sql);
            }
            
            fs.writeFileSync(filePath, sqlInserts.join('\n'), 'utf8');
          }
        }
        
        return { success: true };
      } catch (error) {
        console.error('文件写入失败:', error);
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
    let testResult: any = null;
    // 与DatabaseService.ts中generatePoolId方法保持一致的ID生成逻辑
    const databaseName = config.database || ''; // 不使用默认数据库名，只使用配置中指定的数据库名
    const generatedPoolId = `${config.type}_${config.host}_${config.port}_${databaseName}`;
    
    try {
      // 记录连接参数（包含密码以帮助调试）
      console.log('开始测试数据库连接:', {
        type: config.type,
        host: config.host,
        port: config.port,
        database: config.database,
        username: config.username,
        password: config.password,
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

      console.log('连接池创建成功，立即返回测试成功，不再执行测试查询');
      testResult = { 
        success: true, 
        message: '连接测试成功',
        data: { success: true }
      };
      return testResult;
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
      
      testResult = { 
        success: false, 
        error: detailedMessage 
      };
      return testResult;
    } finally {
      // 只在测试失败时断开连接池，测试成功时保留连接池以便应用程序使用
      if (!testResult || !testResult.success) {
        try {
          console.log('测试失败，正在清理测试连接池...');
          // 优先使用实际创建的poolId，如果没有则使用生成的poolId
          await this.databaseService.disconnect(poolId || generatedPoolId);
          console.log('测试连接池清理完成');
        } catch (disconnectError) {
          console.debug('断开测试连接池失败:', disconnectError);
          // 静默忽略断开错误，不影响测试结果
        }
      } else {
        console.log('测试成功，保留连接池以便应用程序使用');
      }
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

new DBClientApp();