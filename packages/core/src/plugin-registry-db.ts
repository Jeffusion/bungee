import { Database } from 'bun:sqlite';
import { logger } from './logger';
import type { PluginConstructor } from './plugin.types';

/**
 * 插件注册表数据库接口
 *
 * 职责：
 * - 管理插件的启用/禁用状态（唯一真相来源）
 * - 与文件系统扫描的插件进行同步
 * - 提供插件状态查询接口
 *
 * 说明：
 * - 插件状态完全由数据库管理，不再从 config.json 读取
 * - 新发现的插件默认为禁用状态
 * - 用户通过 UI 或 API 启用/禁用插件
 */

/**
 * 数据库中的插件记录
 */
export interface PluginRecord {
  name: string;
  version: string;
  description: string;
  path: string | null;
  enabled: number; // SQLite INTEGER: 0=禁用, 1=启用
  created_at: number;
  updated_at: number;
}

/**
 * 插件注册表数据库管理器
 */
export class PluginRegistryDB {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * 同步插件到数据库
   *
   * 将文件系统扫描到的插件与数据库进行同步：
   * - 新插件 → 插入数据库（默认禁用）
   * - 已存在 → 更新元数据，保留启用状态
   *
   * @param pluginName 插件名称
   * @param pluginConstructor 插件构造函数（用于获取元数据）
   * @param pluginPath 插件文件路径
   * @returns 插件的启用状态
   */
  async syncPlugin(
    pluginName: string,
    pluginConstructor: PluginConstructor,
    pluginPath: string
  ): Promise<boolean> {
    try {
      const now = Date.now();
      const version = pluginConstructor.version;
      const description = pluginConstructor.metadata?.description || '';

      // 检查插件是否已存在
      const existing = this.db
        .prepare('SELECT enabled FROM plugin_registry WHERE name = ?')
        .get(pluginName) as { enabled: number } | null;

      if (existing) {
        // 插件已存在，更新元数据但保留启用状态
        this.db
          .prepare(`
            UPDATE plugin_registry
            SET version = ?, description = ?, path = ?, updated_at = ?
            WHERE name = ?
          `)
          .run(version, description, pluginPath, now, pluginName);

        logger.debug(
          { pluginName, enabled: existing.enabled === 1 },
          'Plugin metadata updated in database'
        );

        return existing.enabled === 1;
      } else {
        // 新插件，插入数据库（默认禁用）
        this.db
          .prepare(`
            INSERT INTO plugin_registry
            (name, version, description, path, enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, ?, ?)
          `)
          .run(pluginName, version, description, pluginPath, now, now);

        logger.info(
          { pluginName, version, description },
          'New plugin registered in database (disabled by default)'
        );

        return false; // 新插件默认禁用
      }
    } catch (error) {
      logger.error(
        { error, pluginName },
        'Failed to sync plugin to database'
      );
      return false;
    }
  }

  /**
   * 获取插件的启用状态
   *
   * @param pluginName 插件名称
   * @returns 启用状态（true=启用，false=禁用或不存在）
   */
  isPluginEnabled(pluginName: string): boolean {
    try {
      const result = this.db
        .prepare('SELECT enabled FROM plugin_registry WHERE name = ?')
        .get(pluginName) as { enabled: number } | null;

      return result?.enabled === 1;
    } catch (error) {
      logger.error(
        { error, pluginName },
        'Failed to check plugin enabled status'
      );
      return false;
    }
  }

  /**
   * 启用插件
   *
   * @param pluginName 插件名称
   * @returns 是否成功
   */
  enablePlugin(pluginName: string): boolean {
    try {
      const result = this.db
        .prepare(`
          UPDATE plugin_registry
          SET enabled = 1, updated_at = ?
          WHERE name = ?
        `)
        .run(Date.now(), pluginName);

      if (result.changes > 0) {
        logger.info({ pluginName }, 'Plugin enabled in database');
        return true;
      }

      logger.warn(
        { pluginName },
        'Plugin not found in database, cannot enable'
      );
      return false;
    } catch (error) {
      logger.error({ error, pluginName }, 'Failed to enable plugin');
      return false;
    }
  }

  /**
   * 禁用插件
   *
   * @param pluginName 插件名称
   * @returns 是否成功
   */
  disablePlugin(pluginName: string): boolean {
    try {
      const result = this.db
        .prepare(`
          UPDATE plugin_registry
          SET enabled = 0, updated_at = ?
          WHERE name = ?
        `)
        .run(Date.now(), pluginName);

      if (result.changes > 0) {
        logger.info({ pluginName }, 'Plugin disabled in database');
        return true;
      }

      logger.warn(
        { pluginName },
        'Plugin not found in database, cannot disable'
      );
      return false;
    } catch (error) {
      logger.error({ error, pluginName }, 'Failed to disable plugin');
      return false;
    }
  }

  /**
   * 获取所有插件记录
   *
   * @returns 所有插件记录
   */
  getAllPlugins(): PluginRecord[] {
    try {
      return this.db
        .prepare('SELECT * FROM plugin_registry ORDER BY name')
        .all() as PluginRecord[];
    } catch (error) {
      logger.error({ error }, 'Failed to get all plugins from database');
      return [];
    }
  }

  /**
   * 获取所有已启用的插件名称
   *
   * @returns 已启用插件的名称数组
   */
  getEnabledPluginNames(): string[] {
    try {
      const results = this.db
        .prepare('SELECT name FROM plugin_registry WHERE enabled = 1')
        .all() as { name: string }[];

      return results.map(r => r.name);
    } catch (error) {
      logger.error({ error }, 'Failed to get enabled plugins from database');
      return [];
    }
  }
}
