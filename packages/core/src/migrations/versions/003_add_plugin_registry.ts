import type { Migration } from '../migration.types';
import type { Database } from 'bun:sqlite';

export const migration: Migration = {
  version: '003',
  name: 'add_plugin_registry',
  up: (db: Database) => {
    // 创建插件注册表
    // 用于存储插件的元数据和启用状态
    db.run(`
      CREATE TABLE IF NOT EXISTS plugin_registry (
        name TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        description TEXT,
        path TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // 创建索引以优化启用状态查询
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_plugin_registry_enabled
      ON plugin_registry(enabled)
    `);
  }
};
