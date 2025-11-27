import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { DatabaseConnection } from '../../renderer/types';
import { DatabaseService } from './DatabaseService';

/**
 * 数据导入服务 - 负责处理不同格式的数据导入
 */
export class DataImportService {
  private databaseService: DatabaseService;

  constructor(databaseService: DatabaseService) {
    this.databaseService = databaseService;
  }

  /**
   * 解析CSV文件
   */
  private parseCsvFile(filePath: string): any[] {
    const csvContent = fs.readFileSync(filePath, 'utf-8');
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    return records;
  }

  /**
   * 解析JSON文件
   */
  private parseJsonFile(filePath: string): any[] {
    const jsonContent = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(jsonContent);
    return Array.isArray(data) ? data : [data];
  }

  /**
   * 解析XLSX文件
   */
  private parseXlsxFile(filePath: string): any[] {
    const workbook = XLSX.readFile(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);
    return data;
  }

  /**
   * 根据文件扩展名选择解析方法
   */
  parseFile(filePath: string): any[] {
    const ext = path.extname(filePath).toLowerCase();
    
    switch (ext) {
      case '.csv':
        return this.parseCsvFile(filePath);
      case '.json':
        return this.parseJsonFile(filePath);
      case '.xlsx':
      case '.xls':
        return this.parseXlsxFile(filePath);
      default:
        throw new Error(`不支持的文件格式: ${ext}`);
    }
  }

  /**
   * 生成插入SQL语句
   */
  private generateInsertSql(tableName: string, data: any[]): string[] {
    if (data.length === 0) {
      return [];
    }

    const columns = Object.keys(data[0]);
    const sqlStatements: string[] = [];

    // 分批次插入，每批次1000条
    const batchSize = 1000;
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      const values = batch.map(row => {
        const rowValues = columns.map(col => {
          const value = row[col];
          if (value === null || value === undefined) {
            return 'NULL';
          } else if (typeof value === 'string') {
            // 转义单引号和反斜杠
            const escapedValue = value.replace(/\\/g, '\\\\').replace(/'/g, "''");
            return `'${escapedValue}'`;
          } else if (typeof value === 'boolean') {
            return value ? '1' : '0';
          } else if (typeof value === 'number') {
            return value.toString();
          } else {
            return `'${JSON.stringify(value)}'`;
          }
        });
        return `(${rowValues.join(', ')})`;
      });

      const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${values.join(', ')}`;
      sqlStatements.push(sql);
    }

    return sqlStatements;
  }

  /**
   * 导入数据到数据库
   */
  async importDataToDatabase(
    connection: DatabaseConnection,
    databaseName: string,
    tableName: string,
    filePath: string
  ): Promise<{ success: boolean; message: string; importedRows: number }> {
    try {
      // 解析文件
      const data = this.parseFile(filePath);
      
      if (data.length === 0) {
        return { success: false, message: '文件中没有数据', importedRows: 0 };
      }

      // 生成插入SQL
      const sqlStatements = this.generateInsertSql(tableName, data);
      
      // 创建数据库连接，转换authType类型
      const connectionConfig = {
        ...connection,
        authType: connection.authType === 'none' ? undefined : connection.authType
      };
      
      const poolId = await this.databaseService.createConnectionPool(connectionConfig);
      
      // 执行插入语句
      for (const sql of sqlStatements) {
        await this.databaseService.executeQuery(poolId, sql);
      }
      
      return { 
        success: true, 
        message: `成功导入 ${data.length} 行数据到表 ${tableName}`, 
        importedRows: data.length 
      };
    } catch (error) {
      console.error('导入数据失败:', error);
      return { 
        success: false, 
        message: `导入数据失败: ${(error as Error).message}`, 
        importedRows: 0 
      };
    }
  }

  /**
   * 预览文件数据
   */
  previewFileData(filePath: string, limit: number = 10): { data: any[]; columns: string[] } {
    const data = this.parseFile(filePath);
    const previewData = data.slice(0, limit);
    const columns = previewData.length > 0 ? Object.keys(previewData[0]) : [];
    
    return { data: previewData, columns };
  }

  /**
   * 支持的文件格式
   */
  getSupportedFileFormats(): string[] {
    return ['csv', 'json', 'xlsx', 'xls'];
  }
}