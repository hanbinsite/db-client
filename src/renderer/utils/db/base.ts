import type { DatabaseConnection } from '../../types';

/**
 * 基础数据库工具类：提供通用的辅助方法。
 * 各具体数据库实现类可继承并复用这些方法。
 */
export class BaseDbUtils {
  /**
   * 包装调用，若检测到“连接池不存在”，尝试重新连接后重试。
   * 注意：不改变具体实现逻辑，仅提供公共复用工具。
   */
  protected async callWithReconnect<T>(connection: DatabaseConnection, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      const msg = String(error?.message || error || '');
      if (msg.includes('连接池不存在')) {
        try {
          const reconnect = await window.electronAPI?.connectDatabase(connection);
          if (reconnect && reconnect.success && reconnect.connectionId) {
            connection.connectionId = reconnect.connectionId;
            connection.isConnected = true;
            return await fn();
          }
        } catch (reErr) {
          console.error('重新建立连接失败:', reErr);
        }
      }
      throw error;
    }
  }
}