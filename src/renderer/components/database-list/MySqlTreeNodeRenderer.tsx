import React from 'react';
import { Dropdown } from 'antd';
import { useTheme } from '../common/ThemeContext';
import { DatabaseOutlined, TableOutlined, FolderOutlined, CodeOutlined, FunctionOutlined, RestOutlined, IeOutlined } from '@ant-design/icons';

interface MySqlTreeNodeRendererProps {
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

const MySqlTreeNodeRenderer: React.FC<MySqlTreeNodeRendererProps> = ({
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

  // MySQL对象类型图标映射
  const mysqlObjectIcons: Record<string, React.ReactNode> = {
    database: <DatabaseOutlined />,
    table: <TableOutlined />,
    view: <IeOutlined />,
    procedure: <CodeOutlined />,
    function: <FunctionOutlined />,
    trigger: <CodeOutlined />,
    event: <CodeOutlined />
  };

  // 获取MySQL数据库对象的右键菜单
  const getMySqlObjectMenu = () => {
    const menuItems = [];
    
    // 根据MySQL节点类型添加不同的操作
    if (node.type === 'database') {
      menuItems.push(
        {
          key: 'refresh',
          label: '刷新',
          icon: <RestOutlined />,
          onClick: () => {
            console.log('MySQL右键菜单 - 刷新数据库:', node.title);
            onRefresh();
          }
        },
        {
          key: 'new-query',
          label: '新建查询',
          onClick: () => {
            console.log('MySQL右键菜单 - 新建查询:', node.title);
          }
        },
        {
          key: 'create-table',
          label: '创建表',
          onClick: () => {
            console.log('MySQL右键菜单 - 创建表:', node.title);
          }
        },
        {
          key: 'create-view',
          label: '创建视图',
          onClick: () => {
            console.log('MySQL右键菜单 - 创建视图:', node.title);
          }
        }
      );
    } else if (node.type === 'table') {
      menuItems.push(
        {
          key: 'view-data',
          label: '查看数据',
          onClick: () => {
            const dbName = node.parent?.parent?.title;
            if (dbName) {
              console.log('MySQL右键菜单 - 查看表数据:', node.title, '数据库:', dbName);
              onDatabaseSelect(dbName);
              onTableSelect(node.title);
            }
          }
        },
        {
          key: 'design-table',
          label: '设计表',
          onClick: () => {
            console.log('MySQL右键菜单 - 设计表:', node.title);
          }
        },
        {
          key: 'new-query',
          label: '新建查询',
          onClick: () => {
            console.log('MySQL右键菜单 - 针对表新建查询:', node.title);
          }
        },
        {
          key: 'create-index',
          label: '创建索引',
          onClick: () => {
            console.log('MySQL右键菜单 - 为表创建索引:', node.title);
          }
        }
      );
    } else if (node.type === 'view') {
      menuItems.push(
        {
          key: 'view-data',
          label: '查看数据',
          onClick: () => {
            console.log('MySQL右键菜单 - 查看视图数据:', node.title);
          }
        },
        {
          key: 'edit',
          label: '编辑视图',
          onClick: () => {
            console.log('MySQL右键菜单 - 编辑视图:', node.title);
          }
        }
      );
    } else if (node.type === 'procedure' || node.type === 'function') {
      menuItems.push(
        {
          key: 'edit',
          label: '编辑',
          onClick: () => {
            console.log('MySQL右键菜单 - 编辑存储过程/函数:', node.title);
          }
        },
        {
          key: 'execute',
          label: '执行',
          onClick: () => {
            console.log('MySQL右键菜单 - 执行存储过程/函数:', node.title);
          }
        }
      );
    }
    
    return { items: menuItems };
  };

  console.log('MYSQL TREE NODE RENDERER - 渲染MySQL节点:', { key, title, type: node.type, isSelected });

  // 使用MySQL专用图标
  const nodeIcon = node.type ? mysqlObjectIcons[node.type] || <FolderOutlined /> : <FolderOutlined />;

  return (
    <Dropdown menu={getMySqlObjectMenu()} trigger={['contextMenu']}>
      <span 
        className={`${className} custom-tree-node mysql-tree-node ${darkMode ? 'dark' : ''} ${isSelected ? 'selected' : ''}`}
        style={{ ...style, whiteSpace: 'nowrap' }}
      >
        {nodeIcon}
        <span className="node-title">{title}</span>
      </span>
    </Dropdown>
  );
};

export default MySqlTreeNodeRenderer;