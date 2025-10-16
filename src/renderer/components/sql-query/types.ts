import { DatabaseConnection, QueryResult } from '../../types';

// 基础查询面板属性接口
export interface BaseQueryPanelProps {
  connection: DatabaseConnection | null;
  database: string;
  tabKey?: string;
  onTabClose?: (key: string) => void;
  darkMode: boolean;
}

// 批量查询结果接口
export interface BatchQueryResult {
  success: boolean;
  results: QueryResult[];
  executionTime: number;
}