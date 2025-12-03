import type { DatabaseConnection } from '../../types';
import { PostgresDbUtils } from './postgresql';
import type { DatabaseItem } from '../database-utils';

export class GaussDbUtils extends PostgresDbUtils {
  // GaussDB特有的方法可以在这里添加
  // 继承自PostgresDbUtils的方法会自动可用
}