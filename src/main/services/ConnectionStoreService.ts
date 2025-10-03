import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { DatabaseConnection } from '../../renderer/types';

/**
 * 连接存储服务 - 负责管理数据库连接信息的持久化存储
 */
export class ConnectionStoreService {
  private storeFilePath: string;
  private connections: DatabaseConnection[] = [];
  private isLoaded: boolean = false;

  constructor() {
    // 获取应用的数据目录
    const userDataPath = app.getPath('userData');
    // 确保目录存在
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }
    // 设置存储文件路径
    this.storeFilePath = path.join(userDataPath, 'connections.json');
  }

  /**
   * 从文件加载连接列表
   */
  private async loadConnections(): Promise<void> {
    if (this.isLoaded) {
      return;
    }

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
      this.isLoaded = true;
    } catch (error) {
      console.error('加载连接列表失败:', error);
      // 出错时使用默认连接
      this.connections = this.getDefaultConnections();
      this.isLoaded = true;
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
    }
  }
}