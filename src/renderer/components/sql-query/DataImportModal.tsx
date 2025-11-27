import React, { useState } from 'react';
import { Modal, Button, Input, Select, Table, message, Spin, Card } from 'antd';
import { UploadOutlined, EyeOutlined, DatabaseOutlined } from '@ant-design/icons';
import { DatabaseConnection } from '../../types';

const { Option } = Select;

interface DataImportModalProps {
  visible: boolean;
  onCancel: () => void;
  connection: DatabaseConnection | null;
  database: string;
  tables: string[];
  darkMode: boolean;
}

const DataImportModal: React.FC<DataImportModalProps> = ({
  visible,
  onCancel,
  connection,
  database,
  tables,
  darkMode
}) => {
  const [filePath, setFilePath] = useState<string>('');
  const [tableName, setTableName] = useState<string>('');
  const [previewData, setPreviewData] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [importing, setImporting] = useState<boolean>(false);

  // 选择文件
  const handleSelectFile = async () => {
    try {
      const result = await window.electronAPI.showOpenDialog({});
      if (!result.canceled && result.filePaths.length > 0) {
        const selectedFilePath = result.filePaths[0];
        setFilePath(selectedFilePath);
        await handlePreviewFile(selectedFilePath);
      }
    } catch (error) {
      message.error('选择文件失败: ' + (error as Error).message);
    }
  };

  // 预览文件数据
  const handlePreviewFile = async (filePath: string) => {
    setLoading(true);
    try {
      const result = await window.electronAPI.previewFileData({
        filePath,
        limit: 10
      });
      if (result.success) {
        setPreviewData(result.data);
        setColumns(result.columns);
        message.success('文件预览成功');
      } else {
        message.error('文件预览失败: ' + result.message);
      }
    } catch (error) {
      message.error('预览文件数据失败: ' + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  // 导入数据
  const handleImportData = async () => {
    if (!connection) {
      message.warning('请先选择数据库连接');
      return;
    }
    if (!database) {
      message.warning('请先选择数据库');
      return;
    }
    if (!tableName) {
      message.warning('请选择目标表');
      return;
    }
    if (!filePath) {
      message.warning('请选择要导入的文件');
      return;
    }

    setImporting(true);
    try {
      const result = await window.electronAPI.importDataToDatabase({
        connection,
        databaseName: database,
        tableName,
        filePath
      });
      if (result.success) {
        message.success(result.message);
        onCancel();
      } else {
        message.error(result.message);
      }
    } catch (error) {
      message.error('导入数据失败: ' + (error as Error).message);
    } finally {
      setImporting(false);
    }
  };

  // 重置状态
  const handleReset = () => {
    setFilePath('');
    setTableName('');
    setPreviewData([]);
    setColumns([]);
  };

  // 关闭模态框时重置状态
  React.useEffect(() => {
    if (!visible) {
      handleReset();
    }
  }, [visible]);

  return (
    <Modal
      title="数据导入"
      open={visible}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel} disabled={importing}>
          取消
        </Button>,
        <Button
          key="import"
          type="primary"
          onClick={handleImportData}
          loading={importing}
          disabled={!filePath || !tableName || importing}
          icon={<DatabaseOutlined />}
        >
          导入
        </Button>
      ]}
      width={800}
      className={darkMode ? 'dark-modal' : ''}
    >
      <Spin spinning={loading || importing} tip={loading ? '正在预览文件...' : '正在导入数据...'}>
        <Card size="small" title="导入配置" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* 文件选择 */}
            <div>
              <div style={{ marginBottom: 8, fontSize: 12, color: darkMode ? '#999' : '#666' }}>
                1. 选择导入文件
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Input
                  placeholder="请选择要导入的文件"
                  value={filePath}
                  readOnly
                  style={{ flex: 1 }}
                  className={darkMode ? 'dark-input' : ''}
                />
                <Button
                  type="default"
                  icon={<UploadOutlined />}
                  onClick={handleSelectFile}
                  disabled={importing}
                >
                  浏览
                </Button>
                {filePath && (
                  <Button
                    type="default"
                    icon={<EyeOutlined />}
                    onClick={() => handlePreviewFile(filePath)}
                    disabled={loading || importing}
                  >
                    重新预览
                  </Button>
                )}
              </div>
            </div>

            {/* 目标表选择 */}
            <div>
              <div style={{ marginBottom: 8, fontSize: 12, color: darkMode ? '#999' : '#666' }}>
                2. 选择目标表
              </div>
              <Select
                placeholder="请选择要导入的目标表"
                value={tableName}
                onChange={setTableName}
                style={{ width: '100%' }}
                disabled={importing}
                className={darkMode ? 'dark-select' : ''}
              >
                {tables.map(table => (
                  <Option key={table} value={table}>{table}</Option>
                ))}
              </Select>
            </div>
          </div>
        </Card>

        {/* 数据预览 */}
        {previewData.length > 0 && (
          <Card size="small" title="数据预览" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: darkMode ? '#999' : '#666', marginBottom: 8 }}>
              预览前10行数据（共{previewData.length}行）
            </div>
            <Table
              dataSource={previewData}
              columns={columns.map(col => ({
                title: col,
                dataIndex: col,
                key: col,
                ellipsis: true,
                width: 150
              }))}
              size="small"
              pagination={false}
              scroll={{ x: true }}
              className={darkMode ? 'dark-table' : ''}
            />
          </Card>
        )}

        {/* 导入说明 */}
        <Card size="small" title="导入说明" type="inner">
          <ul style={{ fontSize: 12, color: darkMode ? '#999' : '#666', margin: 0, paddingLeft: 16 }}>
            <li>支持CSV、JSON、XLSX等格式文件导入</li>
            <li>导入前请确保目标表已存在，且字段名与文件中的列名匹配</li>
            <li>导入过程中请勿关闭窗口或断开数据库连接</li>
            <li>导入完成后会自动刷新表数据</li>
          </ul>
        </Card>
      </Spin>
    </Modal>
  );
};

export default DataImportModal;