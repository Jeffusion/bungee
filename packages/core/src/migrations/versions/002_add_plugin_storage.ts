import type { Migration } from '../migration.types';
import type { Database } from 'bun:sqlite';

export const migration: Migration = {
  version: '002',
  name: 'add_plugin_storage',
  up: (db: Database) => {
    // 创建插件存储表
    // 用于持久化插件的 Key-Value 数据
    // 包含 TTL 支持
    db.run(`
      CREATE TABLE IF NOT EXISTS plugin_storage (
        plugin_name TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        ttl INTEGER, -- 过期时间戳（秒），NULL 表示永不过期
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_name, key)
      )
    `);

    // 创建索引以优化清理过期数据的性能
    db.run(`
      CREATE INDEX IF NOT EXISTS idx_plugin_storage_ttl
      ON plugin_storage(ttl)
      WHERE ttl IS NOT NULL
    `);
  }
};
