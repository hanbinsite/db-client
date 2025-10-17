import React from 'react';
import { Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { TreeNode } from './DatabaseTree';
import RedisTreeNodeRenderer from './RedisTreeNodeRenderer';

interface RedisDatabaseTreeProps {
  treeData: TreeNode[];
  expandedKeys: React.Key[];
  selectedKeys: React.Key[];
  onNodeSelect: (node: TreeNode) => void;
  onNodeDoubleClick?: (node: TreeNode) => void;
  onMenuSelect?: (action: string, node: TreeNode) => void;
  onExpand?: (expandedKeys: React.Key[]) => void;
  loading: boolean;
  darkMode?: boolean;
}

const RedisDatabaseTree: React.FC<RedisDatabaseTreeProps> = ({
  treeData,
  expandedKeys,
  selectedKeys,
  onNodeSelect,
  onNodeDoubleClick,
  onMenuSelect,
  onExpand,
  loading,
  darkMode = false
}) => {
  // 将TreeNode转换为Ant Design Tree组件需要的DataNode格式
  const convertToDataNode = (treeNode: TreeNode): DataNode => {
    const dataNode: DataNode = {
      key: treeNode.key,
      title: treeNode.title,
      children: treeNode.children?.map(convertToDataNode),
      isLeaf: treeNode.isLeaf,
      disabled: treeNode.disabled,
    };
    
    // 使用类型断言添加额外属性
    (dataNode as any).type = treeNode.type;
    (dataNode as any).keyCount = (treeNode as any).keyCount;
    
    return dataNode;
  };

  // 处理节点选择事件
  const handleSelect = (selectedKeys: React.Key[], info: { node: any }) => {
    // 简化处理，直接使用key找到原始节点
    onNodeSelect({
      key: info.node.key,
      title: info.node.title,
      type: info.node.type,
      isLeaf: info.node.isLeaf
    } as TreeNode);
  };

  // 处理节点双击事件
  const handleDoubleClick = (e: React.MouseEvent<HTMLSpanElement>, node: any) => {
    if (onNodeDoubleClick) {
      // 简化处理，直接创建一个TreeNode对象
      onNodeDoubleClick({
        key: node.key,
        title: node.title,
        type: node.type,
        isLeaf: node.isLeaf
      } as TreeNode);
    }
  };

  // 转换树数据
  const dataNodes = treeData.map(convertToDataNode);

  return (
    <>
      <Tree
        className={`redis-database-tree ${darkMode ? 'dark' : ''}`}
        treeData={dataNodes}
        expandedKeys={expandedKeys}
        selectedKeys={selectedKeys}
        onSelect={handleSelect}
        onDoubleClick={handleDoubleClick}
        onExpand={onExpand}
        // Redis树节点默认展开
        defaultExpandAll
        // 自定义渲染节点
        titleRender={(node) => {
          const nodeData = {
            key: String(node.key), 
            title: String(node.title), 
            type: (node as any).type || 'key',
            isLeaf: node.isLeaf
          } as TreeNode;
          
          // 使用类型断言添加keyCount属性
          (nodeData as any).keyCount = (node as any).keyCount;
          
          return <RedisTreeNodeRenderer node={nodeData} darkMode={darkMode} />;
        }}
      />
    </>
  );
};

export default RedisDatabaseTree;