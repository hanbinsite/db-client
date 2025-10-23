import React from 'react';
// 为浏览器环境提供全局global对象
(window as any).global = window;

import ReactDOM from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';

import './index.css';

console.log('==================================================================');
console.log('DATABASE CLIENT APPLICATION STARTING...');
console.log('Time:', new Date().toLocaleString());
console.log('==================================================================');

// 立即尝试输出一些基本信息
console.log('React version:', React.version);
console.log('Window object exists:', typeof window !== 'undefined');
console.log('Document object exists:', typeof document !== 'undefined');
console.log('Root element exists:', document.getElementById('root') ? 'Yes' : 'No');

// 简易错误边界，避免渲染异常导致空白页
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
  constructor(props: any) {
    super(props);
    this.state = { error: undefined };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: any) {
    console.error('Renderer ErrorBoundary 捕获到异常:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
          <h2>页面渲染出现异常</h2>
          <p style={{ color: '#a00' }}>{this.state.error.message}</p>
          <pre style={{ background: '#f7f7f7', padding: 12 }}>
            {this.state.error.stack}
          </pre>
          {!('electronAPI' in window) && (
            <p style={{ marginTop: 12, color: '#666' }}>
              提示：未检测到 <code>window.electronAPI</code>，请确认预加载脚本是否正常。
            </p>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <ConfigProvider locale={zhCN}>
        <App />
      </ConfigProvider>
    </ErrorBoundary>
  </React.StrictMode>
);

console.log('App rendered to DOM');
console.log('==================================================================');
console.log('Renderer root mounted');

// 移除启动时自动测试和创建连接池的调试代码，改为仅在用户交互时建立连接
// 保持渲染进程启动轻量，不进行任何隐式连接或查询

// 移除启动时自动测试和创建连接池的调试代码，改为仅在用户交互时建立连接
// 保持渲染进程启动轻量，不进行任何隐式连接或查询