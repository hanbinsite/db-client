/**
 * 查询历史记录接口
 */
export interface QueryHistoryItem {
  id: string;
  query: string;
  connectionId: string;
  connectionName: string;
  databaseType: string;
  databaseName: string;
  executedAt: Date;
  resultCount: number;
  executionTime: number;
  isFavorite: boolean;
  success: boolean;
}

/**
 * 查询历史服务
 */
export class QueryHistoryService {
  private db: IDBDatabase | null = null;
  private readonly DB_NAME = 'queryHistoryDB';
  private readonly STORE_NAME = 'queryHistory';
  private readonly DB_VERSION = 1;

  /**
   * 初始化数据库
   */
  private async initDB(): Promise<IDBDatabase> {
    if (this.db) {
      return this.db;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // 创建对象存储
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          const store = db.createObjectStore(this.STORE_NAME, {
            keyPath: 'id',
            autoIncrement: true
          });
          
          // 创建索引
          store.createIndex('connectionId', 'connectionId', { unique: false });
          store.createIndex('databaseType', 'databaseType', { unique: false });
          store.createIndex('executedAt', 'executedAt', { unique: false });
          store.createIndex('isFavorite', 'isFavorite', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });
  }

  /**
   * 添加查询历史记录
   */
  async addHistoryItem(item: Omit<QueryHistoryItem, 'id'>): Promise<QueryHistoryItem> {
    const db = await this.initDB();
    const historyItem: QueryHistoryItem = {
      ...item,
      id: `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.add(historyItem);

      request.onsuccess = () => {
        resolve(historyItem);
      };

      request.onerror = (event) => {
        reject((event.target as IDBRequest).error);
      };
    });
  }

  /**
   * 获取查询历史记录
   */
  async getHistoryItems(limit: number = 100, offset: number = 0): Promise<QueryHistoryItem[]> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const index = store.index('executedAt');
      const request = index.getAll(undefined, limit);

      request.onsuccess = () => {
        resolve((request.result as QueryHistoryItem[]).reverse());
      };

      request.onerror = (event) => {
        reject((event.target as IDBRequest).error);
      };
    });
  }

  /**
   * 根据连接ID获取查询历史记录
   */
  async getHistoryItemsByConnection(connectionId: string): Promise<QueryHistoryItem[]> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const index = store.index('connectionId');
      const request = index.getAll(connectionId);

      request.onsuccess = () => {
        resolve((request.result as QueryHistoryItem[]).reverse());
      };

      request.onerror = (event) => {
        reject((event.target as IDBRequest).error);
      };
    });
  }

  /**
   * 根据数据库类型获取查询历史记录
   */
  async getHistoryItemsByDatabaseType(databaseType: string): Promise<QueryHistoryItem[]> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const index = store.index('databaseType');
      const request = index.getAll(databaseType);

      request.onsuccess = () => {
        resolve((request.result as QueryHistoryItem[]).reverse());
      };

      request.onerror = (event) => {
        reject((event.target as IDBRequest).error);
      };
    });
  }

  /**
   * 获取收藏的查询历史记录
   */
  async getFavoriteHistoryItems(): Promise<QueryHistoryItem[]> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readonly');
      const store = transaction.objectStore(this.STORE_NAME);
      const index = store.index('isFavorite');
      const request = index.openCursor(IDBKeyRange.only(1)); // 使用1代替true，因为IndexedDB中布尔值索引会被转换为0和1

      const favoriteItems: QueryHistoryItem[] = [];

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          favoriteItems.push(cursor.value as QueryHistoryItem);
          cursor.continue();
        } else {
          resolve(favoriteItems.reverse());
        }
      };

      request.onerror = (event) => {
        reject((event.target as IDBRequest).error);
      };
    });
  }

  /**
   * 更新查询历史记录的收藏状态
   */
  async toggleFavorite(id: string): Promise<void> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const item = getRequest.result as QueryHistoryItem;
        if (item) {
          item.isFavorite = !item.isFavorite;
          const updateRequest = store.put(item);
          updateRequest.onsuccess = () => resolve();
          updateRequest.onerror = (event) => reject((event.target as IDBRequest).error);
        } else {
          resolve();
        }
      };

      getRequest.onerror = (event) => {
        reject((event.target as IDBRequest).error);
      };
    });
  }

  /**
   * 删除查询历史记录
   */
  async deleteHistoryItem(id: string): Promise<void> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject((event.target as IDBRequest).error);
    });
  }

  /**
   * 清空查询历史记录
   */
  async clearHistory(): Promise<void> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject((event.target as IDBRequest).error);
    });
  }

  /**
   * 导出查询历史记录
   */
  async exportHistory(): Promise<QueryHistoryItem[]> {
    return this.getHistoryItems(1000); // 导出最近1000条记录
  }

  /**
   * 导入查询历史记录
   */
  async importHistory(items: QueryHistoryItem[]): Promise<void> {
    const db = await this.initDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.STORE_NAME, 'readwrite');
      const store = transaction.objectStore(this.STORE_NAME);

      let count = 0;
      const total = items.length;

      const addItem = (item: QueryHistoryItem) => {
        const request = store.add({
          ...item,
          id: `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}` // 生成新ID，避免冲突
        });

        request.onsuccess = () => {
          count++;
          if (count < total) {
            addItem(items[count]);
          } else {
            resolve();
          }
        };

        request.onerror = (event) => {
          reject((event.target as IDBRequest).error);
        };
      };

      if (total > 0) {
        addItem(items[0]);
      } else {
        resolve();
      }
    });
  }
}

// 创建单例实例
export const queryHistoryService = new QueryHistoryService();
