import React from 'react';
import { Dropdown } from 'antd';
import { useTheme } from '../common/ThemeContext';
import { DatabaseOutlined, TableOutlined, FolderOutlined, CodeOutlined, FunctionOutlined, RestOutlined, IeOutlined } from '@ant-design/icons';

interface PostgreSqlTreeNodeRendererProps {
  node: any;
  className: string;
  style: React.CSSProperties;
  title: React.ReactNode;
  key: React.Key;
  isLeaf: boolean;
  isSelected: boolean;
  onDatabaseSelect: (database: string) => void;
  onTableSelect: (table: string) => void;
  onRefresh: () => void;
}

const PostgreSqlTreeNodeRenderer: React.FC<PostgreSqlTreeNodeRendererProps> = ({
  node,
  className,
  style,
  title,
  key,
  isLeaf,
  isSelected,
  onDatabaseSelect,
  onTableSelect,
  onRefresh
}) => {
  const { darkMode } = useTheme();

  // PostgreSQL对象类型图标映射
  const postgreSqlObjectIcons: Record<string, React.ReactNode> = {
    database: <DatabaseOutlined />,
    schema: <FolderOutlined />,
    table: <TableOutlined />,
    view: <IeOutlined />,
    'materialized-view': <IeOutlined />,
    procedure: <CodeOutlined />,
    function: <FunctionOutlined />,
    sequence: <CodeOutlined />,
    index: <FolderOutlined />,
    trigger: <CodeOutlined />,
    type: <IeOutlined />,
    domain: <IeOutlined />
  };

  // 获取PostgreSQL数据库对象的右键菜单
  const getPostgreSqlObjectMenu = () => {
    const menuItems = [];
    
    // 根据PostgreSQL节点类型添加不同的操作
    if (node.type === 'database') {
      menuItems.push(
        {
          key: 'refresh',
          label: '刷新',
          icon: <RestOutlined />,
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 刷新数据库:', node.title);
            onRefresh();
          }
        },
        {
          key: 'new-query',
          label: '新建查询',
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 新建查询:', node.title);
          }
        },
        {
          key: 'create-schema',
          label: '创建模式',
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 创建模式:', node.title);
          }
        }
      );
    } else if (node.type === 'schema') {
      menuItems.push(
        {
          key: 'refresh',
          label: '刷新',
          icon: <RestOutlined />,
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 刷新模式:', node.title);
            onRefresh();
          }
        },
        {
          key: 'create-table',
          label: '创建表',
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 在模式中创建表:', node.title);
          }
        },
        {
          key: 'create-view',
          label: '创建视图',
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 在模式中创建视图:', node.title);
          }
        },
        {
          key: 'create-function',
          label: '创建函数',
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 在模式中创建函数:', node.title);
          }
        }
      );
    } else if (node.type === 'table') {
      menuItems.push(
        {
          key: 'view-data',
          label: '查看数据',
          onClick: () => {
            const dbName = node.parent?.parent?.parent?.title;
            if (dbName) {
              console.log('PostgreSQL右键菜单 - 查看表数据:', node.title, '数据库:', dbName);
              onDatabaseSelect(dbName);
              onTableSelect(node.title);
            }
          }
        },
        {
          key: 'design-table',
          label: '设计表',
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 设计表:', node.title);
          }
        },
        {
          key: 'new-query',
          label: '新建查询',
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 针对表新建查询:', node.title);
          }
        },
        {
          key: 'view-indexes',
          label: '查看索引',
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 查看表索引:', node.title);
          }
        },
        {
          key: 'view-constraints',
          label: '查看约束',
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 查看表约束:', node.title);
          }
        }
      );
    } else if (node.type === 'view' || node.type === 'materialized-view') {
      menuItems.push(
        {
          key: 'view-data',
          label: '查看数据',
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 查看视图数据:', node.title);
          }
        },
        {
          key: 'edit',
          label: '编辑视图',
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 编辑视图:', node.title);
          }
        }
      );
      // 物化视图特有的刷新操作
      if (node.type === 'materialized-view') {
        menuItems.push(
          {
            key: 'refresh-materialized',
            label: '刷新物化视图',
            onClick: () => {
              console.log('PostgreSQL右键菜单 - 刷新物化视图:', node.title);
            }
          }
        );
      }
    } else if (node.type === 'function' || node.type === 'procedure') {
      menuItems.push(
        {
          key: 'edit',
          label: '编辑',
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 编辑函数/存储过程:', node.title);
          }
        },
        {
          key: 'execute',
          label: '执行',
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 执行函数/存储过程:', node.title);
          }
        }
      );
    } else if (node.type === 'sequence') {
      menuItems.push(
        {
          key: 'view-details',
          label: '查看详情',
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 查看序列详情:', node.title);
          }
        },
        {
          key: 'alter-sequence',
          label: '修改序列',
          onClick: () => {
            console.log('PostgreSQL右键菜单 - 修改序列:', node.title);
          }
        }
      );
    }
    
    return { items: menuItems };
  };

  console.log('POSTGRESQL TREE NODE RENDERER - 渲染PostgreSQL节点:', { key, title, type: node.type, isSelected });

  // 使用PostgreSQL专用图标
  const nodeIcon = node.type ? postgreSqlObjectIcons[node.type] || <FolderOutlined /> : <FolderOutlined />;

  return (
    <Dropdown menu={getPostgreSqlObjectMenu()} trigger={['contextMenu']}>
      <span 
        className={`${className} custom-tree-node postgresql-tree-node ${darkMode ? 'dark' : ''} ${isSelected ? 'selected' : ''}`}
        style={{ ...style, whiteSpace: 'nowrap' }}
      >
        {nodeIcon}
        <span className="node-title">{title}</span>
      </span>
    </Dropdown>
  );
};

export default PostgreSqlTreeNodeRenderer;