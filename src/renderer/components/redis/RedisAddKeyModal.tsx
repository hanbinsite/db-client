import React, { useState } from 'react';
import { Modal, Input, Select, InputNumber, message, Table, Button } from 'antd';
import { DatabaseConnection } from '../../types';

export type RedisKeyType = 'string' | 'hash' | 'list' | 'set' | 'zset';

interface RedisAddKeyModalProps {
  visible: boolean;
  onClose: () => void;
  connection?: DatabaseConnection;
  activeDatabase?: string;
  darkMode?: boolean;
  onCreated?: () => void;
}

interface HashEntry {
  field: string;
  value: string;
}

const RedisAddKeyModal: React.FC<RedisAddKeyModalProps> = ({
  visible,
  onClose,
  connection,
  activeDatabase,
  darkMode,
  onCreated,
}) => {
  const [keyName, setKeyName] = useState<string>('');
  const [keyType, setKeyType] = useState<RedisKeyType>('string');

  // string
  const [value, setValue] = useState<string>('');

  // hash
  const [hashEntries, setHashEntries] = useState<HashEntry[]>([{ field: '', value: '' }]);
  const [selectedHashIndex, setSelectedHashIndex] = useState<number | null>(null);

  // list
  const [listElements, setListElements] = useState<string[]>(['']);
  const [selectedListIndex, setSelectedListIndex] = useState<number | null>(null);

  // set
  const [setMembers, setSetMembers] = useState<string[]>(['']);
  const [selectedSetIndex, setSelectedSetIndex] = useState<number | null>(null);

  // zset
  const [zsetMembers, setZsetMembers] = useState<string[]>(['']);
  const [selectedZsetIndex, setSelectedZsetIndex] = useState<number | null>(null);
  const [zsetScore, setZsetScore] = useState<number>(0);

  // ttl
  const [ttlSeconds, setTtlSeconds] = useState<number>(-1);

  // ----- hash helpers -----
  const addHashRow = () => setHashEntries(prev => [...prev, { field: '', value: '' }]);
  const removeLastHashRow = () => setHashEntries(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));
  const deleteHashSelectedRow = () => {
    if (selectedHashIndex === null) return;
    setHashEntries(prev => {
      if (prev.length <= 1) return [{ field: '', value: '' }];
      const next = [...prev];
      next.splice(selectedHashIndex, 1);
      return next.length === 0 ? [{ field: '', value: '' }] : next;
    });
    setSelectedHashIndex(null);
  };
  const updateHashRow = (index: number, key: 'field' | 'value', v: string) => {
    setHashEntries(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: v };
      return next;
    });
  };

  // ----- list helpers -----
  const addListRow = () => setListElements(prev => [...prev, '']);
  const removeLastListRow = () => setListElements(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));
  const deleteListSelectedRow = () => {
    if (selectedListIndex === null) return;
    setListElements(prev => {
      if (prev.length <= 1) return [''];
      const next = [...prev];
      next.splice(selectedListIndex, 1);
      return next.length === 0 ? [''] : next;
    });
    setSelectedListIndex(null);
  };
  const updateListRow = (index: number, v: string) => {
    setListElements(prev => {
      const next = [...prev];
      next[index] = v;
      return next;
    });
  };
  const moveListUp = () => {
    if (selectedListIndex === null || selectedListIndex <= 0) return;
    setListElements(prev => {
      const next = [...prev];
      const i = selectedListIndex;
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
    setSelectedListIndex(i => (i !== null ? i - 1 : i));
  };
  const moveListDown = () => {
    if (selectedListIndex === null) return;
    setListElements(prev => {
      if (selectedListIndex === null || selectedListIndex >= prev.length - 1) return prev;
      const next = [...prev];
      const i = selectedListIndex;
      [next[i + 1], next[i]] = [next[i], next[i + 1]];
      return next;
    });
    setSelectedListIndex(i => (i !== null ? i + 1 : i));
  };

  // ----- set helpers -----
  const addSetRow = () => setSetMembers(prev => [...prev, '']);
  const removeLastSetRow = () => setSetMembers(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));
  const deleteSetSelectedRow = () => {
    if (selectedSetIndex === null) return;
    setSetMembers(prev => {
      if (prev.length <= 1) return [''];
      const next = [...prev];
      next.splice(selectedSetIndex, 1);
      return next.length === 0 ? [''] : next;
    });
    setSelectedSetIndex(null);
  };
  const updateSetRow = (index: number, v: string) => {
    setSetMembers(prev => {
      const next = [...prev];
      next[index] = v;
      return next;
    });
  };

  // ----- zset helpers -----
  const addZsetRow = () => setZsetMembers(prev => [...prev, '']);
  const removeLastZsetRow = () => setZsetMembers(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));
  const deleteZsetSelectedRow = () => {
    if (selectedZsetIndex === null) return;
    setZsetMembers(prev => {
      if (prev.length <= 1) return [''];
      const next = [...prev];
      next.splice(selectedZsetIndex, 1);
      return next.length === 0 ? [''] : next;
    });
    setSelectedZsetIndex(null);
  };
  const updateZsetRow = (index: number, v: string) => {
    setZsetMembers(prev => {
      const next = [...prev];
      next[index] = v;
      return next;
    });
  };

  const handleOk = async () => {
    if (!connection || connection.type !== 'redis' || !connection.connectionId) {
      message.error('当前未选择Redis连接');
      return;
    }
    const key = (keyName || '').trim();
    if (!key) {
      message.error('请输入键名');
      return;
    }
    const poolId = connection.connectionId;
    try {
      const m = /^db(\d+)$/i.exec(activeDatabase || '');
      if (m) {
        await (window as any).electronAPI?.executeQuery(poolId, 'select', [String(m[1])]);
      }

      let cmd = 'set';
      let args: string[] = [key, String(value ?? '')];

      if (keyType === 'hash') {
        const cleaned = hashEntries
          .map(e => ({ field: (e.field || '').trim(), value: (e.value || '').trim() }))
          .filter(e => e.field.length > 0 || e.value.length > 0);
        if (cleaned.length === 0) {
          message.error('请至少填写一行哈希字段与值');
          return;
        }
        const invalid = cleaned.find(e => e.field.length === 0 || e.value.length === 0);
        if (invalid) {
          message.error('哈希表每行字段和值均不能为空');
          return;
        }
        cmd = 'hset';
        args = [key, ...cleaned.flatMap(e => [e.field, e.value])];
      } else if (keyType === 'list') {
        const cleaned = listElements.map(s => (s || '').trim()).filter(s => s.length > 0);
        if (cleaned.length === 0) {
          message.error('请至少添加一个列表元素');
          return;
        }
        cmd = 'lpush';
        args = [key, ...cleaned];
      } else if (keyType === 'set') {
        const cleaned = setMembers.map(s => (s || '').trim()).filter(s => s.length > 0);
        if (cleaned.length === 0) {
          message.error('请至少添加一个集合成员');
          return;
        }
        cmd = 'sadd';
        args = [key, ...cleaned];
      } else if (keyType === 'zset') {
        const cleaned = zsetMembers.map(s => (s || '').trim()).filter(s => s.length > 0);
        if (cleaned.length === 0) {
          message.error('请至少添加一个有序集合成员');
          return;
        }
        const score = Number(zsetScore);
        if (!Number.isFinite(score)) {
          message.error('请输入有效的分数');
        }
        cmd = 'zadd';
        args = [key, ...cleaned.flatMap(mb => [String(score), mb])];
      }

      const res = await (window as any).electronAPI?.executeQuery(poolId, cmd, args);
      if (res && res.success) {
        const ttl = Number(ttlSeconds);
        if (Number.isFinite(ttl) && ttl > 0) {
          try {
            const ttlRes = await (window as any).electronAPI?.executeQuery(poolId, 'expire', [key, String(Math.floor(ttl))]);
            if (!(ttlRes && ttlRes.success)) {
              message.warning('键已新增，但设置TTL失败');
            }
          } catch (e) {
            message.warning('键已新增，但设置TTL失败');
          }
        }

        message.success('已新增键');
        // reset
        setKeyName('');
        setValue('');
        setHashEntries([{ field: '', value: '' }]);
        setSelectedHashIndex(null);
        setListElements(['']);
        setSelectedListIndex(null);
        setSetMembers(['']);
        setSelectedSetIndex(null);
        setZsetMembers(['']);
        setSelectedZsetIndex(null);
        setZsetScore(0);
        setTtlSeconds(-1);
        setKeyType('string');
        onCreated?.();
        onClose();
      } else {
        message.error('新增键失败');
      }
    } catch (e: any) {
      message.error(e?.message || '新增键失败');
    }
  };

  const hashColumns = [
    {
      title: '字段名',
      dataIndex: 'field',
      key: 'field',
      render: (_: string, record: HashEntry, index: number) => (
        <Input
          value={record.field}
          onChange={(e) => updateHashRow(index, 'field', e.target.value)}
          placeholder="例如 name"
        />
      )
    },
    {
      title: '字段值',
      dataIndex: 'value',
      key: 'value',
      render: (_: string, record: HashEntry, index: number) => (
        <Input
          value={record.value}
          onChange={(e) => updateHashRow(index, 'value', e.target.value)}
          placeholder="例如 Alice"
        />
      )
    }
  ];

  const oneColColumns = (update: (index: number, v: string) => void) => [
    {
      title: '元素',
      dataIndex: 'element',
      key: 'element',
      render: (_: string, record: { key: string; element: string }, index: number) => (
        <Input
          value={record.element}
          onChange={(e) => update(index, e.target.value)}
          placeholder="例如 item1"
        />
      )
    }
  ];

  // row selection for list
  const listRowSelection = {
    type: 'radio' as const,
    selectedRowKeys: selectedListIndex === null ? [] : [String(selectedListIndex)],
    onChange: (selectedRowKeys: React.Key[]) => {
      if (selectedRowKeys.length > 0) {
        const k = String(selectedRowKeys[0]);
        setSelectedListIndex(Number(k));
      } else {
        setSelectedListIndex(null);
      }
    }
  };

  const setRowSelection = {
    type: 'radio' as const,
    selectedRowKeys: selectedSetIndex === null ? [] : [String(selectedSetIndex)],
    onChange: (selectedRowKeys: React.Key[]) => {
      if (selectedRowKeys.length > 0) {
        const k = String(selectedRowKeys[0]);
        setSelectedSetIndex(Number(k));
      } else {
        setSelectedSetIndex(null);
      }
    }
  };

  const zsetRowSelection = {
    type: 'radio' as const,
    selectedRowKeys: selectedZsetIndex === null ? [] : [String(selectedZsetIndex)],
    onChange: (selectedRowKeys: React.Key[]) => {
      if (selectedRowKeys.length > 0) {
        const k = String(selectedRowKeys[0]);
        setSelectedZsetIndex(Number(k));
      } else {
        setSelectedZsetIndex(null);
      }
    }
  };

  const hashRowSelection = {
    type: 'radio' as const,
    selectedRowKeys: selectedHashIndex === null ? [] : [String(selectedHashIndex)],
    onChange: (selectedRowKeys: React.Key[]) => {
      if (selectedRowKeys.length > 0) {
        const k = String(selectedRowKeys[0]);
        setSelectedHashIndex(Number(k));
      } else {
        setSelectedHashIndex(null);
      }
    }
  };

  return (
    <Modal 
      title="新增键（Redis）"
      open={visible}
      onOk={handleOk}
      onCancel={onClose}
      okText="创建"
      cancelText="取消"
      className={darkMode ? 'dark-modal' : ''}
      width={800}
    >
      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 6 }}>键名：</div>
        <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="例如 user:1" />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ marginBottom: 6 }}>类型：</div>
        <Select
          value={keyType}
          onChange={(val) => setKeyType(val as RedisKeyType)}
          style={{ width: '100%' }}
          options={[
            { label: 'string', value: 'string' },
            { label: 'hash', value: 'hash' },
            { label: 'list', value: 'list' },
            { label: 'set', value: 'set' },
            { label: 'zset', value: 'zset' }
          ]}
        />
      </div>

      {keyType === 'string' && (
        <div>
          <div style={{ marginBottom: 6 }}>值：</div>
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="可留空，默认为空字符串" />
        </div>
      )}

      {keyType === 'hash' && (
        <div>
          <div style={{ marginBottom: 6 }}>哈希字段：</div>
          <Table
            dataSource={hashEntries.map((e, i) => ({ key: String(i), ...e }))}
            columns={hashColumns as any}
            pagination={false}
            size="small"
            rowSelection={hashRowSelection as any}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={addHashRow}>新增行</Button>
            <Button danger onClick={removeLastHashRow}>删除最后一行</Button>
            <Button danger onClick={deleteHashSelectedRow} disabled={selectedHashIndex === null}>删除选中行</Button>
          </div>
        </div>
      )}

      {keyType === 'list' && (
        <div>
          <div style={{ marginBottom: 6 }}>列表元素：</div>
          <Table
            dataSource={listElements.map((e, i) => ({ key: String(i), element: e }))}
            columns={oneColColumns(updateListRow) as any}
            pagination={false}
            size="small"
            rowSelection={listRowSelection as any}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={addListRow}>新增元素</Button>
            <Button danger onClick={removeLastListRow}>删除最后一行</Button>
            <Button danger onClick={deleteListSelectedRow} disabled={selectedListIndex === null}>删除选中行</Button>
            <Button onClick={moveListUp} disabled={selectedListIndex === null || selectedListIndex <= 0}>上移</Button>
            <Button onClick={moveListDown} disabled={selectedListIndex === null || selectedListIndex >= listElements.length - 1}>下移</Button>
          </div>
        </div>
      )}

      {keyType === 'set' && (
        <div>
          <div style={{ marginBottom: 6 }}>集合成员：</div>
          <Table
            dataSource={setMembers.map((e, i) => ({ key: String(i), element: e }))}
            columns={oneColColumns(updateSetRow) as any}
            pagination={false}
            size="small"
            rowSelection={setRowSelection as any}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={addSetRow}>新增元素</Button>
            <Button danger onClick={removeLastSetRow}>删除最后一行</Button>
            <Button danger onClick={deleteSetSelectedRow} disabled={selectedSetIndex === null}>删除选中行</Button>
          </div>
        </div>
      )}

      {keyType === 'zset' && (
        <div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ marginBottom: 6 }}>分数：</div>
            <InputNumber value={zsetScore} onChange={(v) => setZsetScore(Number(v) || 0)} style={{ width: '100%' }} placeholder="例如 1" />
          </div>
          <div style={{ marginBottom: 6 }}>成员（按同一分数）：</div>
          <Table
            dataSource={zsetMembers.map((e, i) => ({ key: String(i), element: e }))}
            columns={oneColColumns(updateZsetRow) as any}
            pagination={false}
            size="small"
            rowSelection={zsetRowSelection as any}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button onClick={addZsetRow}>新增元素</Button>
            <Button danger onClick={removeLastZsetRow}>删除最后一行</Button>
            <Button danger onClick={deleteZsetSelectedRow} disabled={selectedZsetIndex === null}>删除选中行</Button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div style={{ marginBottom: 6 }}>TTL（秒，可选）：</div>
        <InputNumber
          min={-1}
          value={ttlSeconds}
          onChange={(v) => setTtlSeconds(Number(v ?? -1))}
          style={{ width: '100%' }}
          placeholder="例如 3600（1小时）；-1 表示不过期"
        />
      </div>
    </Modal>
  );
};

export default RedisAddKeyModal;