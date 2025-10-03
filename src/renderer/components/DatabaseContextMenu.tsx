import React, { useState, useRef, useEffect } from 'react';
import { Menu, Dropdown } from 'antd';
import { TreeNode } from './DatabaseTree';
import './DatabasePanel.css';

interface DatabaseContextMenuProps {
  node: TreeNode;
  onMenuSelect: (action: string, node: TreeNode) => void;
  children: React.ReactNode;
}

const DatabaseContextMenu: React.FC<DatabaseContextMenuProps> = ({
  node,
  onMenuSelect,
  children
}) => {
  const [visible, setVisible] = useState(false);
  const [clientX, setClientX] = useState(0);
  const [clientY, setClientY] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // 根据节点类型生成对应的右键菜单
  const getMenuItems = () => {
    const items = [];
    const nodeType = node.type || 'unknown';

    // 通用菜单项
    items.push({
      key: 'refresh',
      label: '刷新',
      onClick: () => onMenuSelect('refresh', node)
    });

    // 数据库节点菜单项
    if (nodeType === 'database') {
      items.push(
        {
          key: 'new-query',
          label: '新建查询',
          onClick: () => onMenuSelect('new-query', node)
        },
        {
          key: 'export',
          label: '导出数据库',
          onClick: () => onMenuSelect('export', node)
        },
        {
          key: 'backup',
          label: '备份数据库',
          onClick: () => onMenuSelect('backup', node)
        }
      );
    }

    // 表节点菜单项
    if (nodeType === 'table') {
      items.push(
        {
          key: 'view-data',
          label: '查看数据',
          onClick: () => onMenuSelect('view-data', node)
        },
        {
          key: 'view-structure',
          label: '查看结构',
          onClick: () => onMenuSelect('view-structure', node)
        },
        {
          key: 'edit-table',
          label: '编辑表',
          onClick: () => onMenuSelect('edit-table', node)
        },
        {
          key: 'new-query-table',
          label: '新建查询',
          onClick: () => onMenuSelect('new-query-table', node)
        },
        {
          key: 'export-table',
          label: '导出表',
          onClick: () => onMenuSelect('export-table', node)
        }
      );
    }

    // 视图节点菜单项
    if (nodeType === 'view') {
      items.push(
        {
          key: 'view-data',
          label: '查看数据',
          onClick: () => onMenuSelect('view-data', node)
        },
        {
          key: 'view-definition',
          label: '查看定义',
          onClick: () => onMenuSelect('view-definition', node)
        }
      );
    }

    // 存储过程和函数节点菜单项
    if (nodeType === 'procedure' || nodeType === 'function') {
      items.push(
        {
          key: 'view-definition',
          label: '查看定义',
          onClick: () => onMenuSelect('view-definition', node)
        },
        {
          key: 'execute',
          label: '执行',
          onClick: () => onMenuSelect('execute', node)
        }
      );
    }

    // 查询节点菜单项
    if (nodeType === 'query') {
      items.push(
        {
          key: 'run-query',
          label: '运行查询',
          onClick: () => onMenuSelect('run-query', node)
        },
        {
          key: 'edit-query',
          label: '编辑查询',
          onClick: () => onMenuSelect('edit-query', node)
        },
        {
          key: 'delete-query',
          label: '删除查询',
          onClick: () => onMenuSelect('delete-query', node)
        }
      );
    }

    // 备份节点菜单项
    if (nodeType === 'backup') {
      items.push(
        {
          key: 'restore-backup',
          label: '还原备份',
          onClick: () => onMenuSelect('restore-backup', node)
        },
        {
          key: 'delete-backup',
          label: '删除备份',
          onClick: () => onMenuSelect('delete-backup', node)
        }
      );
    }

    return items;
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setClientX(e.clientX);
    setClientY(e.clientY);
    setVisible(true);
  };

  const handleClose = () => {
    setVisible(false);
  };

  // 点击其他地方关闭菜单
  useEffect(() => {
    const handleClick = () => {
      setVisible(false);
    };

    if (visible) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [visible]);

  return (
    <div 
      ref={containerRef} 
      onContextMenu={handleContextMenu}
      style={{ display: 'inline-block' }}
    >
      {children}
      {visible && (
        <Menu
          style={{
            position: 'fixed',
            left: clientX,
            top: clientY,
            minWidth: 120,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            zIndex: 1000
          }}
          onClick={handleClose}
          items={getMenuItems()}
        />
      )}
    </div>
  );
};

export default DatabaseContextMenu;