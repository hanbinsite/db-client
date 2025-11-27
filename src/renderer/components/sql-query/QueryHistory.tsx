import React, { useState, useEffect } from 'react';
import { Button, List, Card, Tag, Space, Tooltip, Popconfirm, message, Divider, Input, Select, Modal, Typography, Collapse } from 'antd';
import {
  StarOutlined,
  StarFilled,
  DeleteOutlined,
  CopyOutlined,
  PlayCircleOutlined,
  ExportOutlined,
  ImportOutlined,
  ClearOutlined,
  DownOutlined,
  UpOutlined,
  DatabaseOutlined,
  ClockCircleOutlined,
  NumberOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined
} from '@ant-design/icons';
import { QueryHistoryItem, queryHistoryService } from '../../utils/query-history';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

// 初始化dayjs插件
dayjs.extend(relativeTime);

const { Title, Text } = Typography;
const { Panel } = Collapse;

interface QueryHistoryProps {
  connectionId?: string;
  databaseType?: string;
  onQuerySelect: (query: string) => void;
  darkMode?: boolean;
}

const { Search } = Input;
const { Option } = Select;

const QueryHistory: React.FC<QueryHistoryProps> = ({ 
  connectionId, 
  databaseType, 
  onQuerySelect, 
  darkMode = false 
}) => {
  const [historyItems, setHistoryItems] = useState<QueryHistoryItem[]>([]);
  const [filteredItems, setFilteredItems] = useState<QueryHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'favorite' | 'connection' | 'databaseType'>('all');
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);

  // 加载查询历史记录
  const loadHistoryItems = async () => {
    setLoading(true);
    try {
      let items: QueryHistoryItem[];
      
      if (filterType === 'favorite') {
        items = await queryHistoryService.getFavoriteHistoryItems();
      } else if (filterType === 'connection' && connectionId) {
        items = await queryHistoryService.getHistoryItemsByConnection(connectionId);
      } else if (filterType === 'databaseType' && databaseType) {
        items = await queryHistoryService.getHistoryItemsByDatabaseType(databaseType);
      } else {
        items = await queryHistoryService.getHistoryItems();
      }
      
      setHistoryItems(items);
      setFilteredItems(items);
    } catch (error) {
      console.error('加载查询历史失败:', error);
      message.error('加载查询历史失败');
    } finally {
      setLoading(false);
    }
  };

  // 初始加载和过滤条件变化时重新加载
  useEffect(() => {
    loadHistoryItems();
  }, [filterType, connectionId, databaseType]);

  // 搜索过滤
  useEffect(() => {
    if (!searchText) {
      setFilteredItems(historyItems);
      return;
    }

    const filtered = historyItems.filter(item => 
      item.query.toLowerCase().includes(searchText.toLowerCase()) ||
      item.connectionName.toLowerCase().includes(searchText.toLowerCase()) ||
      item.databaseName.toLowerCase().includes(searchText.toLowerCase())
    );
    setFilteredItems(filtered);
  }, [searchText, historyItems]);

  // 切换收藏状态
  const handleToggleFavorite = async (id: string) => {
    try {
      await queryHistoryService.toggleFavorite(id);
      loadHistoryItems();
      message.success('收藏状态已更新');
    } catch (error) {
      console.error('更新收藏状态失败:', error);
      message.error('更新收藏状态失败');
    }
  };

  // 删除历史记录
  const handleDeleteHistory = async (id: string) => {
    try {
      await queryHistoryService.deleteHistoryItem(id);
      loadHistoryItems();
      message.success('历史记录已删除');
    } catch (error) {
      console.error('删除历史记录失败:', error);
      message.error('删除历史记录失败');
    }
  };

  // 清空历史记录
  const handleClearHistory = async () => {
    try {
      await queryHistoryService.clearHistory();
      loadHistoryItems();
      message.success('历史记录已清空');
    } catch (error) {
      console.error('清空历史记录失败:', error);
      message.error('清空历史记录失败');
    }
  };

  // 复制查询语句
  const handleCopyQuery = (query: string) => {
    navigator.clipboard.writeText(query).then(() => {
      message.success('查询语句已复制到剪贴板');
    }).catch(error => {
      console.error('复制查询语句失败:', error);
      message.error('复制查询语句失败');
    });
  };

  // 执行查询语句
  const handleExecuteQuery = (query: string) => {
    onQuerySelect(query);
  };

  // 导出查询历史
  const handleExportHistory = async () => {
    try {
      const items = await queryHistoryService.exportHistory();
      const dataStr = JSON.stringify(items, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `query_history_${dayjs().format('YYYY-MM-DD_HH-mm-ss')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      message.success('查询历史已导出');
    } catch (error) {
      console.error('导出查询历史失败:', error);
      message.error('导出查询历史失败');
    }
  };

  // 导入查询历史
  const handleImportHistory = async () => {
    if (!importFile) {
      message.warning('请选择要导入的文件');
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const content = e.target?.result as string;
          const items = JSON.parse(content);
          await queryHistoryService.importHistory(items);
          loadHistoryItems();
          setShowImportModal(false);
          setImportFile(null);
          message.success('查询历史已导入');
        } catch (error) {
          console.error('解析导入文件失败:', error);
          message.error('解析导入文件失败');
        }
      };
      reader.readAsText(importFile);
    } catch (error) {
      console.error('导入查询历史失败:', error);
      message.error('导入查询历史失败');
    }
  };

  // 处理文件选择
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setImportFile(file);
  };

  // 渲染历史记录项
  const renderHistoryItem = (item: QueryHistoryItem) => {
    const [expanded, setExpanded] = useState(false);
    
    return (
      <Card
        key={item.id}
        className={`query-history-item ${darkMode ? 'dark-card' : ''}`}
        size="small"
        extra={
          <Space size="small">
            <Tooltip title={item.isFavorite ? '取消收藏' : '收藏'}>
              <Button
                icon={item.isFavorite ? <StarFilled /> : <StarOutlined />}
                type="text"
                onClick={() => handleToggleFavorite(item.id)}
                className={darkMode ? 'dark-btn' : ''}
                style={{ color: item.isFavorite ? '#faad14' : undefined }}
                size="small"
              />
            </Tooltip>
            <Tooltip title="删除">
              <Popconfirm
                title="确定要删除这条历史记录吗？"
                onConfirm={() => handleDeleteHistory(item.id)}
                okText="确定"
                cancelText="取消"
              >
                <Button
                  icon={<DeleteOutlined />}
                  type="text"
                  className={darkMode ? 'dark-btn' : ''}
                  size="small"
                />
              </Popconfirm>
            </Tooltip>
          </Space>
        }
        hoverable
        style={{ marginBottom: 12, borderRadius: 8, boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)' }}
      >
        {/* 头部信息 */}
        <div style={{ marginBottom: 12 }}>
          <Space wrap size="small">
            <Tag 
              color={item.success ? 'green' : 'red'} 
              icon={item.success ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
            >
              {item.success ? '成功' : '失败'}
            </Tag>
            <Tag color="blue" icon={<DatabaseOutlined />}>
              {item.databaseType.toUpperCase()}
            </Tag>
            <Tag color="purple">
              {item.connectionName}
            </Tag>
            <Tag color="cyan">
              {item.databaseName}
            </Tag>
            <Tag color="gray" icon={<ClockCircleOutlined />}>
              {dayjs(item.executedAt).fromNow()}
            </Tag>
            <Tag color="orange">
              {item.executionTime}ms
            </Tag>
            <Tag color="magenta" icon={<NumberOutlined />}>
              {item.resultCount}行
            </Tag>
          </Space>
        </div>
        
        {/* 查询内容 - 支持折叠/展开 */}
        <div style={{ marginBottom: 12 }}>
          <div 
            style={{
              whiteSpace: 'pre-wrap', 
              fontSize: 13, 
              lineHeight: 1.5, 
              backgroundColor: darkMode ? '#1f1f1f' : '#f6f8fa',
              padding: 12, 
              borderRadius: 6,
              overflow: 'hidden',
              maxHeight: expanded ? 'none' : '120px',
              border: `1px solid ${darkMode ? '#303030' : '#e8e8e8'}`,
              transition: 'max-height 0.3s ease'
            }}
          >
            <pre style={{ margin: 0, fontFamily: 'monospace' }}>{item.query}</pre>
          </div>
          
          {/* 折叠/展开按钮 */}
          {item.query.length > 500 && (
            <Button
              type="text"
              icon={expanded ? <UpOutlined /> : <DownOutlined />}
              onClick={() => setExpanded(!expanded)}
              size="small"
              style={{ marginTop: 8 }}
              className={darkMode ? 'dark-btn' : ''}
            >
              {expanded ? '收起' : '展开'}
            </Button>
          )}
        </div>
        
        {/* 操作按钮 */}
        <div style={{ textAlign: 'right' }}>
          <Space size="small">
            <Tooltip title="复制查询">
              <Button
                icon={<CopyOutlined />}
                type="text"
                size="small"
                onClick={() => handleCopyQuery(item.query)}
                className={darkMode ? 'dark-btn' : ''}
              >
                复制
              </Button>
            </Tooltip>
            <Tooltip title="执行查询">
              <Button
                icon={<PlayCircleOutlined />}
                type="primary"
                size="small"
                onClick={() => handleExecuteQuery(item.query)}
              >
                执行
              </Button>
            </Tooltip>
          </Space>
        </div>
      </Card>
    );
  };

  return (
    <div className={`query-history ${darkMode ? 'dark' : ''}`} style={{ padding: 20, height: '100%', overflow: 'auto' }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: 24 }}>
        <Title level={3} style={{ margin: 0, color: darkMode ? '#fff' : '#000' }}>
          查询历史记录
        </Title>
        <Text type="secondary" style={{ color: darkMode ? '#999' : '#666' }}>
          查看和管理您的SQL查询历史
        </Text>
      </div>

      {/* 工具栏 */}
      <Card 
        className={darkMode ? 'dark-card' : ''}
        size="small"
        style={{ marginBottom: 20, borderRadius: 8 }}
      >
        <Space wrap size="middle" style={{ width: '100%', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space wrap size="small">
            <Search
              placeholder="搜索查询历史"
              allowClear
              enterButton
              size="middle"
              onSearch={value => setSearchText(value)}
              onChange={e => setSearchText(e.target.value)}
              className={darkMode ? 'dark-input' : ''}
              style={{ width: 280 }}
            />
            <Select
              value={filterType}
              onChange={setFilterType}
              size="middle"
              className={darkMode ? 'dark-select' : ''}
              style={{ width: 140 }}
            >
              <Option value="all">全部</Option>
              <Option value="favorite">收藏</Option>
              {connectionId && <Option value="connection">当前连接</Option>}
              {databaseType && <Option value="databaseType">当前数据库类型</Option>}
            </Select>
          </Space>
          
          <Space wrap size="small">
            <Tooltip title="导出查询历史">
              <Button
                icon={<ExportOutlined />}
                size="middle"
                onClick={handleExportHistory}
                className={darkMode ? 'dark-btn' : ''}
              >
                导出
              </Button>
            </Tooltip>
            <Tooltip title="导入查询历史">
              <Button
                icon={<ImportOutlined />}
                size="middle"
                onClick={() => setShowImportModal(true)}
                className={darkMode ? 'dark-btn' : ''}
              >
                导入
              </Button>
            </Tooltip>
            <Tooltip title="清空查询历史">
              <Popconfirm
                title="确定要清空所有查询历史记录吗？"
                onConfirm={handleClearHistory}
                okText="确定"
                cancelText="取消"
              >
                <Button
                  icon={<ClearOutlined />}
                  size="middle"
                  className={darkMode ? 'dark-btn' : ''}
                >
                  清空
                </Button>
              </Popconfirm>
            </Tooltip>
          </Space>
        </Space>
      </Card>

      {/* 查询历史列表 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, backgroundColor: darkMode ? '#1f1f1f' : '#fafafa', borderRadius: 8 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
          <div style={{ fontSize: 16, color: darkMode ? '#999' : '#666' }}>加载查询历史中...</div>
        </div>
      ) : filteredItems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, backgroundColor: darkMode ? '#1f1f1f' : '#fafafa', borderRadius: 8 }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>📝</div>
          <div style={{ fontSize: 18, marginBottom: 8, color: darkMode ? '#fff' : '#000' }}>暂无查询历史记录</div>
          <div style={{ fontSize: 14, color: darkMode ? '#999' : '#666' }}>执行查询后，历史记录将显示在这里</div>
        </div>
      ) : (
        <div>
          {/* 统计信息 */}
          <div style={{ marginBottom: 16, padding: 12, backgroundColor: darkMode ? '#1f1f1f' : '#f6f8fa', borderRadius: 6 }}>
            <Text type="secondary" style={{ color: darkMode ? '#999' : '#666' }}>
              共找到 <Text strong style={{ color: darkMode ? '#fff' : '#000' }}>{filteredItems.length}</Text> 条查询历史记录
            </Text>
          </div>
          
          {/* 历史记录列表 */}
          <List
            dataSource={filteredItems}
            renderItem={renderHistoryItem}
            pagination={{
              pageSize: 5,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条记录`,
              className: darkMode ? 'dark-pagination' : '',
              size: 'small',
              style: { marginTop: 20 }
            }}
            grid={{ gutter: 16, column: 1 }}
          />
        </div>
      )}

      {/* 导入模态框 */}
      <Modal
        title="导入查询历史"
        open={showImportModal}
        onOk={handleImportHistory}
        onCancel={() => setShowImportModal(false)}
        okText="导入"
        cancelText="取消"
        className={darkMode ? 'dark-modal' : ''}
        width={500}
      >
        <div style={{ marginBottom: 16 }}>
          <p style={{ marginBottom: 12 }}>请选择要导入的查询历史文件（JSON格式）：</p>
          <input
            type="file"
            accept=".json"
            onChange={handleFileChange}
            style={{ marginTop: 8, marginBottom: 16 }}
          />
        </div>
        {importFile && (
          <div style={{ padding: 12, backgroundColor: darkMode ? '#1f1f1f' : '#f0f0f0', borderRadius: 6, marginBottom: 16 }}>
            <div style={{ marginBottom: 4 }}><strong>已选择文件：</strong></div>
            <div>{importFile.name}</div>
            <div style={{ fontSize: 12, color: darkMode ? '#999' : '#666', marginTop: 4 }}>
              文件大小：{(importFile.size / 1024).toFixed(2)} KB
            </div>
          </div>
        )}
        <div style={{ fontSize: 12, color: darkMode ? '#999' : '#666' }}>
          提示：导入的查询历史记录将与现有记录合并，不会覆盖现有记录
        </div>
      </Modal>
    </div>
  );
};

export default QueryHistory;
