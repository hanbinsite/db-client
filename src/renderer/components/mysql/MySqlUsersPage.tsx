import React, { useState, useEffect } from 'react';
import { Card, Table, Empty, Typography, Spin, Tag, Button, Modal, Form, Input, Checkbox, message, Space, Popconfirm } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { DatabaseConnection } from '../../types';
import { getDbUtils } from '../../utils/db';
import type { MySqlDbUtils } from '../../utils/db/mysql';
import './MySqlUsersPage.css';
import { PlusOutlined, EditOutlined, DeleteOutlined, KeyOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

interface MySqlUsersPageProps {
  connection: DatabaseConnection;
  database: string;
  darkMode?: boolean;
}

interface UserData {
  key: string;
  username: string;
  host: string;
  privileges: string;
  password?: string;
  created?: string;
  max_connections?: number;
}

interface Privilege {
  name: string;
  description: string;
  category: string;
}

const MySqlUsersPage: React.FC<MySqlUsersPageProps> = ({ connection, database, darkMode }) => {
  const [userData, setUserData] = useState<UserData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isAddModalVisible, setIsAddModalVisible] = useState<boolean>(false);
  const [isEditModalVisible, setIsEditModalVisible] = useState<boolean>(false);
  const [isPrivilegeModalVisible, setIsPrivilegeModalVisible] = useState<boolean>(false);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [form] = Form.useForm();
  const [privileges, setPrivileges] = useState<Privilege[]>([]);
  const [selectedPrivileges, setSelectedPrivileges] = useState<string[]>([]);

  // 获取用户列表
  const fetchUsers = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const dbUtils = getDbUtils('mysql') as MySqlDbUtils;
        const users = await dbUtils.getUsers(connection);
        
        if (users.length > 0) {
          const formattedUsers: UserData[] = users.map((user, index) => ({
            key: `${user.user}@${user.host}`,
            username: user.user,
            host: user.host,
            privileges: user.privileges,
          }));
          setUserData(formattedUsers);
        }
      } catch (err) {
        console.error('获取MySQL用户信息失败:', err);
        setError('获取用户信息失败，请检查连接权限');
      } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [connection]);

  // 数据库级别权限更新功能将在后续实现

  // 处理新增用户
  const handleAddUser = async (values: any) => {
    try {
      const dbUtils = getDbUtils('mysql') as MySqlDbUtils;
      await dbUtils.createUser(connection, values.username, values.host, values.password);
      message.success('用户创建成功');
        setIsAddModalVisible(false);
        form.resetFields();
        fetchUsers();
    } catch (err) {
      console.error('创建用户失败:', err);
      message.error('创建用户失败，请检查权限');
    }
  };

  // 处理编辑用户
  const handleEditUser = async (values: any) => {
    if (!selectedUser) return;
    
    try {
      const dbUtils = getDbUtils('mysql') as MySqlDbUtils;
      
      // 如果主机发生变化，需要先创建新用户再删除旧用户
      if (values.host && values.host !== selectedUser.host) {
        // 创建新用户
        await dbUtils.createUser(connection, selectedUser.username, values.host, values.password);
        // 复制权限（如果有）
        if (selectedUser.privileges && selectedUser.privileges !== '权限信息') {
          const privileges = selectedUser.privileges.split(',').map(p => p.trim()).filter(p => p);
          await dbUtils.updateUserPrivileges(connection, selectedUser.username, values.host, privileges);
        }
        // 删除旧用户
        await dbUtils.deleteUser(connection, selectedUser.username, selectedUser.host);
      } else if (values.password) {
        // 只更新密码
        await dbUtils.updateUser(connection, selectedUser.username, selectedUser.host, values.password);
      }
      message.success('用户更新成功');
        setIsEditModalVisible(false);
        form.resetFields();
        fetchUsers();
    } catch (err) {
      console.error('更新用户失败:', err);
      message.error('更新用户失败，请检查权限');
    }
  };

  // 处理删除用户
  const handleDeleteUser = async (user: UserData) => {
    try {
      const dbUtils = getDbUtils('mysql') as MySqlDbUtils;
      await dbUtils.deleteUser(connection, user.username, user.host);
      message.success('用户删除成功');
        fetchUsers();
    } catch (err) {
      console.error('删除用户失败:', err);
      message.error('删除用户失败，请检查权限');
    }
  };

  // 数据库级别权限分类
  const getMysqlPrivileges = (): Privilege[] => {
    return [
      { name: 'SELECT', description: '允许从表中查询数据', category: '数据操作' },
      { name: 'INSERT', description: '允许向表中插入数据', category: '数据操作' },
      { name: 'UPDATE', description: '允许更新表中的数据', category: '数据操作' },
      { name: 'DELETE', description: '允许删除表中的数据', category: '数据操作' },
      { name: 'CREATE', description: '允许创建数据库和表', category: '结构管理' },
      { name: 'DROP', description: '允许删除数据库和表', category: '结构管理' },
      { name: 'ALTER', description: '允许修改表结构', category: '结构管理' },
      { name: 'INDEX', description: '允许创建和删除索引', category: '结构管理' },
      { name: 'REFERENCES', description: '允许创建外键约束', category: '结构管理' },
      { name: 'CREATE USER', description: '允许创建新用户', category: '用户管理' },
      { name: 'DROP USER', description: '允许删除用户', category: '用户管理' },
      { name: 'RELOAD', description: '允许使用FLUSH命令', category: '服务器管理' },
      { name: 'SHUTDOWN', description: '允许关闭MySQL服务器', category: '服务器管理' },
      { name: 'PROCESS', description: '允许查看所有进程', category: '服务器管理' },
      { name: 'FILE', description: '允许在服务器上读写文件', category: '服务器管理' },
      { name: 'GRANT OPTION', description: '允许授予他人权限', category: '权限管理' },
      { name: 'REFERENCES', description: '允许创建外键', category: '数据约束' },
      { name: 'ALL', description: '所有权限', category: '全部权限' },
      { name: 'SUPER', description: '超级用户权限', category: '全部权限' }
    ];
  };

  // 处理权限变更
  const handlePrivilegeChange = async () => {
    if (!selectedUser) return;
    
    try {
      const dbUtils = getDbUtils('mysql') as MySqlDbUtils;
      await dbUtils.updateUserPrivileges(connection, selectedUser.username, selectedUser.host, selectedPrivileges);
      message.success('权限更新成功');
        setIsPrivilegeModalVisible(false);
        fetchUsers();
    } catch (err) {
      console.error('更新权限失败:', err);
      message.error('更新权限失败，请检查权限');
    }
  };

  // 处理权限选择变化
  const onPrivilegeChange = (checkedValues: string[]) => {
    setSelectedPrivileges(checkedValues);
  };

  const columns: ColumnsType<UserData> = [
    {
      title: '用户名',
      dataIndex: 'username',
      key: 'username',
      width: 150,
      render: (text) => <Text strong>{text}</Text>,
    },
    {
      title: '主机',
      dataIndex: 'host',
      key: 'host',
      width: 150,
      render: (text) => (
        <Tag color="processing" className="text-xs">
          {text}
        </Tag>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created',
      key: 'created',
      width: 180,
      render: (text) => <Text type="secondary">{text || '-'}</Text>,
    },
    {
      title: '最大连接数',
      dataIndex: 'max_connections',
      key: 'max_connections',
      width: 120,
      render: (text) => <Text>{text || '无限制'}</Text>,
    },
    {
      title: '操作',
      key: 'action',
      width: 200,
      fixed: 'right',
      render: (_, record) => (
        <Space size="middle">
          <Button 
            type="link" 
            icon={<KeyOutlined />} 
            onClick={() => {
              setSelectedUser(record);
              setSelectedRowKeys([record.key]);
              setPrivileges(getMysqlPrivileges());
              // 设置已选中的权限
              if (record.privileges && record.privileges !== '权限信息') {
                // 使用更健壮的方式处理权限字符串
                const privilegesList = record.privileges
                  .split(',')
                  .map(priv => priv.trim())
                  .filter(priv => priv);
                setSelectedPrivileges(privilegesList);
              } else {
                setSelectedPrivileges([]);
              }
              setIsPrivilegeModalVisible(true);
            }}
            size="small"
          >
            权限
          </Button>
          <Button 
            type="link" 
            icon={<EditOutlined />} 
            onClick={() => {
              setSelectedUser(record);
              form.setFieldsValue({ password: '' });
              setIsEditModalVisible(true);
            }}
            size="small"
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除该用户吗？"
            onConfirm={() => handleDeleteUser(record)}
            okText="确定"
            cancelText="取消"
          >
            <Button 
              type="link" 
              icon={<DeleteOutlined />} 
              danger
              size="small"
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 12 }}>
      <Card 
        title={<Title level={4}>MySQL 用户管理</Title>} 
        className={`mysql-users-page ${darkMode ? 'dark-mode' : ''}`}
        extra={
          <Space>
            <Text type="secondary" className="text-sm">
              共 {userData.length} 个用户
            </Text>
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                setIsAddModalVisible(true);
              }}
            >
              新增用户
            </Button>
            <Button 
              icon={<KeyOutlined />}
              onClick={() => {
                // 检查是否有选中的用户
                if (!selectedUser) {
                  message.warning('请先选择一个用户');
                  return;
                }
                // 打开权限管理弹窗
                setPrivileges(getMysqlPrivileges());
                // 设置已选中的权限
                if (selectedUser.privileges && selectedUser.privileges !== '权限信息') {
                  // 使用更健壮的方式处理权限字符串
                  const privilegesList = selectedUser.privileges
                    .split(',')
                    .map(priv => priv.trim())
                    .filter(priv => priv);
                  setSelectedPrivileges(privilegesList);
                } else {
                  setSelectedPrivileges([]);
                }
                setIsPrivilegeModalVisible(true);
              }}
            >
              服务器权限
            </Button>
          </Space>
        }
        bordered={!darkMode}
        size="default"
      >
        <Spin spinning={loading}>
          {error ? (
            <Empty
              description={
                <Text type="danger">{error}</Text>
              }
            />
          ) : (
            <Table
              columns={columns}
              dataSource={userData}
              pagination={{
                pageSize: 10,
                showSizeChanger: true,
                showQuickJumper: true,
                showTotal: (total) => `共 ${total} 个用户`,
              }}
              locale={{
                emptyText: (
                  <Empty
                    description={
                      <>
                        <Text type="secondary">当前连接下未找到用户信息</Text>
                      </>
                    }
                  />
                ),
              }}
              rowHoverable={true}
              scroll={{ x: 'max-content' }}
              size="small"
              rowSelection={{
                type: 'radio',
                selectedRowKeys,
                onChange: (newSelectedRowKeys, selectedRows) => {
                  setSelectedRowKeys(newSelectedRowKeys);
                  setSelectedUser(selectedRows.length > 0 ? selectedRows[0] : null);
                },
                onSelect: (record) => {
                  setSelectedUser(record);
                }
              }}
            />
          )}
        </Spin>
      </Card>

      {/* 新增用户弹窗 */}
      <Modal
        title="新增MySQL用户"
        open={isAddModalVisible}
        onCancel={() => {
          form.resetFields();
          setIsAddModalVisible(false);
        }}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleAddUser}
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="请输入用户名" />
          </Form.Item>
          <Form.Item
            name="host"
            label="主机"
            rules={[{ required: true, message: '请输入主机地址' }]}
          >
            <Input placeholder="例如: localhost 或 %" defaultValue="localhost" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[
              { required: true, message: '请输入密码' },
              { min: 6, message: '密码长度至少为6位' }
            ]}
          >
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入密码" />
          </Form.Item>
          <Form.Item>
            <Space style={{ float: 'right' }}>
              <Button onClick={() => {
                form.resetFields();
                setIsAddModalVisible(false);
              }}>取消</Button>
              <Button type="primary" htmlType="submit">确定</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 编辑用户弹窗 */}
      <Modal
        title="编辑MySQL用户"
        open={isEditModalVisible}
        onCancel={() => {
          form.resetFields();
          setIsEditModalVisible(false);
        }}
        footer={null}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleEditUser}
        >
          <Form.Item label="当前用户">
            <Text strong>{selectedUser?.username}@{selectedUser?.host}</Text>
          </Form.Item>
          <Form.Item
            name="host"
            label="主机"
            initialValue={selectedUser?.host}
            tooltip="修改主机将创建新用户并删除旧用户"
          >
            <Input placeholder="例如: localhost 或 %" />
          </Form.Item>
          <Form.Item
            name="password"
            label="新密码"
            rules={[
              { required: true, message: '请输入新密码' },
              { min: 6, message: '密码长度至少为6位' }
            ]}
          >
            <Input.Password placeholder="请输入新密码" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="请再次输入密码" />
          </Form.Item>
          <Form.Item>
            <Space style={{ float: 'right' }}>
              <Button onClick={() => {
                form.resetFields();
                setIsEditModalVisible(false);
              }}>取消</Button>
              <Button type="primary" htmlType="submit">确定</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 权限管理弹窗 - 数据库级别 */}
      <Modal
        title={`${selectedUser?.username}@${selectedUser?.host} 数据库级别权限管理`}
        open={isPrivilegeModalVisible}
        onCancel={() => setIsPrivilegeModalVisible(false)}
        footer={null}
        width={900}
        height={600}
      >
        <div style={{ padding: '10px 0' }}>
          <Checkbox.Group 
            value={selectedPrivileges} 
            onChange={onPrivilegeChange}
            style={{ width: '100%' }}
          >
            {privileges.reduce((acc, privilege) => {
              const categoryIndex = acc.findIndex(item => item.category === privilege.category);
              if (categoryIndex === -1) {
                acc.push({
                  category: privilege.category,
                  items: [privilege]
                });
              } else {
                acc[categoryIndex].items.push(privilege);
              }
              return acc;
            }, [] as { category: string; items: Privilege[] }[]).map(group => (
              <div key={group.category} style={{ marginBottom: 16 }}>
                <Typography.Title level={5} style={{ marginBottom: 8 }}>
                  {group.category}
                </Typography.Title>
                <div style={{ paddingLeft: 16 }}>
                  {group.items.map(item => (
                    <div key={item.name} style={{ marginBottom: 8 }}>
                      <Checkbox value={item.name}>
                        <span>
                          <strong>{item.name}</strong>
                          <Text type="secondary"> - {item.description}</Text>
                        </span>
                      </Checkbox>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Checkbox.Group>
        </div>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Space>
            <Button onClick={() => setIsPrivilegeModalVisible(false)}>取消</Button>
            <Button type="primary" onClick={handlePrivilegeChange}>保存权限</Button>
          </Space>
        </div>
      </Modal>
    </div>
  );
};

export default MySqlUsersPage;