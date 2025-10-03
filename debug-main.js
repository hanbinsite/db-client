const { app, BrowserWindow } = require('electron');
const path = require('path');

console.log('=== 调试模式启动 ===');
console.log('当前目录:', __dirname);
console.log('进程环境:', process.env.NODE_ENV || 'production');

// 启用详细日志
app.commandLine.appendSwitch('enable-logging', 'stderr');

// 捕获未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
});

app.whenReady().then(() => {
  console.log('Electron应用已准备就绪');
  
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'dist/preload.js'),
      devTools: true // 始终启用开发者工具
    },
    title: '数据库客户端 - 调试模式'
  });

  // 加载URL并记录状态
  if (process.env.NODE_ENV === 'development') {
    console.log('开发模式，加载开发服务器: http://localhost:3000');
    mainWindow.loadURL('http://localhost:3000');
  } else {
    const indexPath = path.join(__dirname, 'dist/index.html');
    console.log('生产模式，加载文件:', indexPath);
    console.log('文件是否存在:', require('fs').existsSync(indexPath));
    mainWindow.loadFile(indexPath);
  }
  
  // 监听窗口事件以确认UI状态
  mainWindow.on('show', () => {
    console.log('窗口已显示');
  });
  
  mainWindow.on('hide', () => {
    console.log('窗口已隐藏');
  });
  
  mainWindow.on('move', () => {
    console.log('窗口位置改变:', mainWindow.getPosition());
  });
  
  // 检查窗口是否可见
  setTimeout(() => {
    console.log('窗口是否可见:', mainWindow.isVisible());
    console.log('窗口是否聚焦:', mainWindow.isFocused());
    console.log('窗口大小:', mainWindow.getSize());
  }, 5000);

  // 监听加载事件
  mainWindow.webContents.on('did-start-loading', () => {
    console.log('页面开始加载');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('页面加载完成');
  });

  mainWindow.webContents.on('dom-ready', () => {
    console.log('DOM已准备就绪');
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('页面加载失败:', errorCode, errorDescription);
  });

  // 监听渲染进程的控制台消息
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`渲染进程[${level}]: ${message} (${sourceId}:${line})`);
  });

  // 打开开发者工具
  mainWindow.webContents.openDevTools();

  // 窗口事件
  mainWindow.on('ready-to-show', () => {
    console.log('窗口准备显示');
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    console.log('窗口已关闭');
  });
});

app.on('window-all-closed', () => {
  console.log('所有窗口已关闭');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  console.log('应用被激活');
  if (BrowserWindow.getAllWindows().length === 0) {
    // 重新创建窗口
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
      
      const indexPath = path.join(__dirname, 'dist/index.html');
      mainWindow.loadFile(indexPath);
      mainWindow.webContents.openDevTools();
    });
  }
});

app.on('quit', () => {
  console.log('应用已退出');
});

console.log('=== 调试脚本初始化完成 ===');