import type { Plugin, PluginTranslations } from './plugin.types';
import type { PluginConfig } from '@jeffusion/bungee-types';
import { logger } from './logger';
import * as path from 'path';
import * as fs from 'fs';
import { getPluginContextManager, isPluginContextManagerInitialized } from './plugin-context-manager';
import { getPermissionManager } from './plugin-permissions';
import { PluginRegistryDB } from './plugin-registry-db';
import type { Database } from 'bun:sqlite';

/**
 * Plugin 工厂函数类型
 */
type PluginFactory = new (options: any) => Plugin;

/**
 * Plugin 工厂信息
 */
interface PluginFactoryInfo {
  PluginClass: PluginFactory;
  config: PluginConfig;
  enabled: boolean;
}

/**
 * Plugin 路径解析器
 *
 * 两级目录架构：
 * 1. 系统级（System-level）: {baseDir}/plugins - 编译后的内置插件
 * 2. 自定义级（Custom）: process.env.PLUGINS_DIR || './plugins' - 用户自定义插件
 *
 * 路径解析优先级：
 * 1. 自定义目录（高优先级）
 * 2. 系统目录（降级）
 */
class PluginPathResolver {
  private systemPluginsDir: string;    // {baseDir}/plugins
  private customPluginsDir: string;    // process.env.PLUGINS_DIR || './plugins'

  constructor(baseDir: string, configBasePath: string) {
    // 系统级插件目录：编译后的内置插件
    this.systemPluginsDir = path.join(baseDir, 'plugins');

    // 自定义插件目录：支持环境变量配置
    const pluginsDirEnv = process.env.PLUGINS_DIR || './plugins';
    this.customPluginsDir = path.isAbsolute(pluginsDirEnv)
      ? pluginsDirEnv
      : path.resolve(configBasePath, pluginsDirEnv);

    logger.debug(
      {
        systemPluginsDir: this.systemPluginsDir,
        customPluginsDir: this.customPluginsDir
      },
      'PluginPathResolver initialized'
    );
  }

  /**
   * 获取插件的所有可能搜索路径（按优先级排序）
   * @param pluginName 插件名称
   * @param category 插件分类（如 'transformers'）- 已废弃，保留为兼容
   * @returns 按优先级排序的路径列表
   */
  getSearchPaths(pluginName: string, category?: string): string[] {
    const paths: string[] = [];
    const subPath = category ? path.join(category, pluginName) : pluginName;

    // 自定义目录（高优先级）
    // 1. 单文件插件：${pluginName}.ts/js
    paths.push(
      path.join(this.customPluginsDir, `${subPath}.ts`),
      path.join(this.customPluginsDir, `${subPath}.js`)
    );
    // 2. 目录插件：${pluginName}/index.ts/js
    paths.push(
      path.join(this.customPluginsDir, subPath, 'index.ts'),
      path.join(this.customPluginsDir, subPath, 'index.js')
    );

    // 系统目录（降级）
    // 1. 编译后的单文件插件：${pluginName}.js/ts
    paths.push(
      path.join(this.systemPluginsDir, `${subPath}.js`),
      path.join(this.systemPluginsDir, `${subPath}.ts`)
    );
    // 2. 编译后的目录插件：${pluginName}/index.js/ts
    paths.push(
      path.join(this.systemPluginsDir, subPath, 'index.js'),
      path.join(this.systemPluginsDir, subPath, 'index.ts')
    );

    return paths;
  }

  /**
   * 解析插件路径
   * @param pluginName 插件名称
   * @param category 插件分类（可选，如 'transformers'）
   * @returns 解析后的绝对路径
   * @throws 如果插件未找到
   */
  async resolve(pluginName: string, category?: string): Promise<string> {
    const paths = this.getSearchPaths(pluginName, category);

    for (const pluginPath of paths) {
      try {
        const exists = await Bun.file(pluginPath).exists();
        if (exists) {
          logger.debug({ pluginName, pluginPath }, 'Plugin resolved');
          return pluginPath;
        }
      } catch (error) {
        // 继续尝试下一个路径
        continue;
      }
    }

    // 所有路径都失败，抛出友好的错误信息
    const error = new Error(
      `Plugin "${pluginName}" not found. Searched in:\n${paths.map(p => `  - ${p}`).join('\n')}\n\n` +
      `Tip: Plugin files should be in one of the following formats:\n` +
      `  - Single file: ${pluginName}.ts/js\n` +
      `  - Directory: ${pluginName}/index.ts/js`
    );
    throw error;
  }

  /**
   * 获取所有需要扫描的目录
   * @returns 目录列表
   */
  getScanDirectories(): string[] {
    return [this.systemPluginsDir, this.customPluginsDir];
  }
}

/**
 * Plugin 注册表
 * 负责加载和管理 plugins 的元数据
 *
 * 注意：实际的插件执行由 ScopedPluginRegistry 处理
 * 此类主要用于：
 * - 插件发现和加载
 * - 插件元数据管理
 * - 插件启用/禁用状态管理（UI）
 */
export class PluginRegistry {
  private pluginFactories: Map<string, PluginFactoryInfo> = new Map();
  private pluginTranslations: Map<string, PluginTranslations> = new Map(); // 插件翻译内容
  private configBasePath: string;
  private pathResolver: PluginPathResolver;
  private registryDB?: PluginRegistryDB; // 插件状态数据库

  constructor(configBasePath: string = process.cwd(), db?: Database) {
    this.configBasePath = configBasePath;
    this.pathResolver = new PluginPathResolver(import.meta.dir, configBasePath);

    // 如果提供了数据库，初始化 PluginRegistryDB
    if (db) {
      this.registryDB = new PluginRegistryDB(db);
      logger.info('Plugin registry initialized with database support');
    } else {
      logger.warn(
        'Plugin registry initialized without database - plugin states will not be persisted'
      );
    }
  }

  /**
   * 递归遍历目录，返回所有文件路径
   * @param dir 要遍历的目录
   * @returns 文件路径数组
   */
  private async walkDirectory(dir: string): Promise<string[]> {
    const files: string[] = [];

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // 递归遍历子目录
          files.push(...await this.walkDirectory(fullPath));
        } else {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // 目录不存在或无权限，忽略
      logger.debug({ error, directory: dir }, 'Directory not accessible, skipping');
    }

    return files;
  }

  /**
   * 扫描指定目录并加载所有插件
   * 支持两种插件结构：
   * 1. 单文件插件：${pluginName}.ts/js（直接在根目录）
   * 2. 目录插件：${pluginName}/index.ts/js
   *
   * @param directory 要扫描的目录
   * @param enabledByDefault 默认是否启用插件
   * @returns 加载的插件名称列表
   */
  async scanAndLoadPlugins(directory: string, enabledByDefault: boolean): Promise<string[]> {
    logger.info({ directory, enabledByDefault }, 'Scanning directory for plugins');

    const files = await this.walkDirectory(directory);

    // 过滤插件文件：
    // 1. 单文件插件：根目录的 .ts/.js 文件（排除 index.ts/js）
    // 2. 目录插件：子目录的 index.ts/js
    const pluginFiles = files.filter(f => {
      const relativePath = path.relative(directory, f);
      const parts = relativePath.split(path.sep);

      // 单文件插件：直接在根目录，且是 .ts/.js 文件
      if (parts.length === 1 && (f.endsWith('.ts') || f.endsWith('.js'))) {
        const basename = path.basename(f, path.extname(f));
        // 排除特殊文件
        return basename !== 'index' && basename !== 'config';
      }

      // 目录插件：子目录的 index.ts 或 index.js
      if (parts.length === 2 && (path.basename(f) === 'index.ts' || path.basename(f) === 'index.js')) {
        return true;
      }

      return false;
    });

    logger.info(
      { directory, pluginCount: pluginFiles.length },
      'Found plugin files'
    );

    const loadedPlugins: string[] = [];

    for (const pluginFile of pluginFiles) {
      try {
        // 从文件路径提取插件名称
        const relativePath = path.relative(directory, pluginFile);
        const parts = relativePath.split(path.sep);

        let pluginName: string;
        if (parts.length === 1) {
          // 单文件插件：使用文件名（不含扩展名）
          pluginName = path.basename(pluginFile, path.extname(pluginFile));
        } else {
          // 目录插件：使用目录名
          pluginName = parts[0];
        }

        // 检查插件是否已经加载
        if (this.pluginFactories.has(pluginName)) {
          logger.debug({ pluginName }, 'Plugin already loaded, skipping');
          continue;
        }

        // 使用 path 加载插件（此时还未启用）
        await this.loadPlugin({
          name: pluginName,
          path: pluginFile,
          enabled: enabledByDefault
        });

        loadedPlugins.push(pluginName);

        logger.debug({ pluginName, pluginFile }, 'Plugin loaded from scan');
      } catch (error) {
        logger.warn(
          { error, pluginFile },
          'Failed to load plugin during scan, skipping'
        );
      }
    }

    logger.info(
      { directory, loadedCount: loadedPlugins.length },
      'Directory scan completed'
    );

    return loadedPlugins;
  }

  /**
   * 扫描所有插件目录并加载插件
   * 所有插件默认为禁用状态，需要通过配置文件显式启用
   */
  async scanAndLoadAllPlugins(): Promise<void> {
    const directories = this.pathResolver.getScanDirectories();

    logger.info({ directories }, 'Starting plugin directory scan');

    for (const directory of directories) {
      await this.scanAndLoadPlugins(directory, false); // 默认禁用
    }

    logger.info('All plugin directories scanned');
  }

  /**
   * 从配置加载 plugins
   * 支持两种格式：
   * 1. 字符串简写: "plugin-name" → { name: "plugin-name" }
   * 2. 完整配置对象: { name: "plugin-name", options: {...} }
   */
  async loadPlugins(configs: Array<PluginConfig | string>): Promise<void> {
    for (const config of configs) {
      try {
        if (typeof config === 'string') {
          // 字符串简写，转换为标准 PluginConfig
          await this.loadPlugin({ name: config });
        } else {
          // 标准 PluginConfig 对象
          await this.loadPlugin(config);
        }
      } catch (error) {
        logger.error(
          { error, pluginConfig: config },
          'Failed to load plugin, skipping'
        );
      }
    }
  }

  /**
   * 加载单个 plugin（存储工厂信息而不是实例）
   * @returns 插件名称
   */
  async loadPlugin(config: PluginConfig): Promise<string> {
    // 解析 plugin 路径
    let pluginPath: string;

    if (config.path) {
      // 如果提供了 path，直接使用（支持绝对路径和相对路径）
      pluginPath = path.isAbsolute(config.path)
        ? config.path
        : path.resolve(this.configBasePath, config.path);

      logger.debug({ pluginPath, source: 'path' }, 'Loading plugin from explicit path');
    } else if (config.name) {
      // 如果没有提供 path，通过 name 解析路径
      // 先尝试 transformers 目录，如果失败则尝试根目录
      try {
        pluginPath = await this.pathResolver.resolve(config.name, 'transformers');
        logger.debug({ pluginName: config.name, pluginPath, source: 'name-transformers' }, 'Plugin resolved from transformers category');
      } catch {
        // 如果在 transformers 中未找到，尝试根目录
        try {
          pluginPath = await this.pathResolver.resolve(config.name);
          logger.debug({ pluginName: config.name, pluginPath, source: 'name-root' }, 'Plugin resolved from root');
        } catch (error) {
          // 所有路径都失败
          throw new Error(
            `Failed to resolve plugin "${config.name}". ` +
            `Searched in transformers category and root directory. ` +
            `Please check plugin name or provide explicit path.`
          );
        }
      }
    } else {
      throw new Error('Plugin config must have either "name" or "path" property');
    }

    logger.info({ pluginPath }, 'Loading plugin');

    // 动态导入 plugin 模块
    const pluginModule = await import(pluginPath);

    // 支持 default export 或 named export
    const PluginClass = pluginModule.default || pluginModule.Plugin;

    if (!PluginClass) {
      throw new Error(`Plugin at ${pluginPath} must export a default class or named export 'Plugin'`);
    }

    // 验证是否为构造函数
    if (typeof PluginClass !== 'function') {
      throw new Error(`Plugin at ${pluginPath} must be a class constructor`);
    }

    // 类型断言为 PluginConstructor，从静态属性获取元数据（无需实例化）
    const PluginConstructor = PluginClass as any as import('./plugin.types').PluginConstructor;

    // 验证必需的静态属性
    if (!PluginConstructor.name) {
      throw new Error(`Plugin at ${pluginPath} must have a static 'name' property`);
    }
    if (!PluginConstructor.version) {
      throw new Error(`Plugin at ${pluginPath} must have a static 'version' property`);
    }

    // 从静态属性获取插件元数据（不需要实例化！）
    const pluginName = PluginConstructor.name;
    const pluginVersion = PluginConstructor.version;
    const pluginMetadata = PluginConstructor.metadata;
    const pluginDescription = pluginMetadata?.description || '';

    // ✅ 同步插件到数据库，获取启用状态（唯一真相来源）
    let enabled: boolean;
    if (this.registryDB) {
      // 使用数据库作为唯一真相来源
      enabled = await this.registryDB.syncPlugin(
        pluginName,
        PluginConstructor,
        pluginPath
      );
      logger.debug(
        { pluginName, enabled, source: 'database' },
        'Plugin status loaded from database'
      );
    } else {
      // 无数据库时的降级逻辑（向后兼容）
      const existingFactory = this.pluginFactories.get(pluginName);
      const existingEnabled = existingFactory?.enabled;

      enabled = config.enabled !== undefined
        ? config.enabled
        : existingEnabled !== undefined
          ? existingEnabled
          : true;

      logger.warn(
        { pluginName, enabled },
        'Plugin state not persisted (no database connection)'
      );
    }

    // 注册插件权限（基于静态 metadata）
    try {
      const permissionManager = getPermissionManager();
      permissionManager.registerPlugin(
        pluginName,
        pluginMetadata || {}
      );
    } catch (error) {
      logger.warn(
        { error, pluginName },
        'Failed to register plugin permissions (permission manager may not be initialized)'
      );
    }

    // 注册工厂信息
    const factoryInfo: PluginFactoryInfo = {
      PluginClass,
      config,
      enabled
    };

    this.pluginFactories.set(pluginName, factoryInfo);

    // 如果启用了插件，使用 PluginContextManager 创建全局 context
    // 解决原有架构中临时实例导致的storage丢失问题
    if (enabled && isPluginContextManagerInitialized()) {
      try {
        // 获取或创建插件的全局 context
        const contextManager = getPluginContextManager();

        // 检查是否已经存在context（避免重复初始化）
        const existingContext = contextManager.getContext(pluginName);
        const isFirstLoad = !existingContext;

        // 创建或获取插件的全局context
        const pluginContext = contextManager.getOrCreateContext(
          pluginName,
          pluginPath,
          config.options || {}
        );

        // 如果是首次加载，创建临时实例执行 onInit（如果插件有此方法）
        if (isFirstLoad) {
          try {
            const tempInstance = new PluginClass(config.options || {});
            if (tempInstance.onInit) {
              logger.info({ pluginName }, 'Initializing plugin with global context...');
              await tempInstance.onInit(pluginContext);
            }
          } catch (error) {
            logger.warn(
              { error, pluginName },
              'Failed to execute onInit (plugin may require specific options)'
            );
          }
        }
      } catch (error) {
        logger.error({ error, pluginName }, 'Plugin initialization (onInit) failed');
        // 初始化失败是否应该禁用插件？暂时仅记录错误
      }
    }

    // 收集插件的翻译内容（如果插件提供了 translations）
    if (PluginConstructor.translations) {
      this.pluginTranslations.set(pluginName, PluginConstructor.translations);
      logger.info(
        {
          plugin: pluginName,
          locales: Object.keys(PluginConstructor.translations)
        },
        'Plugin translations collected'
      );
    }

    logger.info(
      {
        pluginName,
        version: pluginVersion,
        description: pluginDescription,
        enabled
      },
      'Plugin loaded successfully'
    );

    return pluginName;
  }

  /**
   * 确保插件已加载到 registry 并返回插件名称
   */
  async ensurePluginLoaded(config: PluginConfig | string): Promise<string> {
    if (typeof config === 'string') {
      return await this.loadPlugin({ name: config });
    }
    return await this.loadPlugin(config);
  }

  /**
   * 启用 plugin
   */
  enablePlugin(name: string): boolean {
    // ✅ 更新数据库（唯一真相来源）
    if (this.registryDB) {
      const success = this.registryDB.enablePlugin(name);
      if (!success) {
        return false;
      }
    }

    // 更新内存中的状态
    const factoryInfo = this.pluginFactories.get(name);
    if (factoryInfo) {
      factoryInfo.enabled = true;
      logger.info({ pluginName: name }, 'Plugin enabled');
      return true;
    }

    logger.warn({ pluginName: name }, 'Plugin not found in registry');
    return false;
  }

  /**
   * 禁用 plugin
   */
  disablePlugin(name: string): boolean {
    // ✅ 更新数据库（唯一真相来源）
    if (this.registryDB) {
      const success = this.registryDB.disablePlugin(name);
      if (!success) {
        return false;
      }
    }

    // 更新内存中的状态
    const factoryInfo = this.pluginFactories.get(name);
    if (factoryInfo) {
      factoryInfo.enabled = false;
      logger.info({ pluginName: name }, 'Plugin disabled');
      return true;
    }

    logger.warn({ pluginName: name }, 'Plugin not found in registry');
    return false;
  }

  /**
   * 获取所有已扫描插件的元数据
   * 包括已启用和未启用的插件
   */
  getAllPluginsMetadata(): Array<{
    name: string;
    version: string;
    description: string;
    metadata: any;
    enabled: boolean;
  }> {
    const plugins: Array<{
      name: string;
      version: string;
      description: string;
      metadata: any;
      enabled: boolean;
    }> = [];

    for (const [name, factoryInfo] of this.pluginFactories.entries()) {
      try {
        // 从静态属性读取元数据（不实例化）
        const PluginConstructor = factoryInfo.PluginClass as any as import('./plugin.types').PluginConstructor;

        plugins.push({
          name: PluginConstructor.name,
          version: PluginConstructor.version,
          description: PluginConstructor.metadata?.description || '',
          metadata: PluginConstructor.metadata || {},
          enabled: factoryInfo.enabled
        });
      } catch (error) {
        logger.error(
          { error, pluginName: name },
          'Failed to get plugin metadata'
        );
      }
    }

    return plugins;
  }

  /**
   * 获取所有插件的配置 Schema
   * 用于 UI 动态生成插件配置表单
   *
   * @returns 插件 Schema Map，key 为插件名，value 为插件的 schema 信息
   */
  getAllPluginSchemas(): Record<string, {
    name: string;
    version: string;
    description: string;
    metadata: any;
    configSchema: any[];
  }> {
    const schemas: Record<string, any> = {};

    for (const [name, factoryInfo] of this.pluginFactories.entries()) {
      try {
        // 从静态属性读取元数据（不实例化）
        const PluginConstructor = factoryInfo.PluginClass as any as import('./plugin.types').PluginConstructor;

        schemas[PluginConstructor.name] = {
          name: PluginConstructor.name,
          version: PluginConstructor.version,
          description: PluginConstructor.metadata?.description || '',
          metadata: PluginConstructor.metadata || {},
          configSchema: PluginConstructor.configSchema || []
        };
      } catch (error) {
        logger.error(
          { error, pluginName: name },
          'Failed to get plugin schema'
        );
      }
    }

    return schemas;
  }

  /**
   * 卸载所有 plugins（清理 context 和权限）
   */
  async unloadAll(): Promise<void> {
    // 安全地获取 contextManager（如果未初始化则为 null）
    const contextManager = isPluginContextManagerInitialized() ? getPluginContextManager() : null;

    for (const [name, factoryInfo] of this.pluginFactories.entries()) {
      // 创建临时实例并调用 onDestroy（用于清理全局资源）
      try {
        const tempInstance = new factoryInfo.PluginClass(factoryInfo.config.options || {});
        if (tempInstance.onDestroy) {
          await tempInstance.onDestroy();
          logger.debug({ pluginName: name }, 'Plugin cleanup completed');
        }
      } catch (error) {
        logger.error({ error, pluginName: name }, 'Error during plugin cleanup');
      }

      // 清理插件的全局 context（如果 contextManager 已初始化）
      if (contextManager) {
        try {
          await contextManager.destroyContext(name);
        } catch (error) {
          logger.error({ error, pluginName: name }, 'Error destroying plugin context');
        }
      }

      // 注销插件权限
      try {
        const permissionManager = getPermissionManager();
        permissionManager.unregisterPlugin(name);
      } catch (error) {
        logger.warn({ error, pluginName: name }, 'Failed to unregister plugin permissions');
      }
    }

    this.pluginFactories.clear();
    logger.info('All plugins unloaded');
  }

  /**
   * 获取所有插件的翻译内容，格式化为前端 i18n 可用的结构
   *
   * 翻译键会自动添加 `plugins.{pluginName}` 前缀
   *
   * @returns 按语言组织的翻译数据
   * @example
   * ```json
   * {
   *   "en": {
   *     "plugins": {
   *       "ai-transformer": {
   *         "transformation.label": "Transformation Direction",
   *         "options.anthropic_openai.label": "Anthropic → OpenAI"
   *       }
   *     }
   *   },
   *   "zh-CN": {
   *     "plugins": {
   *       "ai-transformer": {
   *         "transformation.label": "转换方向",
   *         "options.anthropic_openai.label": "Anthropic → OpenAI"
   *       }
   *     }
   *   }
   * }
   * ```
   */
  getAllPluginTranslations(): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [pluginName, translations] of this.pluginTranslations) {
      for (const [locale, messages] of Object.entries(translations)) {
        // 初始化语言结构
        if (!result[locale]) {
          result[locale] = { plugins: {} };
        }
        if (!result[locale].plugins) {
          result[locale].plugins = {};
        }

        // 添加插件的翻译（以插件名为命名空间）
        result[locale].plugins[pluginName] = messages;
      }
    }

    return result;
  }
}
