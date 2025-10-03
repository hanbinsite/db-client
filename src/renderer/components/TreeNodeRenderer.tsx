import { Dropdown } from 'antd';
import { useTheme } from './ThemeContext';
import { DatabaseOutlined, TableOutlined, FolderOutlined, CodeOutlined, FunctionOutlined, RestOutlined, IeOutlined } from '@ant-design/icons';

interface TreeNodeRendererProps {
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

const TreeNodeRenderer: React.FC<TreeNodeRendererProps> = ({
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

  // 获取数据库对象的右键菜单
  const getObjectMenu = () => {
    const menuItems = [];
    
    // 根据节点类型添加不同的操作
    if (node.type === 'database') {
      menuItems.push(
        {
          key: 'refresh',
          label: '刷新',
          icon: <RestOutlined />,
          onClick: () => {
            console.log('右键菜单 - 刷新数据库:', node.title);
            onRefresh();
          }
        },
        {
          key: 'new-query',
          label: '新建查询',
          onClick: () => {
            console.log('右键菜单 - 新建查询:', node.title);
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
              console.log('右键菜单 - 查看表数据:', node.title, '数据库:', dbName);
              onDatabaseSelect(dbName);
              onTableSelect(node.title);
            }
          }
        },
        {
          key: 'design-table',
          label: '设计表',
          onClick: () => {
            console.log('右键菜单 - 设计表:', node.title);
          }
        },
        {
          key: 'new-query',
          label: '新建查询',
          onClick: () => {
            console.log('右键菜单 - 针对表新建查询:', node.title);
          }
        }
      );
    } else if (node.type === 'view' || node.type === 'procedure' || node.type === 'function') {
      menuItems.push(
        {
          key: 'edit',
          label: '编辑',
          onClick: () => {
            console.log('右键菜单 - 编辑对象:', node.title);
          }
        },
        {
          key: 'execute',
          label: '执行',
          onClick: () => {
            console.log('右键菜单 - 执行对象:', node.title);
          }
        }
      );
    }
    
    return { items: menuItems };
  };

  console.log('TREE NODE RENDERER - 渲染节点:', { key, title, type: node.type, isSelected });

  return (
    <Dropdown menu={getObjectMenu()} trigger={['contextMenu']}>
      <span 
        className={`${className} custom-tree-node ${darkMode ? 'dark' : ''} ${isSelected ? 'selected' : ''}`}
        style={{ ...style, whiteSpace: 'nowrap' }}
      >
        {node.icon}
        <span className="node-title">{title}</span>
      </span>
    </Dropdown>
  );
};

export default TreeNodeRenderer;