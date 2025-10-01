# 数据库客户端 - 设置指南

由于网络连接问题导致依赖安装失败，以下是手动设置项目的指南。

## 项目概述

这是一个基于 Electron + React + TypeScript 的跨平台数据库客户端，支持多种数据库类型。

## 项目结构

```
db-client/
├── src/
│   ├── main/                 # 主进程代码
│   │   ├── main.ts           # 主进程入口
│   │   ├── preload.ts        # 预加载脚本
│   │   └── services/         # 服务层
│   │       └── DatabaseService.ts  # 数据库服务
│   └── renderer/            # 渲染进程代码
│       ├── App.tsx          # 主应用组件
│       ├── App.css          # 应用样式
│       ├── index.tsx        # 渲染进程入口
│       ├── index.html       # HTML模板
│       ├── index.css        # 全局样式
│       ├── types.ts         # 类型定义
│       └── components/      # React组件
│           ├── ConnectionPanel.tsx  # 连接面板
│           ├── DatabasePanel.tsx   # 数据库面板
│           ├── QueryPanel.tsx      # 查询面板
│           └── DataPanel.tsx       # 数据面板
├── demo.html               # 演示界面
├── start-demo.js          # 演示启动脚本
├── package.json           # 项目配置
├── tsconfig.json          # TypeScript配置
├── webpack.main.config.js  # 主进程打包配置
└── webpack.renderer.config.js # 渲染进程打包配置
```

## 功能特性

### 已实现的功能

1. **界面设计**
   - 完整的UI组件设计
   - 响应式布局
   - 现代化的界面风格

2. **组件架构**
   - 连接管理面板
   - 数据库结构树
   - SQL查询编辑器
   - 数据展示表格

3. **服务层**
   - 数据库连接服务
   - MySQL/PostgreSQL支持
   - IPC通信机制

### 待实现的功能

1. **数据库连接**
   - 实际数据库连接功能
   - 连接状态管理
   - 连接池管理

2. **数据操作**
   - SQL查询执行
   - 数据增删改查
   - 事务支持

3. **高级功能**
   - 查询历史
   - 数据导出
   - 多标签页支持

## 手动设置步骤

### 1. 安装Node.js
确保已安装 Node.js 16+ 版本

### 2. 设置npm镜像（可选）
```bash
npm config set registry https://registry.npmmirror.com
```

### 3. 安装依赖
```bash
# 基础依赖
npm install electron@^25.0.0

# React相关
npm install react@^18.2.0 react-dom@^18.2.0

# UI组件库
npm install antd@^5.8.0 @ant-design/icons@^5.2.0

# 数据库驱动
npm install mysql2@^3.6.0 pg@^8.11.0

# 开发工具
npm install -D @types/react@^18.2.0 @types/react-dom@^18.2.0
npm install -D typescript@^5.0.0 webpack@^5.80.0 webpack-cli@^5.1.0
npm install -D concurrently@^8.2.0 electron-builder@^24.0.0
```

### 4. 构建项目
```bash
# 开发模式
npm run dev

# 生产构建
npm run build

# 启动应用
npm start
```

## 演示界面

项目包含一个静态演示界面，可以在没有完整依赖的情况下查看UI效果：

```bash
# 运行演示界面（需要Electron依赖）
npm run demo
```

或者直接在浏览器中打开 `demo.html` 文件。

## 开发说明

### 架构设计

项目采用经典的 Electron 应用架构：

- **主进程**: 负责窗口管理、菜单、系统集成
- **渲染进程**: React应用，负责UI展示
- **预加载脚本**: 安全地暴露API给渲染进程
- **服务层**: 数据库操作和业务逻辑

### 组件说明

1. **ConnectionPanel**: 数据库连接管理
   - 新建/编辑连接配置
   - 连接状态显示
   - 连接列表管理

2. **DatabasePanel**: 数据库结构展示
   - 数据库树形结构
   - 表/视图/存储过程展示
   - 点击选择功能

3. **QueryPanel**: SQL查询编辑
   - 语法高亮编辑器
   - 查询执行控制
   - 查询模板选择

4. **DataPanel**: 数据展示
   - 表格数据展示
   - 分页控制
   - 数据编辑功能

## 故障排除

### 常见问题

1. **网络连接问题**
   - 使用国内镜像源
   - 检查网络代理设置
   - 尝试离线安装

2. **依赖安装失败**
   - 清理npm缓存: `npm cache clean --force`
   - 删除node_modules重新安装
   - 检查Node.js版本兼容性

3. **原生模块编译问题**
   - 安装Visual Studio Build Tools
   - 配置Python环境
   - 使用预编译版本

## 后续开发

项目基础架构已经完成，后续开发重点：

1. 完善数据库连接功能
2. 实现SQL查询执行
3. 添加数据操作功能
4. 优化用户体验
5. 添加测试用例

## 许可证

MIT License

## 更新日志

### v1.0.0 (当前版本)
- 完成基础项目架构
- 实现完整的UI组件
- 设计数据库服务层
- 创建演示界面