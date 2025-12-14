import { Database } from 'bun:sqlite';
import { logger } from './logger';

/**
 * 清理服务配置
 */
export interface CleanupServiceConfig {
  /**
   * 是否启用清理服务
   */
  enabled: boolean;

  /**
   * 清理间隔（毫秒）
   * 默认: 1小时 (3600000ms)
   */
  interval?: number;

  /**
   * 每次清理的最大条目数
   * 默认: 1000
   */
  batchSize?: number;

  /**
   * 是否在清理后执行VACUUM
   * 默认: false（VACUUM会锁表，谨慎使用）
   */
  vacuumAfterCleanup?: boolean;
}

// 默认配置
const DEFAULT_CONFIG: Required<CleanupServiceConfig> = {
  enabled: true,
  interval: 3600000, // 1小时
  batchSize: 1000,
  vacuumAfterCleanup: false,
};

/**
 * Plugin Storage 过期数据清理服务
 *
 * 特性：
 * - 定时扫描和删除过期数据
 * - 批量删除（避免长时间锁表）
 * - 可选VACUUM优化
 * - 统计信息收集
 */
export class PluginStorageCleanupService {
  private db: Database;
  private config: Required<CleanupServiceConfig>;
  private timer: Timer | null = null;
  private running = false;

  // 统计信息
  private stats = {
    totalRuns: 0,
    totalDeleted: 0,
    lastRunTime: 0,
    lastDeletedCount: 0,
    lastDuration: 0,
  };

  constructor(db: Database, config?: CleanupServiceConfig) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };

    logger.info(
      { config: this.config },
      'PluginStorageCleanupService initialized'
    );
  }

  /**
   * 启动清理服务
   */
  start(): void {
    if (!this.config.enabled) {
      logger.info('PluginStorageCleanupService is disabled');
      return;
    }

    if (this.timer) {
      logger.warn('PluginStorageCleanupService already started');
      return;
    }

    logger.info(
      { interval: this.config.interval },
      'Starting PluginStorageCleanupService'
    );

    // 立即执行一次清理
    this.cleanup().catch((err) => {
      logger.error({ error: err }, 'Initial cleanup failed');
    });

    // 启动定时器
    this.timer = setInterval(() => {
      this.cleanup().catch((err) => {
        logger.error({ error: err }, 'Scheduled cleanup failed');
      });
    }, this.config.interval);
  }

  /**
   * 停止清理服务
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('PluginStorageCleanupService stopped');
    }
  }

  /**
   * 手动执行清理
   */
  async cleanup(): Promise<number> {
    if (this.running) {
      logger.warn('Cleanup already running, skipping');
      return 0;
    }

    this.running = true;
    const startTime = Date.now();
    let totalDeleted = 0;

    try {
      logger.info('Starting plugin storage cleanup');

      const now = Math.floor(Date.now() / 1000);

      // 分批删除过期数据
      let batchCount = 0;
      let hasMore = true;

      while (hasMore && batchCount < 10) {
        // 最多10批，防止无限循环
        const deleteStmt = this.db.prepare(`
          DELETE FROM plugin_storage
          WHERE rowid IN (
            SELECT rowid FROM plugin_storage
            WHERE ttl IS NOT NULL AND ttl < ?
            LIMIT ?
          )
        `);

        const result = deleteStmt.run(now, this.config.batchSize);
        const deleted = result.changes;

        totalDeleted += deleted;
        batchCount++;

        logger.debug(
          { batch: batchCount, deleted, totalDeleted },
          'Cleanup batch completed'
        );

        // 如果删除的数量少于批次大小，说明已经清理完毕
        hasMore = deleted >= this.config.batchSize;

        // 小延迟，避免长时间占用数据库
        if (hasMore) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      // 可选：执行VACUUM优化
      if (this.config.vacuumAfterCleanup && totalDeleted > 0) {
        logger.info('Running VACUUM after cleanup');
        this.db.run('VACUUM');
      }

      // 更新统计信息
      const duration = Date.now() - startTime;
      this.stats.totalRuns++;
      this.stats.totalDeleted += totalDeleted;
      this.stats.lastRunTime = startTime;
      this.stats.lastDeletedCount = totalDeleted;
      this.stats.lastDuration = duration;

      logger.info(
        {
          deleted: totalDeleted,
          duration,
          batches: batchCount,
        },
        'Plugin storage cleanup completed'
      );

      return totalDeleted;
    } catch (error) {
      logger.error({ error }, 'Plugin storage cleanup failed');
      throw error;
    } finally {
      this.running = false;
    }
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      running: this.running,
      enabled: this.config.enabled,
    };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = {
      totalRuns: 0,
      totalDeleted: 0,
      lastRunTime: 0,
      lastDeletedCount: 0,
      lastDuration: 0,
    };
  }

  /**
   * 获取当前过期数据数量（仅用于监控，不触发清理）
   */
  async getExpiredCount(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);

    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM plugin_storage
      WHERE ttl IS NOT NULL AND ttl < ?
    `);

    const result = stmt.get(now) as { count: number };
    return result.count;
  }

  /**
   * 获取存储统计信息
   */
  async getStorageStats(): Promise<{
    totalEntries: number;
    totalWithTTL: number;
    totalExpired: number;
    totalPlugins: number;
  }> {
    const now = Math.floor(Date.now() / 1000);

    const totalEntriesStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM plugin_storage
    `);
    const totalEntries = (totalEntriesStmt.get() as { count: number }).count;

    const totalWithTTLStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM plugin_storage
      WHERE ttl IS NOT NULL
    `);
    const totalWithTTL = (totalWithTTLStmt.get() as { count: number }).count;

    const totalExpiredStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM plugin_storage
      WHERE ttl IS NOT NULL AND ttl < ?
    `);
    const totalExpired = (totalExpiredStmt.get(now) as { count: number }).count;

    const totalPluginsStmt = this.db.prepare(`
      SELECT COUNT(DISTINCT plugin_name) as count FROM plugin_storage
    `);
    const totalPlugins = (totalPluginsStmt.get() as { count: number }).count;

    return {
      totalEntries,
      totalWithTTL,
      totalExpired,
      totalPlugins,
    };
  }
}
