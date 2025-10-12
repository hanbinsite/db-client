import { contextBridge, ipcRenderer } from 'electron';

// 暴露安全的API给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 连接存储相关
  getAllConnections: () => ipcRenderer.invoke('get-all-connections'),
  saveConnection: (connection: any) => ipcRenderer.invoke('save-connection', connection),
  deleteConnection: (connectionId: string) => ipcRenderer.invoke('delete-connection', connectionId),
  
  // 数据库连接相关
  connectDatabase: (config: any) => ipcRenderer.invoke('connect-database', config),
  disconnectDatabase: (connectionId: string) => ipcRenderer.invoke('disconnect-database', connectionId),
  executeQuery: (connectionId: string, query: string, params?: any[]) => 
    ipcRenderer.invoke('execute-query', { connectionId, query, params }),
  getDatabaseInfo: (connectionId: string) => ipcRenderer.invoke('get-database-info', connectionId),
  getTableStructure: (connectionId: string, tableName: string) => 
    ipcRenderer.invoke('get-table-structure', { connectionId, tableName }),
  listTables: (connectionId: string) => ipcRenderer.invoke('list-tables', connectionId),
  listDatabases: (connectionId: string) => ipcRenderer.invoke('list-databases', connectionId),
  
  // 连接测试
  testConnection: (config: any) => ipcRenderer.invoke('test-connection', config),
  closeTestConnection: (config: any) => ipcRenderer.invoke('close-test-connection', config),
  
  // 菜单事件监听
  onMenuNewConnection: (callback: () => void) => {
    ipcRenderer.on('menu-new-connection', callback);
  },
  
  // 移除监听器
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
  
  // 导出功能
  exportQueryResult: (connectionId: string, query: string, format: string) => 
    ipcRenderer.invoke('export-query-result', { connectionId, query, format }),
  exportTableData: (connectionId: string, tableName: string, format: string) => 
    ipcRenderer.invoke('export-table-data', { connectionId, tableName, format }),
  showSaveDialog: (defaultFileName: string, format: string) => 
    ipcRenderer.invoke('show-save-dialog', { defaultFileName, format }),
  writeExportFile: (filePath: string, data: any, format: string, dbType?: string) =>
    ipcRenderer.invoke('write-export-file', { filePath, data, format, dbType })
});

// 类型定义在 src/renderer/types.ts 中