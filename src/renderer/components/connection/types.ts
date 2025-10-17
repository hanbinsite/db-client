import React from 'react';
import { DatabaseConnection, DatabaseType } from '../../types';
import { FormInstance } from 'antd';

// 连接面板基础Props接口
export interface BaseConnectionPanelProps {
  form: FormInstance;
  connection?: DatabaseConnection | null;
  databaseType: DatabaseType;
  darkMode: boolean;
  onUrlChange?: (url: string) => void;
  initialValues?: Record<string, any>;
}

// 连接面板组件接口
export interface ConnectionPanelComponent extends React.FC<BaseConnectionPanelProps> {
  // 组件可能需要的静态属性
  databaseType: DatabaseType;
  label: string;
  defaultPort: number;
}

// 连接面板工厂Props接口
export interface ConnectionPanelFactoryProps {
  form: FormInstance;
  databaseType: DatabaseType;
  connection?: DatabaseConnection | null;
  darkMode: boolean;
  onUrlChange?: (url: string) => void;
  initialValues?: Record<string, any>;
}