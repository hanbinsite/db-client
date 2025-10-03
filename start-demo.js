const { app, BrowserWindow } = require('electron');
const path = require('path');

// 设置应用名称
app.setName('数据库客户端演示');

// 当Electron准备就绪时创建窗口
app.whenReady().then(() => {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'dist/preload.js')
    },
    title: '数据库客户端演示'
  });

  // 如果是开发模式，加载开发服务器
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // 否则加载打包后的HTML文件
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  // 窗口关闭事件
  mainWindow.on('closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
});

// 窗口全部关闭时的事件
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 在macOS上，当点击dock图标并且没有其他窗口打开时，创建新窗口
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    app.whenReady().then(() => {
      const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'dist/preload.js')
          }
      });

      if (process.env.NODE_ENV === 'development') {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
      } else {
        mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
      }
    });
  }
});