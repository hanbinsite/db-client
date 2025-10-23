import React from 'react';
import { Card } from 'antd';
import type { DatabaseConnection } from '../../types';
import QueryPanel from '../sql-query/QueryPanel';

interface Props {
  connection: DatabaseConnection;
  database: string;
  darkMode?: boolean;
}

const MySqlCliPage: React.FC<Props> = ({ connection, database, darkMode = false }) => {
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Card title="MySQL 命令行" bordered style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <QueryPanel connection={connection} database={database} darkMode={darkMode} />
        </div>
      </Card>
    </div>
  );
};

export default MySqlCliPage;