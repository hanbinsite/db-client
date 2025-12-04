import * as fs from 'fs';
import * as path from 'path';
import { app, ipcMain } from 'electron';
import { DatabaseConnection } from '../../renderer/types';
import { DatabaseService } from './DatabaseService';

// 连接状态检查间隔（毫秒）
const CONNECTION_STATUS_CHECK_INTERVAL = 30000;

/**
 * 连接存储服务 - 负责管理数据库连接信息的持久化存储
 */
export class ConnectionStoreService {
  private storeFilePath: string;
  private connections: DatabaseConnection[] = [];
  private isLoaded: boolean = false;
  private statusCheckTimer: NodeJS.Timeout | null = null;
  private databaseService: DatabaseService;

  constructor() {
    // 检查是否运行在便携模式
    let isPortable = false;
    let appDirectory = '';
    
    // 方法1：检查exe所在目录下的portable.ini
    const exePath = app.getPath('exe');
    const exeDir = path.dirname(exePath);
    const exePortablePath = path.join(exeDir, 'portable.ini');
    
    // 方法2：检查应用根目录下的portable.ini（针对开发模式和打包后的目录结构）
    const appRootPath = app.isPackaged ? exeDir : process.cwd();
    const rootPortablePath = path.join(appRootPath, 'portable.ini');
    
    // 方法3：检查win-unpacked目录下的portable.ini
    const winUnpackedPortablePath = path.join(path.dirname(appRootPath), 'portable.ini');
    
    // 检查上述三个位置
    isPortable = fs.existsSync(exePortablePath) || fs.existsSync(rootPortablePath) || fs.existsSync(winUnpackedPortablePath);
    
    // 确定应用目录
    if (isPortable) {
      // 便携模式下，使用存在portable.ini的目录
      if (fs.existsSync(exePortablePath)) {
        appDirectory = exeDir;
      } else if (fs.existsSync(rootPortablePath)) {
        appDirectory = appRootPath;
      } else {
        appDirectory = path.dirname(appRootPath);
      }
    } else {
      // 非便携模式下，使用默认应用目录
      appDirectory = app.getPath('userData');
    }
    
    console.log(`Portable mode: ${isPortable}`);
    console.log(`App directory: ${appDirectory}`);
    console.log(`Check portable paths: ${exePortablePath} (${fs.existsSync(exePortablePath)}), ${rootPortablePath} (${fs.existsSync(rootPortablePath)}), ${winUnpackedPortablePath} (${fs.existsSync(winUnpackedPortablePath)})`);
    
    // 获取应用的数据目录
    let userDataPath = isPortable ? appDirectory : app.getPath('userData');
    
    console.log(`UserData path: ${userDataPath}`);
    
    // 确保目录存在
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    // 设置存储文件路径
    this.storeFilePath = path.join(userDataPath, 'connections.json');
    
    console.log(`Store file path: ${this.storeFilePath}`);
    
    // 初始化数据库服务
    this.databaseService = new DatabaseService();
    
    // 启动连接状态检查定时器
    this.startStatusCheckTimer();
    
    // 监听主进程退出事件，清理定时器
    app.on('before-quit', () => {
      this.stopStatusCheckTimer();
    });
  }
  
  /**
   * 启动连接状态检查定时器
   */
  private startStatusCheckTimer(): void {
    if (this.statusCheckTimer) {
      this.stopStatusCheckTimer();
    }
    
    this.statusCheckTimer = setInterval(async () => {
      await this.checkAllConnectionsStatus();
    }, CONNECTION_STATUS_CHECK_INTERVAL);
    
    console.log(`Connection status check timer started, interval: ${CONNECTION_STATUS_CHECK_INTERVAL}ms`);
  }
  
  /**
   * 停止连接状态检查定时器
   */
  private stopStatusCheckTimer(): void {
    if (this.statusCheckTimer) {
      clearInterval(this.statusCheckTimer);
      this.statusCheckTimer = null;
      console.log('Connection status check timer stopped');
    }
  }
  
  /**
   * 检查所有连接的状态
   */
  private async checkAllConnectionsStatus(): Promise<void> {
    try {
      await this.loadConnections();
      
      for (const connection of this.connections) {
        if (connection.isConnected) {
          await this.checkConnectionStatus(connection);
        }
      }
    } catch (error) {
      console.error('检查连接状态失败:', error);
    }
  }
  
  /**
   * 检查单个连接的状态
   */
  private async checkConnectionStatus(connection: DatabaseConnection): Promise<void> {
    try {
      // 使用DatabaseService测试连接，转换authType类型
      const connectionConfig = {
        ...connection,
        authType: connection.authType === 'none' ? undefined : connection.authType
      };
      
      const isConnected = await this.databaseService.testConnection(connectionConfig);
      
      if (connection.isConnected !== isConnected) {
        await this.updateConnectionStatus(connection.id, isConnected);
        console.log(`Connection ${connection.name} status changed to ${isConnected ? 'connected' : 'disconnected'}`);
      }
    } catch (error) {
      console.error(`检查连接 ${connection.name} 状态失败:`, error);
      // 如果检查失败，将连接状态设置为断开
      if (connection.isConnected) {
        await this.updateConnectionStatus(connection.id, false);
      }
    }
  }

  /**
   * 从文件加载连接列表
   */
  private async loadConnections(): Promise<void> {
    try {
      if (fs.existsSync(this.storeFilePath)) {
        const data = await fs.promises.readFile(this.storeFilePath, 'utf-8');
        this.connections = JSON.parse(data);
        // 确保连接对象包含所有必要的字段
        this.connections = this.connections.map(conn => ({
          ...conn,
          isConnected: conn.isConnected || false,
          lastConnectTime: conn.lastConnectTime ? new Date(conn.lastConnectTime) : undefined
        }));
      } else {
        // 如果文件不存在，初始化一个默认连接列表
        this.connections = this.getDefaultConnections();
        await this.saveConnections();
      }
    } catch (error) {
      console.error('加载连接列表失败:', error);
      // 出错时使用默认连接
      this.connections = this.getDefaultConnections();
    }
  }

  /**
   * 将连接列表保存到文件
   */
  private async saveConnections(): Promise<void> {
    try {
      // 转换Date对象为字符串，便于JSON序列化
      const connectionsToSave = this.connections.map(conn => ({
        ...conn,
        lastConnectTime: conn.lastConnectTime ? conn.lastConnectTime.toISOString() : undefined
      }));
      await fs.promises.writeFile(
        this.storeFilePath,
        JSON.stringify(connectionsToSave, null, 2),
        'utf-8'
      );
      console.log(`Saved connections to: ${this.storeFilePath}`);
    } catch (error) {
      console.error('保存连接列表失败:', error);
      throw new Error('保存连接列表失败');
    }
  }

  /**
   * 获取默认连接列表（当没有存储文件时使用）
   */
  private getDefaultConnections(): DatabaseConnection[] {
    return [
    ];
  }

  /**
   * 获取所有连接
   */
  public async getAllConnections(): Promise<DatabaseConnection[]> {
    await this.loadConnections();
    return [...this.connections]; // 返回副本，避免直接修改
  }

  /**
   * 添加或更新连接
   */
  public async saveConnection(connection: DatabaseConnection): Promise<void> {
    await this.loadConnections();
    
    const existingIndex = this.connections.findIndex(c => c.id === connection.id);
    
    if (existingIndex >= 0) {
      // 更新现有连接
      this.connections[existingIndex] = connection;
    } else {
      // 添加新连接
      this.connections.push(connection);
    }
    
    await this.saveConnections();
  }

  /**
   * 删除连接
   */
  public async deleteConnection(connectionId: string): Promise<void> {
    await this.loadConnections();
    
    const initialLength = this.connections.length;
    this.connections = this.connections.filter(c => c.id !== connectionId);
    
    if (this.connections.length !== initialLength) {
      await this.saveConnections();
    }
  }

  /**
   * 更新连接状态
   */
  public async updateConnectionStatus(connectionId: string, isConnected: boolean): Promise<void> {
    await this.loadConnections();
    
    const connection = this.connections.find(c => c.id === connectionId);
    if (connection) {
      connection.isConnected = isConnected;
      connection.lastConnectTime = new Date();
      await this.saveConnections();
      // 通知渲染器进程连接状态已更新
      const { ipcMain, BrowserWindow } = await import('electron');
      // 获取所有打开的浏览器窗口
      const windows = BrowserWindow.getAllWindows();
      // 向每个窗口发送连接状态变化事件
      windows.forEach(window => {
        if (window.webContents) {
          window.webContents.send('connection-status-changed', { connectionId, isConnected });
        }
      });
    }
  }
}