import type { Plugin, PluginContext, PluginTranslations } from './plugin.types';
import type { PluginConfig } from '@jeffusion/bungee-types';
import { getPluginName } from './plugin.types';
import { logger } from './logger';
import * as path from 'path';
import * as fs from 'fs';
import { PluginPool } from './plugin-pool';
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
  pooled: boolean; // 是否使用对象池
  pool?: PluginPool<Plugin>; // 对象池实例
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
 * 负责加载、管理和执行 plugins
 *
 * 生命周期策略：
 * - 默认：每个请求创建新的 plugin 实例（完全隔离）
 * - 可选：使用 @Pooled 装饰器的 plugin 采用对象池复用
 *
 * 状态管理：
 * - 插件代码：文件系统（不可变）
 * - 启用状态：SQLite 数据库（可变，唯一真相来源）
 * - 配置：config.json（业务配置，不含插件状态）
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

    // 检测是否使用 @Pooled 装饰器
    const pooled = !!(PluginClass as any).__pooled__;
    const poolOptions = (PluginClass as any).__poolOptions__ || {};

    // 如果启用池化，创建对象池
    let pool: PluginPool<Plugin> | undefined;
    if (pooled) {
      pool = new PluginPool<Plugin>(
        () => {
          const instance = new PluginClass(config.options || {});
          // 注入全局context到池化实例中（如果已初始化）
          if (isPluginContextManagerInitialized()) {
            const contextManager = getPluginContextManager();
            const pluginContext = contextManager.getContext(pluginName);
            if (pluginContext) {
              (instance as any).__pluginContext__ = pluginContext;
            }
          }
          return instance;
        },
        {
          minSize: poolOptions.minSize || 2,
          maxSize: poolOptions.maxSize || 20
        }
      );
      logger.info(
        {
          pluginName,
          minSize: poolOptions.minSize || 2,
          maxSize: poolOptions.maxSize || 20
        },
        'Plugin pool created'
      );
    }

    // 注册工厂信息
    const factoryInfo: PluginFactoryInfo = {
      PluginClass,
      config,
      enabled,
      pooled,
      pool
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
        enabled,
        pooled,
        lifecycle: pooled ? 'pooled' : 'per-request'
      },
      'Plugin loaded successfully'
    );

    return pluginName;
  }

  /**
   * 确保插件已加载到 registry 并返回插件名称
   *
   * 支持两种参数类型：
   * - PluginConfig 对象：加载自定义插件
   * - string：字符串简写，转换为 { name: string }
   *
   * @param config - 插件配置对象或插件名称
   * @returns 插件名称
   */
  async ensurePluginLoaded(config: PluginConfig | string): Promise<string> {
    if (typeof config === 'string') {
      // 字符串简写，转换为标准 PluginConfig
      return await this.loadPlugin({ name: config });
    }

    // 标准 PluginConfig 对象
    return await this.loadPlugin(config);
  }

  /**
   * 为当前请求创建或获取 plugin 实例（支持池化）
   *
   * 这是主要的实例获取方法：
   * - 非池化 plugin：每次创建新实例
   * - 池化 plugin：从对象池获取实例
   *
   * ✅ 安全验证：
   * - 插件不存在 → 跳过并警告
   * - 插件未启用 → 跳过并警告
   *
   * @param pluginNames 要获取的 plugin 名称列表（如果为空则获取所有启用的）
   * @returns Plugin 实例数组和清理函数
   */
  async acquirePluginInstances(pluginNames?: string[]): Promise<{
    plugins: Plugin[];
    release: () => Promise<void>;
  }> {
    const targetNames = pluginNames || Array.from(this.pluginFactories.keys());
    const instances: Plugin[] = [];
    const pooledInstances: Array<{ plugin: Plugin; poolName: string }> = [];

    for (const name of targetNames) {
      const factoryInfo = this.pluginFactories.get(name);

      // ❌ 检查1：插件不存在
      if (!factoryInfo) {
        logger.warn(
          { pluginName: name },
          '⚠️  Plugin not found in registry, skipping (plugin may not be installed)'
        );
        continue;
      }

      // ❌ 检查2：插件未启用（全局禁用）
      if (!factoryInfo.enabled) {
        logger.warn(
          { pluginName: name },
          '⚠️  Plugin is disabled in global settings, skipping (enable it in Plugin Management)'
        );
        continue;
      }

      if (factoryInfo.pooled && factoryInfo.pool) {
        // 从池中获取实例
        try {
          const instance = await factoryInfo.pool.acquire();
          instances.push(instance);
          pooledInstances.push({ plugin: instance, poolName: name });
        } catch (error) {
          logger.error(
            { error, pluginName: name },
            'Failed to acquire plugin from pool'
          );
        }
      } else {
        // 创建新实例
        try {
          const instance = new factoryInfo.PluginClass(factoryInfo.config.options || {});
          // 注入全局context到非池化实例中（如果已初始化）
          if (isPluginContextManagerInitialized()) {
            const contextManager = getPluginContextManager();
            const pluginContext = contextManager.getContext(name);
            if (pluginContext) {
              (instance as any).__pluginContext__ = pluginContext;
            }
          }
          instances.push(instance);
        } catch (error) {
          logger.error(
            { error, pluginName: name },
            'Failed to create plugin instance'
          );
        }
      }
    }

    // 返回实例和清理函数
    const release = async (): Promise<void> => {
      // 归还池化实例
      for (const { plugin, poolName } of pooledInstances) {
        const factoryInfo = this.pluginFactories.get(poolName);
        if (factoryInfo?.pool) {
          try {
            await factoryInfo.pool.release(plugin);
          } catch (error) {
            logger.error(
              { error, pluginName: poolName },
              'Failed to release plugin to pool'
            );
          }
        }
      }

      // 销毁非池化实例
      for (const instance of instances) {
        if (!pooledInstances.some(p => p.plugin === instance)) {
          try {
            if (instance.onDestroy) {
              await instance.onDestroy();
            }
          } catch (error) {
            logger.error(
              { error, pluginName: getPluginName(instance) },
              'Error during plugin cleanup'
            );
          }
        }
      }
    };

    return { plugins: instances, release };
  }

  /**
   * 为当前请求创建新的 plugin 实例（不使用池化）
   *
   * 仅用于需要强制创建新实例的场景。
   * 大多数情况下应使用 acquirePluginInstances() 方法。
   *
   * @param pluginNames 要创建的 plugin 名称列表（如果为空则创建所有启用的）
   * @returns Plugin 实例数组
   */
  createPluginInstances(pluginNames?: string[]): Plugin[] {
    const targetNames = pluginNames || Array.from(this.pluginFactories.keys());
    const instances: Plugin[] = [];

    for (const name of targetNames) {
      const factoryInfo = this.pluginFactories.get(name);

      if (!factoryInfo || !factoryInfo.enabled) {
        continue;
      }

      try {
        const instance = new factoryInfo.PluginClass(factoryInfo.config.options || {});
        // 注入全局context到实例中（如果已初始化）
        if (isPluginContextManagerInitialized()) {
          const contextManager = getPluginContextManager();
          const pluginContext = contextManager.getContext(name);
          if (pluginContext) {
            (instance as any).__pluginContext__ = pluginContext;
          }
        }
        instances.push(instance);
      } catch (error) {
        logger.error(
          { error, pluginName: name },
          'Failed to create plugin instance'
        );
      }
    }

    return instances;
  }

  /**
   * 获取所有启用的 plugins
   * @deprecated 此方法返回临时实例仅用于兼容性，新代码应使用 acquirePluginInstances()
   */
  getEnabledPlugins(): Plugin[] {
    logger.warn('getEnabledPlugins() is deprecated, use acquirePluginInstances() instead');
    return this.createPluginInstances();
  }

  /**
   * 根据名称获取 plugin（创建临时实例）
   * @deprecated 此方法创建临时实例仅用于兼容性，新代码应使用 acquirePluginInstances()
   */
  getPlugin(name: string): Plugin | undefined {
    logger.warn('getPlugin() is deprecated, use acquirePluginInstances() instead');
    const factoryInfo = this.pluginFactories.get(name);
    if (!factoryInfo || !factoryInfo.enabled) {
      return undefined;
    }
    try {
      const instance = new factoryInfo.PluginClass(factoryInfo.config.options || {});
      // 注入全局context到实例中（如果已初始化）
      if (isPluginContextManagerInitialized()) {
        const contextManager = getPluginContextManager();
        const pluginContext = contextManager.getContext(name);
        if (pluginContext) {
          (instance as any).__pluginContext__ = pluginContext;
        }
      }
      return instance;
    } catch (error) {
      logger.error({ error, pluginName: name }, 'Failed to create plugin instance');
      return undefined;
    }
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
   * 卸载所有 plugins（销毁对象池和context）
   */
  async unloadAll(): Promise<void> {
    // 安全地获取 contextManager（如果未初始化则为 null）
    const contextManager = isPluginContextManagerInitialized() ? getPluginContextManager() : null;

    // 销毁所有对象池和非池化插件
    for (const [name, factoryInfo] of this.pluginFactories.entries()) {
      if (factoryInfo.pool) {
        // 池化插件：销毁整个池
        try {
          await factoryInfo.pool.destroy();
          logger.info({ pluginName: name }, 'Plugin pool destroyed');
        } catch (error) {
          logger.error({ error, pluginName: name }, 'Error destroying plugin pool');
        }
      } else {
        // 非池化插件：创建临时实例并调用 onDestroy（用于清理全局资源）
        try {
          const tempInstance = new factoryInfo.PluginClass(factoryInfo.config.options || {});
          if (tempInstance.onDestroy) {
            await tempInstance.onDestroy();
            logger.debug({ pluginName: name }, 'Non-pooled plugin cleanup completed');
          }
        } catch (error) {
          logger.error({ error, pluginName: name }, 'Error during non-pooled plugin cleanup');
        }
      }

      // 清理插件的全局context（如果 contextManager 已初始化）
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
   * 执行 onRequestInit 钩子
   */
  async executeOnRequestInit(
    context: PluginContext
  ): Promise<void> {
    const plugins = this.getEnabledPlugins();

    for (const plugin of plugins) {
      if (plugin.onRequestInit) {
        try {
          await plugin.onRequestInit(context);
        } catch (error) {
          logger.error(
            { error, pluginName: getPluginName(plugin) },
            'Error in onRequestInit hook'
          );
        }
      }
    }
  }

  /**
   * 执行 onBeforeRequest 钩子
   */
  async executeOnBeforeRequest(
    context: PluginContext
  ): Promise<void> {
    const plugins = this.getEnabledPlugins();

    for (const plugin of plugins) {
      if (plugin.onBeforeRequest) {
        try {
          await plugin.onBeforeRequest(context);
        } catch (error) {
          logger.error(
            { error, pluginName: getPluginName(plugin) },
            'Error in onBeforeRequest hook'
          );
        }
      }
    }
  }

  /**
   * 执行 onInterceptRequest 钩子
   * 如果任何 plugin 返回响应，立即返回该响应
   */
  async executeOnInterceptRequest(
    context: PluginContext
  ): Promise<Response | null> {
    const plugins = this.getEnabledPlugins();

    for (const plugin of plugins) {
      if (plugin.onInterceptRequest) {
        try {
          const response = await plugin.onInterceptRequest(context);
          if (response) {
            logger.info({ pluginName: getPluginName(plugin) }, 'Request intercepted by plugin');
            return response;
          }
        } catch (error) {
          logger.error(
            { error, pluginName: getPluginName(plugin) },
            'Error in onInterceptRequest hook'
          );
        }
      }
    }

    return null;
  }

  /**
   * 执行 onResponse 钩子
   * 如果 plugin 返回新的 Response，则使用该 Response 替换原响应
   */
  async executeOnResponse(
    context: PluginContext & { response: Response }
  ): Promise<Response> {
    const plugins = this.getEnabledPlugins();
    let currentResponse = context.response;

    for (const plugin of plugins) {
      if (plugin.onResponse) {
        try {
          const result = await plugin.onResponse({
            ...context,
            response: currentResponse
          });

          // 如果 plugin 返回了新的 Response，使用它
          if (result && result instanceof Response) {
            currentResponse = result;
            logger.info(
              { pluginName: getPluginName(plugin) },
              'Plugin returned modified response'
            );
          }
        } catch (error) {
          logger.error(
            { error, pluginName: getPluginName(plugin) },
            'Error in onResponse hook'
          );
        }
      }
    }

    return currentResponse;
  }

  /**
   * 执行 onError 钩子
   */
  async executeOnError(
    context: PluginContext & { error: Error }
  ): Promise<void> {
    const plugins = this.getEnabledPlugins();

    for (const plugin of plugins) {
      if (plugin.onError) {
        try {
          await plugin.onError(context);
        } catch (error) {
          logger.error(
            { error, pluginName: getPluginName(plugin) },
            'Error in onError hook'
          );
        }
      }
    }
  }

  /**
   * 自动加载 transformer plugin
   * 根据 transformer 名称从预定义路径加载对应的 plugin
   *
   * 注意：此方法主要用于向后兼容，新代码应该直接使用 loadPlugin()
   *
   * @returns 插件名称
   */
  async loadTransformerPlugin(transformerName: string): Promise<string> {
    // 检查是否已经加载（检查 factory registry）
    const existingFactory = this.pluginFactories.get(transformerName);
    if (existingFactory) {
      // Already loaded, return the plugin name
      return transformerName;
    }

    const baseDir = import.meta.dir;

    // 尝试多个可能的路径，支持单文件和目录插件结构
    const possiblePaths = [
      // 用户自定义插件目录（支持动态添加，无需重新编译）
      // 1. 单文件插件
      path.join('/usr/app/data/plugins', `${transformerName}.ts`),
      // 2. 目录插件
      path.join('/usr/app/data/plugins', transformerName, 'index.ts'),

      // 生产环境路径 - 编译后的 .js 文件
      // 1. 单文件插件
      path.join(baseDir, 'plugins', `${transformerName}.js`),
      // 2. 目录插件
      path.join(baseDir, 'plugins', transformerName, 'index.js'),

      // 开发环境路径 - 源代码 .ts 文件
      // 1. 单文件插件
      path.join(baseDir, 'plugins', `${transformerName}.ts`),
      // 2. 目录插件
      path.join(baseDir, 'plugins', transformerName, 'index.ts'),

      // 测试环境路径
      // 1. 单文件插件
      path.join(this.configBasePath, 'packages/core/src/plugins', `${transformerName}.ts`),
      // 2. 目录插件
      path.join(this.configBasePath, 'packages/core/src/plugins', transformerName, 'index.ts'),

      // 相对路径（向上一级）
      // 1. 单文件插件
      path.resolve(baseDir, '../plugins', `${transformerName}.ts`),
      // 2. 目录插件
      path.resolve(baseDir, '../plugins', transformerName, 'index.ts')
    ];

    for (const pluginPath of possiblePaths) {
      try {
        logger.debug({ transformerName, pluginPath }, 'Trying to load transformer plugin');

        await this.loadPlugin({
          name: transformerName,
          path: pluginPath,
          enabled: true
        });

        // Check if loaded successfully
        const factoryInfo = this.pluginFactories.get(transformerName);
        if (factoryInfo) {
          logger.info({ transformerName, pluginPath }, 'Transformer plugin auto-loaded successfully');
          return transformerName;
        }
      } catch (error) {
        // Try next path
        logger.debug({ error, transformerName, pluginPath }, 'Failed to load from this path, trying next');
        continue;
      }
    }

    // All paths failed
    const error = new Error(`Failed to auto-load transformer plugin '${transformerName}' from all paths`);
    logger.error(
      { transformerName, attemptedPaths: possiblePaths, error },
      'Failed to auto-load transformer plugin from all paths'
    );
    throw error;
  }

  /**
   * 执行特定plugin的onRequestInit钩子
   */
  async executePluginOnRequestInit(
    pluginName: string,
    context: PluginContext
  ): Promise<void> {
    const plugin = this.getPlugin(pluginName);
    if (!plugin || !plugin.onRequestInit) {
      return;
    }

    try {
      await plugin.onRequestInit(context);
    } catch (error) {
      logger.error(
        { error, pluginName: getPluginName(plugin) },
        'Error in onRequestInit hook'
      );
    }
  }

  /**
   * 执行特定plugin的onInterceptRequest钩子
   */
  async executePluginOnInterceptRequest(
    pluginName: string,
    context: PluginContext
  ): Promise<Response | null> {
    const plugin = this.getPlugin(pluginName);
    if (!plugin || !plugin.onInterceptRequest) {
      return null;
    }

    try {
      const response = await plugin.onInterceptRequest(context);
      if (response) {
        logger.info({ pluginName: getPluginName(plugin) }, 'Request intercepted by plugin');
        return response;
      }
    } catch (error) {
      logger.error(
        { error, pluginName: getPluginName(plugin) },
        'Error in onInterceptRequest hook'
      );
    }

    return null;
  }

  /**
   * 执行特定plugin的onBeforeRequest钩子
   */
  async executePluginOnBeforeRequest(
    pluginName: string,
    context: PluginContext
  ): Promise<void> {
    const plugin = this.getPlugin(pluginName);
    if (!plugin || !plugin.onBeforeRequest) {
      return;
    }

    try {
      await plugin.onBeforeRequest(context);
    } catch (error) {
      logger.error(
        { error, pluginName: getPluginName(plugin) },
        'Error in onBeforeRequest hook'
      );
    }
  }

  /**
   * 执行特定plugin的onResponse钩子
   * 如果plugin返回新的Response，则使用该Response替换原响应
   */
  async executePluginOnResponse(
    pluginName: string,
    context: PluginContext & { response: Response }
  ): Promise<Response> {
    const plugin = this.getPlugin(pluginName);
    if (!plugin || !plugin.onResponse) {
      return context.response;
    }

    try {
      const result = await plugin.onResponse(context);
      if (result && result instanceof Response) {
        logger.info({ pluginName: getPluginName(plugin) }, 'Plugin returned modified response');
        return result;
      }
    } catch (error) {
      logger.error(
        { error, pluginName: getPluginName(plugin) },
        'Error in onResponse hook'
      );
    }

    return context.response;
  }

  /**
   * 执行特定plugin的onError钩子
   */
  async executePluginOnError(
    pluginName: string,
    context: PluginContext & { error: Error }
  ): Promise<void> {
    const plugin = this.getPlugin(pluginName);
    if (!plugin || !plugin.onError) {
      return;
    }

    try {
      await plugin.onError(context);
    } catch (error) {
      logger.error(
        { error, pluginName: getPluginName(plugin) },
        'Error in onError hook'
      );
    }
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
