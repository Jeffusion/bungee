import { Database } from 'bun:sqlite';
import { logger } from './logger';

/**
 * 插件注册表记录
 */
export interface PluginRegistryRecord {
  name: string;
  version: string;
  description?: string;
  path?: string;
  enabled: boolean;
  created_at: number;
  updated_at: number;
}

/**
 * 插件注册表存储
 *
 * 负责在数据库中管理插件的元数据和启用状态。
 * 这是程序数据，独立于配置文件。
 */
export class PluginRegistryStore {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * 注册或更新插件
   */
  upsert(plugin: {
    name: string;
    version: string;
    description?: string;
    path?: string;
    enabled?: boolean;
  }): void {
    const now = Date.now();

    // 检查插件是否已存在
    const existing = this.get(plugin.name);

    if (existing) {
      // 更新已有插件（保留 enabled 状态，除非显式指定）
      const stmt = this.db.prepare(`
        UPDATE plugin_registry
        SET version = ?,
            description = ?,
            path = ?,
            enabled = ?,
            updated_at = ?
        WHERE name = ?
      `);

      stmt.run(
        plugin.version,
        plugin.description || null,
        plugin.path || null,
        plugin.enabled !== undefined ? (plugin.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
        now,
        plugin.name
      );
    } else {
      // 插入新插件（默认禁用）
      const stmt = this.db.prepare(`
        INSERT INTO plugin_registry (name, version, description, path, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        plugin.name,
        plugin.version,
        plugin.description || null,
        plugin.path || null,
        plugin.enabled !== undefined ? (plugin.enabled ? 1 : 0) : 0,
        now,
        now
      );
    }
  }

  /**
   * 获取单个插件
   */
  get(name: string): PluginRegistryRecord | null {
    const stmt = this.db.prepare(`
      SELECT * FROM plugin_registry WHERE name = ?
    `);

    const row = stmt.get(name) as any;
    if (!row) return null;

    return {
      name: row.name,
      version: row.version,
      description: row.description,
      path: row.path,
      enabled: row.enabled === 1,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  /**
   * 获取所有插件
   */
  getAll(): PluginRegistryRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM plugin_registry ORDER BY name
    `);

    const rows = stmt.all() as any[];
    return rows.map(row => ({
      name: row.name,
      version: row.version,
      description: row.description,
      path: row.path,
      enabled: row.enabled === 1,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  /**
   * 获取所有已启用的插件
   */
  getEnabled(): PluginRegistryRecord[] {
    const stmt = this.db.prepare(`
      SELECT * FROM plugin_registry WHERE enabled = 1 ORDER BY name
    `);

    const rows = stmt.all() as any[];
    return rows.map(row => ({
      name: row.name,
      version: row.version,
      description: row.description,
      path: row.path,
      enabled: true,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  /**
   * 检查插件是否已启用
   */
  isEnabled(name: string): boolean {
    const plugin = this.get(name);
    return plugin?.enabled ?? false;
  }

  /**
   * 启用插件
   */
  enable(name: string): boolean {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE plugin_registry
      SET enabled = 1, updated_at = ?
      WHERE name = ?
    `);

    const result = stmt.run(now, name);
    if (result.changes > 0) {
      logger.info({ pluginName: name }, 'Plugin enabled in registry');
      return true;
    }
    return false;
  }

  /**
   * 禁用插件
   */
  disable(name: string): boolean {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE plugin_registry
      SET enabled = 0, updated_at = ?
      WHERE name = ?
    `);

    const result = stmt.run(now, name);
    if (result.changes > 0) {
      logger.info({ pluginName: name }, 'Plugin disabled in registry');
      return true;
    }
    return false;
  }

  /**
   * 删除插件
   */
  delete(name: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM plugin_registry WHERE name = ?
    `);

    const result = stmt.run(name);
    return result.changes > 0;
  }

  /**
   * 清空注册表
   */
  clear(): void {
    this.db.run('DELETE FROM plugin_registry');
  }
}
