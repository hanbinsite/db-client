# 跨平台数据库客户端

一个功能强大的跨平台数据库客户端，支持多种主流数据库，提供直观的用户界面进行数据库管理和操作。

## 功能特性

### 支持的数据库
- ✅ **MySQL** - 完全支持
- ✅ **PostgreSQL** - 完全支持  
- 🔄 **Oracle** - 基础支持（需要安装Oracle客户端）
- 🔄 **GaussDB** - 基础支持
- 🔄 **Redis** - 基础支持
- 🔄 **SQLite** - 基础支持

### 核心功能
- 🔧 **数据库连接管理** - 支持多种连接配置和SSL连接
- 📊 **数据库服务器信息查看** - 显示版本、连接数、性能指标等
- 🏗️ **数据库表结构设计** - 可视化表结构，包括列、索引、外键
- 📝 **SQL查询执行** - 强大的SQL编辑器，支持语法高亮和多语句执行
- 📋 **数据查看与编辑** - 表格形式展示数据，支持增删改查操作
- 🔄 **事务支持** - 支持事务管理和回滚操作
- 💾 **查询保存** - 保存常用查询语句

## 技术栈

- **前端**: React + TypeScript + Ant Design
- **桌面框架**: Electron
- **构建工具**: Webpack
- **数据库驱动**: 
  - MySQL: mysql2
  - PostgreSQL: pg
  - Oracle: oracledb
  - Redis: redis
  - SQLite: sqlite3

## 快速开始

### 环境要求
- Node.js 16.0+
- npm 或 yarn

### 安装依赖
```bash
npm install
```

### 开发模式运行
```bash
npm run dev
```

### 构建应用
```bash
# 构建所有平台
npm run build

# 打包为可执行文件
npm run dist
```

## 项目结构

```
src/
├── main/                 # 主进程代码
│   ├── main.ts          # 主进程入口
│   ├── preload.ts       # 预加载脚本
│   └── services/        # 数据库服务
│       └── DatabaseService.ts
└── renderer/            # 渲染进程代码
    ├── index.tsx        # React应用入口
    ├── App.tsx          # 主应用组件
    ├── components/      # React组件
    │   ├── ConnectionPanel.tsx
    │   ├── DatabasePanel.tsx
    │   ├── QueryPanel.tsx
    │   └── DataPanel.tsx
    ├── types.ts         # 类型定义
    └── *.css           # 样式文件
```

## 使用指南

### 1. 创建数据库连接
1. 点击"新建连接"按钮
2. 选择数据库类型（MySQL、PostgreSQL等）
3. 填写连接信息（主机、端口、用户名、密码等）
4. 点击"连接"建立连接

### 2. 浏览数据库结构
- 左侧连接面板显示所有已建立的连接
- 中间数据库面板显示数据库和表结构树
- 点击表名可以查看表数据和结构

### 3. 执行SQL查询
1. 在查询面板中输入SQL语句
2. 点击"执行"按钮或使用Ctrl+Enter快捷键
3. 查看执行结果和性能指标

### 4. 编辑数据
1. 在数据面板中选择表
2. 使用工具栏按钮进行增删改操作
3. 支持批量编辑和搜索功能

## 配置说明

### 数据库连接配置
每个数据库连接支持以下配置：
- **基本配置**: 主机、端口、用户名、密码
- **高级配置**: SSL连接、连接超时、默认数据库
- **连接测试**: 创建连接前可测试连接是否成功

### 应用设置
- **主题**: 支持亮色/暗色主题
- **编辑器**: SQL编辑器语法高亮和自动完成
- **快捷键**: 自定义快捷键配置

## 开发说明

### 添加新的数据库支持
1. 在 `src/main/services/DatabaseService.ts` 中添加新的连接类
2. 实现 `IDatabaseConnection` 接口
3. 在 `createConnectionInstance` 方法中添加类型映射

### 扩展功能
- 添加新的数据库操作功能
- 实现数据导入导出功能
- 添加数据库备份恢复功能

## 故障排除

### 常见问题

**Q: 连接数据库失败**
A: 检查网络连接、防火墙设置、数据库服务状态

**Q: SQL查询执行缓慢**
A: 优化查询语句，添加合适的索引

**Q: 应用启动失败**
A: 检查Node.js版本和依赖安装情况

### 日志查看
应用日志位于：
- Windows: `%APPDATA%/db-client/logs`
- macOS: `~/Library/Logs/db-client`
- Linux: `~/.config/db-client/logs`

## 贡献指南

欢迎提交Issue和Pull Request来改进这个项目。

## 许可证

MIT License

## 更新日志

### v1.0.0 (当前版本)
- 初始版本发布
- 支持MySQL和PostgreSQL
- 基础的数据查看和编辑功能
- SQL查询执行界面

## 联系方式

如有问题或建议，请通过以下方式联系：
- 提交GitHub Issue
- 发送邮件至开发团队

---

**注意**: 本项目仍在积极开发中，部分功能可能尚未完全实现。欢迎测试和反馈！