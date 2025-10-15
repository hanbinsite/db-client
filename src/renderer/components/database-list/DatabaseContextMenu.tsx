import React from 'react';
import { Dropdown, Menu } from 'antd';
import type { MenuProps } from 'antd';
import { TreeNode } from './DatabaseTree';
import { DatabaseType } from '../../types';
import {
  CodeOutlined,
  ReloadOutlined,
  MoreOutlined,
  EyeOutlined,
  EditOutlined,
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined
} from '@ant-design/icons';

interface DatabaseContextMenuProps {
  node: TreeNode;
  onMenuSelect?: (action: string, node: TreeNode) => void;
  databaseType?: DatabaseType;
}

const DatabaseContextMenu: React.FC<DatabaseContextMenuProps> = ({ node, onMenuSelect, databaseType }) => {
  // 生成数据库特定的右键菜单选项
  const generateMenuItems = (): MenuProps['items'] => {
    const items: MenuProps['items'] = [];
    
    console.log('DatabaseContextMenu - 生成菜单', { nodeType: node.type, databaseType });
    
    // 数据库节点菜单（所有数据库通用）
    if (node.type === 'database') {
      items.push(
        {
          key: 'new-query',
          label: '新建查询',
          icon: <CodeOutlined />
        },
        {
          key: 'new-table',
          label: '新建表',
          icon: <PlusOutlined />
        },
        {
          key: 'refresh',
          label: '刷新',
          icon: <ReloadOutlined />
        },
        {
          key: 'properties',
          label: '属性',
          icon: <MoreOutlined />
        }
      );
      
      // PostgreSQL特有的架构管理
      if (databaseType === 'postgresql') {
        items.push(
          {
            key: 'new-schema',
            label: '新建架构',
            icon: <PlusOutlined />
          }
        );
      }
    }
    
    // 表节点菜单（所有数据库通用）
    if (node.type === 'table') {
      items.push(
        {
          key: 'select',
          label: '查询数据',
          icon: <EyeOutlined />
        },
        {
          key: 'insert',
          label: '插入数据',
          icon: <PlusOutlined />
        },
        {
          key: 'edit',
          label: '编辑表',
          icon: <EditOutlined />
        },
        {
          key: 'copy',
          label: '复制表',
          icon: <CopyOutlined />
        },
        {
          key: 'delete',
          label: '删除表',
          icon: <DeleteOutlined />
        }
      );
      
      // MySQL特有的触发器管理
      if (databaseType === 'mysql') {
        items.push(
          {
            key: 'manage-triggers',
            label: '管理触发器',
            icon: <CodeOutlined />
          }
        );
      }
      
      // PostgreSQL特有的索引管理
      if (databaseType === 'postgresql') {
        items.push(
          {
            key: 'manage-indexes',
            label: '管理索引',
            icon: <CodeOutlined />
          },
          {
            key: 'manage-constraints',
            label: '管理约束',
            icon: <CodeOutlined />
          }
        );
      }
    }
    
    // 视图节点菜单
    if (node.type === 'view') {
      items.push(
        {
          key: 'select',
          label: '查询数据',
          icon: <EyeOutlined />
        },
        {
          key: 'edit',
          label: '编辑视图',
          icon: <EditOutlined />
        },
        {
          key: 'refresh',
          label: '刷新视图',
          icon: <ReloadOutlined />
        },
        {
          key: 'delete',
          label: '删除视图',
          icon: <DeleteOutlined />
        }
      );
    }
    
    // PostgreSQL物化视图菜单
    if (node.type === 'materialized-view') {
      items.push(
        {
          key: 'select',
          label: '查询数据',
          icon: <EyeOutlined />
        },
        {
          key: 'edit',
          label: '编辑视图',
          icon: <EditOutlined />
        },
        {
          key: 'refresh',
          label: '刷新物化视图',
          icon: <ReloadOutlined />
        },
        {
          key: 'delete',
          label: '删除物化视图',
          icon: <DeleteOutlined />
        }
      );
    }
    
    // 存储过程和函数菜单（所有数据库通用）
    if (node.type === 'procedure' || node.type === 'function') {
      items.push(
        {
          key: 'execute',
          label: '执行',
          icon: <CodeOutlined />
        },
        {
          key: 'edit',
          label: '编辑',
          icon: <EditOutlined />
        },
        {
          key: 'delete',
          label: '删除',
          icon: <DeleteOutlined />
        }
      );
    }
    
    // PostgreSQL特有对象类型菜单
    if (databaseType === 'postgresql') {
      // 安全地检查节点类型，不直接比较特定值以避免类型错误
      if (typeof node.type === 'string' && ['sequence'].includes(node.type)) {
        items.push(
          {
            key: 'view',
            label: '查看序列',
            icon: <EyeOutlined />
          },
          {
            key: 'edit',
            label: '编辑序列',
            icon: <EditOutlined />
          },
          {
            key: 'delete',
            label: '删除序列',
            icon: <DeleteOutlined />
          }
        );
      }
      
      if (typeof node.type === 'string' && ['type', 'domain'].includes(node.type)) {
        items.push(
          {
            key: 'edit',
            label: '编辑类型',
            icon: <EditOutlined />
          },
          {
            key: 'delete',
            label: '删除类型',
            icon: <DeleteOutlined />
          }
        );
      }
    }
    
    // MySQL特有对象类型菜单
    if (databaseType === 'mysql') {
      // 安全地检查节点类型
      if (typeof node.type === 'string' && ['trigger', 'event'].includes(node.type)) {
        items.push(
          {
            key: 'edit',
            label: '编辑',
            icon: <EditOutlined />
          },
          {
            key: 'execute',
            label: '执行',
            icon: <CodeOutlined />
          },
          {
            key: 'delete',
            label: '删除',
            icon: <DeleteOutlined />
          }
        );
      }
    }
    
    return items;
  };

  // 处理菜单选择
  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (onMenuSelect) {
      console.log('数据库菜单选择:', key, node, databaseType);
      onMenuSelect(key as string, node);
    }
  };

  // 创建右键菜单
  const menu = (
    <Menu
      items={generateMenuItems()}
      onClick={handleMenuClick}
    />
  );

  return (
    <Dropdown overlay={menu} trigger={['contextMenu']}>
      <div style={{ userSelect: 'none', display: 'inline-block' }}>
        {node.title}
      </div>
    </Dropdown>
  );
};

export default DatabaseContextMenu;