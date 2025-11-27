import React, { useState } from 'react';
import { Card, Select, Space, Button } from 'antd';
import {
  LineOutlined,
  BarChartOutlined,
  PieChartOutlined,
  TableOutlined
} from '@ant-design/icons';
import { Line, Bar, Pie } from '@ant-design/plots';
import { QueryResult } from '../../types';

const { Option } = Select;

interface ChartViewProps {
  result: QueryResult;
  darkMode: boolean;
}

const ChartView: React.FC<ChartViewProps> = ({ result, darkMode }) => {
  const [chartType, setChartType] = useState<'line' | 'bar' | 'pie'>('bar');
  const [xField, setXField] = useState<string>('');
  const [yField, setYField] = useState<string>('');
  const [seriesField, setSeriesField] = useState<string>('');

  const data = result.data || [];
  const columns = result.columns || [];

  // 自动选择第一个和第二个字段作为默认的x和y字段
  React.useEffect(() => {
    if (columns.length > 0 && !xField) {
      setXField(columns[0]);
    }
    if (columns.length > 1 && !yField) {
      setYField(columns[1]);
    }
  }, [columns, xField, yField]);

  // 过滤出数值类型的字段
  const numericColumns = columns.filter(col => {
    if (data.length === 0) return false;
    const firstValue = data[0][col];
    return typeof firstValue === 'number' || !isNaN(Number(firstValue));
  });

  // 过滤出非数值类型的字段
  const categoricalColumns = columns.filter(col => {
    if (data.length === 0) return false;
    const firstValue = data[0][col];
    return typeof firstValue !== 'number' && isNaN(Number(firstValue));
  });

  // 准备图表数据
  const chartData = data.map(row => {
    const processedRow: Record<string, any> = {};
    Object.keys(row).forEach(key => {
      // 将数值类型的字段转换为数字
      const value = row[key];
      processedRow[key] = typeof value === 'number' ? value : Number(value) || value;
    });
    return processedRow;
  });

  // 图表配置
  const commonConfig = {
    data: chartData,
    xField,
    yField,
    seriesField: seriesField || undefined,
    theme: darkMode ? 'dark' : 'default',
    style: {
      width: '100%',
      height: '400px'
    }
  };

  const lineConfig = {
    ...commonConfig,
    smooth: true,
    point: {
      size: 5,
      shape: 'diamond'
    },
    tooltip: {
      showMarkers: false
    },
    xAxis: {
      label: {
        autoHide: true,
        autoRotate: false
      }
    }
  };

  const barConfig = {
    ...commonConfig,
    xAxis: {
      label: {
        autoHide: true,
        autoRotate: false
      }
    },
    meta: {
      [yField]: {
        alias: yField
      }
    }
  };

  const pieConfig = {
    data: chartData,
    angleField: yField,
    colorField: xField,
    radius: 0.8,
    label: {
      type: 'outer',
      content: '{name}: {percentage}'
    },
    interactions: [
      {
        type: 'element-active'
      }
    ],
    theme: darkMode ? 'dark' : 'default'
  };

  const renderChart = () => {
    if (!xField || !yField || data.length === 0) {
      return (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '400px',
          color: darkMode ? '#999' : '#666'
        }}>
          请选择合适的字段来生成图表
        </div>
      );
    }

    switch (chartType) {
      case 'line':
        return <Line {...lineConfig} />;
      case 'bar':
        return <Bar {...barConfig} />;
      case 'pie':
        return <Pie {...pieConfig} />;
      default:
        return null;
    }
  };

  return (
    <Card title="查询结果可视化" size="small">
      <Space direction="vertical" style={{ width: '100%' }}>
        <Space wrap>
          <Button
            type={chartType === 'bar' ? 'primary' : 'default'}
            icon={<BarChartOutlined />}
            onClick={() => setChartType('bar')}
          >
            柱状图
          </Button>
          <Button
            type={chartType === 'line' ? 'primary' : 'default'}
            icon={<LineOutlined />}
            onClick={() => setChartType('line')}
          >
            折线图
          </Button>
          <Button
            type={chartType === 'pie' ? 'primary' : 'default'}
            icon={<PieChartOutlined />}
            onClick={() => setChartType('pie')}
          >
            饼图
          </Button>
        </Space>

        <Space wrap style={{ marginTop: 8 }}>
          <div>
            <label style={{ marginRight: 8, fontSize: '12px' }}>X轴字段：</label>
            <Select
              value={xField}
              onChange={setXField}
              style={{ width: 200 }}
              placeholder="选择X轴字段"
            >
              {columns.map(col => (
                <Option key={col} value={col}>{col}</Option>
              ))}
            </Select>
          </div>

          <div>
            <label style={{ marginRight: 8, fontSize: '12px' }}>Y轴字段：</label>
            <Select
              value={yField}
              onChange={setYField}
              style={{ width: 200 }}
              placeholder="选择Y轴字段"
            >
              {numericColumns.map(col => (
                <Option key={col} value={col}>{col}</Option>
              ))}
            </Select>
          </div>

          {chartType !== 'pie' && (
            <div>
              <label style={{ marginRight: 8, fontSize: '12px' }}>系列字段：</label>
              <Select
                value={seriesField}
                onChange={setSeriesField}
                style={{ width: 200 }}
                placeholder="选择系列字段（可选）"
                allowClear
              >
                {categoricalColumns.map(col => (
                  <Option key={col} value={col}>{col}</Option>
                ))}
              </Select>
            </div>
          )}
        </Space>

        <div style={{ marginTop: 16, border: `1px solid ${darkMode ? '#333' : '#f0f0f0'}`, borderRadius: 4, padding: 16 }}>
          {renderChart()}
        </div>
      </Space>
    </Card>
  );
};

export default ChartView;