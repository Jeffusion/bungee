import type { Plugin, PluginContext, PluginInitContext, PluginMetadata, PluginStorage, PluginTranslations } from '../../plugin.types';
import { definePlugin } from '../../plugin.types';

const TokenCachePlugin = definePlugin(
  class implements Plugin {
    /**
     * 插件唯一标识符（静态）
     */
    static readonly name = 'token-cache-demo';

    /**
     * 插件版本（静态）
     */
    static readonly version = '1.0.0';

    /**
     * 插件扩展元数据（静态）
     */
    static readonly metadata: PluginMetadata = {
      name: 'metadata.name',
      description: 'plugin.description',
      icon: 'save',
      contributes: {
        navigation: [
          {
            label: 'Cache Status',
            path: '/status',
            icon: 'speed',
            target: 'header'
          }
        ],
        widgets: [
          {
            title: 'Cache Statistics',
            path: '/panel/stats',
            size: 'small'
          }
        ],
        settings: '/settings'
      }
    };

    /**
     * 插件翻译内容（静态）
     */
    static readonly translations: PluginTranslations = {
      en: {
        'plugin.description': 'A demo plugin showing stateful caching and UI integration',
        'metadata.name': 'Token Cache (Demo)'
      },
      'zh-CN': {
        'plugin.description': '演示插件：展示有状态缓存和 UI 集成',
        'metadata.name': 'Token 缓存（演示）'
      }
    };

    storage: PluginStorage | undefined;
    logger: any;

  async onInit(ctx: PluginInitContext) {
    this.storage = ctx.storage;
    this.logger = ctx.logger;
    this.logger.info('TokenCachePlugin initialized');
  }

  async onInterceptRequest(ctx: PluginContext): Promise<Response | null> {
    if (!this.storage) return null;

    if (ctx.method !== 'POST') return null;

    // 简单生成 cache key (实际应更复杂)
    const key = await this.generateCacheKey(ctx);

    const cached = await this.storage.get(key);
    if (cached) {
      this.logger.info({ key }, 'Cache hit');

      // 更新统计
      await this.incrementStats('hits');

      return new Response(cached.body, {
        headers: {
          ...cached.headers,
          'X-Cache': 'HIT',
          'X-Cache-Plugin': TokenCachePlugin.name
        },
        status: cached.status
      });
    }

    this.logger.info({ key }, 'Cache miss');
    await this.incrementStats('misses');
    return null;
  }

  async onResponse(ctx: PluginContext & { response: Response }): Promise<Response | void> {
    if (!this.storage || !ctx.response.ok) return;

    // 只有 POST 请求才缓存 (简化逻辑)
    if (ctx.method !== 'POST') return;

    const response = ctx.response;
    const key = await this.generateCacheKey(ctx);

    // 克隆响应以读取内容
    const cloned = response.clone();
    const body = await cloned.text();

    // 异步缓存 (不阻塞响应)
    this.cacheResponse(key, response, body).catch(err => {
      this.logger.error({ error: err }, 'Failed to cache response');
    });

    return response;
  }

  async generateCacheKey(ctx: PluginContext): Promise<string> {
    // 简单使用 URL 和 body hash
    const bodyStr = JSON.stringify(ctx.body || {});
    const url = ctx.url.href;
    const input = `${url}|${bodyStr}`;

    // 使用简单的 hash (实际生产应使用 crypto)
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return `req_${hash}`;
  }

  async cacheResponse(key: string, response: Response, body: string) {
    if (!this.storage) return;

    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => headers[k] = v);

    await this.storage.set(key, {
      status: response.status,
      headers,
      body
    }, 60); // 缓存 60 秒
  }

  async incrementStats(type: 'hits' | 'misses') {
    if (!this.storage) return;

    const statsKey = 'stats';
    // 使用原子递增操作，避免并发竞争
    await this.storage.increment(statsKey, type, 1);
  }
}
);

export default TokenCachePlugin;
