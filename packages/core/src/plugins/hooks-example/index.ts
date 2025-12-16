/**
 * 示例：Hook-Based Plugin
 *
 * 展示如何使用新的 Hook Registry 模式编写插件。
 * 相比旧版 API，新版 API 的优势：
 * - 插件自主选择执行模式（tap/tapAsync/tapPromise）
 * - 并行执行（AsyncParallelHook）提升性能
 * - 更清晰的类型定义
 * - 更灵活的优先级控制（stage 参数）
 */

import type {
  PluginMetadata,
  PluginTranslations,
  PluginStorage,
  Plugin,
} from '../../plugin.types';
import { definePlugin } from '../../plugin.types';
import type { PluginHooks, PluginInitContext, PluginLogger } from '../../hooks';

/**
 * 示例：统计指标插件（使用新 API）
 *
 * 功能：
 * - 记录请求计数
 * - 记录错误计数
 * - 记录请求延迟
 *
 * 特点：
 * - 使用 AsyncParallelHook 并行执行（不阻塞主流程）
 * - 使用 tapAsync 实现 fire-and-forget 模式
 */
export const MetricsExamplePlugin = definePlugin(
  class implements Plugin {
    static readonly name = 'metrics-example';
    static readonly version = '1.0.0';

    static readonly metadata: PluginMetadata = {
      name: 'metadata.name',
      description: 'plugin.description',
      icon: 'analytics',
    };

    static readonly translations: PluginTranslations = {
      en: {
        'metadata.name': 'Metrics Example',
        'plugin.description': 'Example plugin demonstrating Hook-Based API for metrics collection',
      },
      'zh-CN': {
        'metadata.name': '指标统计示例',
        'plugin.description': '演示使用新 Hook API 进行指标收集的示例插件',
      },
    };

    /** @internal */
    storage!: PluginStorage;
    /** @internal */
    logger!: PluginLogger;

    /**
     * 插件初始化
     * 在 register 之前调用
     */
    async init(context: PluginInitContext): Promise<void> {
      this.storage = context.storage;
      this.logger = context.logger;
      this.logger.info('MetricsExamplePlugin initialized');
    }

    /**
     * 注册 Hooks
     * 这是新 API 的核心 - 插件自主选择要注册的 hooks 和执行模式
     */
    register(hooks: PluginHooks): void {
      // 1. 请求初始化：使用 tapAsync 实现 fire-and-forget
      //    AsyncParallelHook 会并行执行所有回调
      hooks.onRequestInit.tapAsync(
        { name: 'metrics-example', stage: 100 }, // stage 正数 = 后执行
        (ctx, done) => {
          // 异步记录，不阻塞
          this.storage
            .increment('metrics', 'totalRequests')
            .then(() => done())
            .catch((err) => {
              this.logger.error('Failed to increment request count', { error: err });
              done(); // 即使失败也调用 done
            });
        }
      );

      // 2. 错误处理：并行记录错误
      hooks.onError.tapPromise(
        { name: 'metrics-example' },
        async (ctx) => {
          await this.storage.increment('metrics', 'totalErrors');
          this.logger.warn('Request error recorded', {
            error: ctx.error.message,
            requestId: ctx.requestId,
          });
        }
      );

      // 3. 请求完成：记录延迟
      hooks.onFinally.tapPromise(
        { name: 'metrics-example' },
        async (ctx) => {
          // 记录延迟分布
          const bucket = this.getLatencyBucket(ctx.latencyMs);
          await this.storage.increment('metrics', `latency_${bucket}`);

          this.logger.debug('Request completed', {
            requestId: ctx.requestId,
            success: ctx.success,
            latencyMs: ctx.latencyMs,
          });
        }
      );
    }

    /**
     * 获取延迟分桶
     * @internal
     */
    getLatencyBucket(latencyMs: number): string {
      if (latencyMs < 100) return 'fast';
      if (latencyMs < 500) return 'normal';
      if (latencyMs < 1000) return 'slow';
      return 'very_slow';
    }

    /**
     * 重置状态（对象池使用）
     */
    async reset(): Promise<void> {
      // 无状态需要重置
    }

    /**
     * 插件销毁
     */
    async onDestroy(): Promise<void> {
      this.logger.info('MetricsExamplePlugin destroyed');
    }
  }
);

/**
 * 示例：请求修改插件（使用新 API）
 *
 * 功能：
 * - 添加自定义 Header
 * - 修改请求 URL 路径
 *
 * 特点：
 * - 使用 AsyncSeriesWaterfallHook 串行执行
 * - 使用 tap 同步注册（简单操作）
 * - 使用 stage 控制执行优先级
 */
export const HeaderInjectionExamplePlugin = definePlugin(
  class implements Plugin {
    static readonly name = 'header-injection-example';
    static readonly version = '1.0.0';

    static readonly metadata: PluginMetadata = {
      name: 'Header Injection Example',
      description: 'Example plugin demonstrating request modification with Hook-Based API',
      icon: 'http',
    };

    /** @internal */
    customHeaders: Record<string, string> = {};

    async init(context: PluginInitContext): Promise<void> {
      // 从配置读取自定义 headers
      this.customHeaders = context.config.headers || {
        'X-Plugin-Version': '1.0.0',
        'X-Powered-By': 'Bungee',
      };
    }

    register(hooks: PluginHooks): void {
      // 使用 tap（同步）注册，因为操作很简单
      // stage: -50 表示较早执行
      hooks.onBeforeRequest.tap(
        { name: 'header-injection-example', stage: -50 },
        (ctx) => {
          // 注入自定义 headers
          Object.assign(ctx.headers, this.customHeaders);
          return ctx; // 瀑布模式必须返回
        }
      );
    }
  }
);

/**
 * 示例：缓存插件（使用新 API）
 *
 * 功能：
 * - 检查缓存命中
 * - 缓存响应
 *
 * 特点：
 * - 使用 AsyncSeriesBailHook 实现短路返回
 * - 使用 tapPromise 注册异步操作
 */
export const CacheExamplePlugin = definePlugin(
  class implements Plugin {
    static readonly name = 'cache-example';
    static readonly version = '1.0.0';

    static readonly metadata: PluginMetadata = {
      name: 'Cache Example',
      description: 'Example plugin demonstrating caching with Hook-Based API',
      icon: 'cached',
    };

    /** @internal */
    cache = new Map<string, { response: Response; expireAt: number }>();
    /** @internal */
    ttlMs = 60000; // 60 秒

    async init(context: PluginInitContext): Promise<void> {
      this.ttlMs = context.config.ttlMs || 60000;
    }

    register(hooks: PluginHooks): void {
      // 1. 拦截请求：检查缓存
      //    AsyncSeriesBailHook - 返回 Response 则短路
      hooks.onInterceptRequest.tapPromise(
        { name: 'cache-example', stage: -100 }, // 最早执行
        async (ctx) => {
          const key = this.getCacheKey(ctx);
          const cached = this.cache.get(key);

          if (cached && cached.expireAt > Date.now()) {
            // 缓存命中，短路返回
            return cached.response.clone();
          }

          // 缓存未命中或已过期
          if (cached) {
            this.cache.delete(key);
          }

          return undefined; // 继续执行后续插件
        }
      );

      // 2. 响应处理：缓存响应
      hooks.onResponse.tapPromise(
        { name: 'cache-example' },
        async (response, ctx) => {
          if (response.status === 200 && ctx.method === 'GET') {
            const key = this.getCacheKey(ctx);
            this.cache.set(key, {
              response: response.clone(),
              expireAt: Date.now() + this.ttlMs,
            });
          }
          return response; // 瀑布模式必须返回
        }
      );
    }

    /** @internal */
    getCacheKey(ctx: { method: string; originalUrl: URL }): string {
      return `${ctx.method}:${ctx.originalUrl.pathname}${ctx.originalUrl.search}`;
    }

    async reset(): Promise<void> {
      // 不清空缓存，因为缓存是跨请求共享的
    }

    async onDestroy(): Promise<void> {
      this.cache.clear();
    }
  }
);

export default {
  MetricsExamplePlugin,
  HeaderInjectionExamplePlugin,
  CacheExamplePlugin,
};
