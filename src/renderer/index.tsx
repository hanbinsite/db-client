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

(async () => {
  try {
    console.log('[REDIS TEST] Renderer bootstrap - fetching connections...');
    const res = await (window as any).electronAPI?.getAllConnections?.();
    try { console.log('[REDIS TEST] getAllConnections:', JSON.stringify(res)); } catch { console.log('[REDIS TEST] getAllConnections:', String(res)); }
    const conn = (res && res.success && Array.isArray(res.connections)) ? res.connections.find((c: any) => c.type === 'redis') : null;
    if (conn) {
      const logCfg = {
        host: conn.host,
        port: conn.port,
        authType: conn.authType,
        usernamePresent: !!conn.username,
        passwordPresent: !!conn.password,
        database: conn.database,
        timeout: conn.timeout
      };
      try { console.log('[REDIS TEST] start with config:', JSON.stringify(logCfg)); } catch {}
      const testRes = await (window as any).electronAPI?.testConnection?.(conn);
      try { console.log('[REDIS TEST] testConnection result:', JSON.stringify(testRes)); } catch { console.log('[REDIS TEST] testConnection result:', String(testRes)); }
      const generatedId = `${conn.type}_${conn.host}_${conn.port}_${conn.database || ''}`;
      const cfgRes = await (window as any).electronAPI?.getConnectionPoolConfig?.(generatedId);
      try { console.log('[REDIS TEST] getConnectionPoolConfig:', JSON.stringify(cfgRes)); } catch { console.log('[REDIS TEST] getConnectionPoolConfig:', String(cfgRes)); }
      if (cfgRes && cfgRes.success) {
        try {
          const infoRes = await (window as any).electronAPI?.executeQuery?.(generatedId, 'info', ['keyspace']);
          console.log('[REDIS TEST] INFO keyspace result:', typeof infoRes === 'string' ? infoRes : JSON.stringify(infoRes));
        } catch (e) {
          console.warn('[REDIS TEST] INFO keyspace error:', e);
        }
        try {
          const dbsizeRes = await (window as any).electronAPI?.executeQuery?.(generatedId, 'dbsize');
          console.log('[REDIS TEST] DBSIZE result:', typeof dbsizeRes === 'string' ? dbsizeRes : JSON.stringify(dbsizeRes));
        } catch (e) {
          console.warn('[REDIS TEST] DBSIZE error:', e);
        }
      } else {
        console.warn('[REDIS TEST] pool not found after testConnection for id:', generatedId);
      }
    } else {
      console.warn('[REDIS TEST] No Redis connection found to test.');
    }
  } catch (e) {
    console.error('[REDIS TEST] bootstrap error:', e);
  }
})();