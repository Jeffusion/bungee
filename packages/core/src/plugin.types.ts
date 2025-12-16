/**
 * Plugin 系统类型定义
 */

// 导出 Hook 系统类型
export type {
  PluginHooks,
  RequestContext,
  MutableRequestContext,
  ResponseContext,
  ErrorContext,
  StreamChunkContext,
  FinallyContext,
  PluginInitContext,
  PluginLogger,
} from './hooks';

export { createPluginHooks, clearHooks, getHooksStats, resetHooksStats } from './hooks';
export type { TapInfo } from './hooks';

/**
 * 插件配置字段类型
 */
export type PluginConfigFieldType =
  | 'string'      // 文本输入
  | 'number'      // 数字输入
  | 'boolean'     // 复选框
  | 'select'      // 单选下拉
  | 'multiselect' // 多选下拉
  | 'textarea'    // 多行文本
  | 'json'        // JSON 编辑器
  | 'object'      // 对象（嵌套表单）
  | 'array';      // 数组（列表编辑器）

/**
 * 验证规则
 */
export interface ValidationRule {
  /**
   * 正则表达式模式
   */
  pattern?: string;

  /**
   * 最小值/最小长度
   */
  min?: number;

  /**
   * 最大值/最大长度
   */
  max?: number;

  /**
   * 自定义错误消息
   */
  message?: string;
}

/**
 * 字段转换规则（可序列化）
 * 用于定义虚拟字段与实际字段之间的转换关系
 */
export interface FieldTransform {
  /**
   * 转换类型
   */
  type: 'split' | 'concat' | 'compute';

  /**
   * split 类型专用：分隔符
   * @example '-' 将 "a-b" 拆分为 ["a", "b"]
   */
  separator?: string;

  /**
   * split/concat 类型专用：目标字段列表
   * @example ['from', 'to']
   */
  fields?: string[];
}

/**
 * 插件翻译内容
 *
 * 用于为插件的 UI 元素提供多语言支持
 *
 * 格式说明：
 * - 第一层 key 为语言代码（如 'en', 'zh-CN'）
 * - 第二层 key 为翻译键（使用点号分隔的扁平结构）
 * - 系统会自动为所有翻译键添加 `plugins.{pluginName}` 前缀
 *
 * @example
 * ```typescript
 * static readonly translations: PluginTranslations = {
 *   'en': {
 *     'field.label': 'Field Label',
 *     'field.description': 'Field description text',
 *     'options.value1.label': 'Option 1'
 *   },
 *   'zh-CN': {
 *     'field.label': '字段标签',
 *     'field.description': '字段描述文本',
 *     'options.value1.label': '选项 1'
 *   }
 * };
 * ```
 */
export type PluginTranslations = Record<string, Record<string, string>>;

/**
 * 插件配置字段定义
 * 用于动态生成配置表单
 */
export interface PluginConfigField {
  /**
   * 字段名（配置对象的 key）
   */
  name: string;

  /**
   * 字段类型
   */
  type: PluginConfigFieldType;

  /**
   * 显示标签（支持 i18n key 或直接字符串）
   */
  label: string;

  /**
   * 是否必填
   */
  required?: boolean;

  /**
   * 默认值
   */
  default?: any;

  /**
   * select/multiselect 的选项列表
   */
  options?: Array<{
    label: string;
    value: string;
    description?: string;
  }>;

  /**
   * 描述/帮助文本
   */
  description?: string;

  /**
   * 占位符文本
   */
  placeholder?: string;

  /**
   * 验证规则
   */
  validation?: ValidationRule;

  /**
   * 条件显示（依赖其他字段的值）
   */
  showIf?: {
    field: string;
    value: any;
  };

  /**
   * 子字段定义（type=object 时使用）
   */
  properties?: PluginConfigField[];

  /**
   * 数组元素类型（type=array 时使用）
   */
  items?: PluginConfigField;

  /**
   * 字段转换规则（可序列化）
   * 定义虚拟字段与实际字段之间的映射关系
   *
   * 当设置此属性时：
   * - 该字段为"虚拟字段"，仅用于 UI 交互
   * - UI 输入值会根据转换规则展开为多个实际字段
   * - 实际字段的值会根据转换规则合并显示在 UI 中
   * - 虚拟字段本身不会保存到配置中
   *
   * @example
   * // 将 "anthropic-openai" 拆分为 { from: "anthropic", to: "openai" }
   * fieldTransform: {
   *   type: 'split',
   *   separator: '-',
   *   fields: ['from', 'to']
   * }
   */
  fieldTransform?: FieldTransform;
}

/**
 * 类型守卫：检查插件类是否有 configSchema
 */
export function hasConfigSchema(
  PluginClass: any
): PluginClass is { configSchema: PluginConfigField[] } {
  return 'configSchema' in PluginClass && Array.isArray(PluginClass.configSchema);
}

/**
 * Plugin 存储接口
 * 提供基于 Key-Value 的持久化存储能力
 */
export interface PluginStorage {
  /**
   * 获取值
   * @param key 键
   * @returns 值，如果不存在则返回 null
   */
  get<T = any>(key: string): Promise<T | null>;

  /**
   * 设置值
   * @param key 键
   * @param value 值（必须可序列化）
   * @param ttlSeconds 过期时间（秒），可选
   */
  set(key: string, value: any, ttlSeconds?: number): Promise<void>;

  /**
   * 删除值
   * @param key 键
   */
  delete(key: string): Promise<void>;

  /**
   * 获取所有键（支持前缀过滤）
   * @param prefix 前缀，可选
   */
  keys(prefix?: string): Promise<string[]>;

  /**
   * 清空存储（仅限当前插件的命名空间）
   */
  clear(): Promise<void>;

  /**
   * 原子递增操作
   * 原子地递增指定对象字段的值，避免并发竞争
   * @param key 键
   * @param field 字段名
   * @param delta 递增量（默认1，可为负数）
   * @returns 递增后的新值
   */
  increment(key: string, field: string, delta?: number): Promise<number>;

  /**
   * 比较并交换操作
   * 仅当当前值等于期望值时，才更新为新值（原子操作）
   * @param key 键
   * @param field 字段名
   * @param expected 期望的当前值
   * @param newValue 新值
   * @returns 是否更新成功
   */
  compareAndSet(key: string, field: string, expected: any, newValue: any): Promise<boolean>;
}

/**
 * Plugin 元数据接口
 * 用于 UI 展示和系统集成
 */
export interface PluginMetadata {
  /**
   * 显示名称（支持翻译键或直接字符串）
   * 默认使用插件的 name，此字段用于提供更友好的 UI 显示名
   *
   * 支持翻译键格式：包含 `.` 且不包含空格
   * @example 'metadata.displayName' // 翻译键，会自动翻译
   * @example 'My Plugin' // 直接字符串，不翻译
   */
  name?: string;

  /**
   * 插件描述（支持翻译键或直接字符串）
   * 用于 UI 展示插件的详细说明
   *
   * 支持翻译键格式：包含 `.` 且不包含空格
   * @example 'metadata.description' // 翻译键，会自动翻译
   * @example 'A demo plugin for testing' // 直接字符串，不翻译
   */
  description?: string;

  /**
   * 图标（Material Icon 名称或 URL）
   */
  icon?: string;

  /**
   * 作者信息
   */
  author?: {
    name: string;
    email?: string;
    url?: string;
  } | string;

  /**
   * 许可证
   */
  license?: string;

  /**
   * 项目主页
   */
  homepage?: string;

  /**
   * 代码仓库
   */
  repository?: {
    type: string;
    url: string;
  } | string;

  /**
   * 关键词（用于搜索）
   */
  keywords?: string[];

  /**
   * 分类
   */
  categories?: string[];

  /**
   * 插件激活事件
   * 声明插件何时被激活
   */
  activationEvents?: string[];

  /**
   * 插件能力声明
   * 声明插件使用的系统能力
   */
  capabilities?: {
    /**
     * 是否需要网络访问
     */
    network?: boolean;

    /**
     * 是否需要文件系统访问
     */
    filesystem?: boolean;

    /**
     * 是否需要数据库访问
     */
    database?: boolean;

    /**
     * 自定义能力声明
     */
    custom?: string[];
  };

  /**
   * 依赖的其他插件
   */
  dependencies?: Record<string, string>;

  /**
   * 可选依赖
   */
  optionalDependencies?: Record<string, string>;

  /**
   * 引擎版本要求
   */
  engines?: {
    bungee?: string;
    node?: string;
  };

  /**
   * 贡献点配置
   * 统一声明插件提供的 UI 和功能能力
   */
  contributes?: {
    /**
     * 导航集成
     */
    navigation?: Array<{
      label: string;
      path: string;
      icon?: string;
      target?: 'sidebar' | 'header'; // 默认 sidebar
    }>;

    /**
     * 仪表板集成
     */
    widgets?: Array<{
      title: string;
      path: string;
      size?: 'small' | 'medium' | 'large' | 'full'; // small=1x1, medium=2x1, large=2x2, full=4x2
    }>;

    /**
     * 设置页路径
     */
    settings?: string;

    /**
     * 命令贡献
     * 声明插件提供的命令
     */
    commands?: Array<{
      command: string;
      title: string;
      category?: string;
      icon?: string;
    }>;

    /**
     * 配置贡献
     * 声明插件的配置项
     */
    configuration?: {
      title?: string;
      properties: Record<string, {
        type: 'string' | 'number' | 'boolean' | 'array' | 'object';
        default?: any;
        description?: string;
        enum?: any[];
        items?: any;
        properties?: any;
      }>;
    };
  };

  /**
   * @deprecated 使用 contributes.navigation 代替
   */
  menus?: Array<{
    id: string;
    title: string;
    path: string;
    icon?: string;
    location?: 'sidebar' | 'header';
  }>;

  /**
   * @deprecated 使用 contributes.widgets 和 contributes.settings 代替
   */
  ui?: {
    dashboard?: Array<{
      id: string;
      title: string;
      path: string;
      size?: { w: number; h: number };
    }>;
    settings?: string;
  };
}


// ============ Plugin 接口 ============

import type { PluginHooks, PluginInitContext } from './hooks';

/**
 * Plugin 接口（基于 Hook Registry 模式）
 *
 * 所有插件必须实现此接口。插件不再直接定义钩子方法，而是通过 register(hooks) 方法注册回调。
 *
 * @example
 * ```typescript
 * export const MyPlugin = definePlugin(
 *   class implements Plugin {
 *     static readonly name = 'my-plugin';
 *     static readonly version = '1.0.0';
 *
 *     register(hooks: PluginHooks) {
 *       // 并行执行的初始化（非阻塞）
 *       hooks.onRequestInit.tapPromise({ name: 'my-plugin' }, async (ctx) => {
 *         await this.recordMetric();
 *       });
 *
 *       // 串行执行的请求修改（阻塞）
 *       hooks.onBeforeRequest.tapPromise({ name: 'my-plugin' }, async (ctx) => {
 *         ctx.headers['X-Custom'] = 'value';
 *         return ctx;
 *       });
 *     }
 *   }
 * );
 * ```
 */
export interface Plugin {
  /**
   * 插件初始化
   * 在 register 之前调用，用于初始化配置和资源
   */
  init?(context: PluginInitContext): Promise<void>;

  /**
   * 注册 Hooks
   * 插件在此方法中选择需要的 hooks 并注册回调
   *
   * 流式处理现在也通过 Hook 注册：
   * - hooks.onStreamChunk: 处理流式响应的每个 chunk（支持 N:M 转换）
   * - hooks.onFlushStream: 流结束时刷新缓冲区
   */
  register(hooks: PluginHooks): void;

  /**
   * 重置状态（对象池使用）
   */
  reset?(): void | Promise<void>;

  /**
   * 插件销毁
   */
  onDestroy?(): Promise<void>;
}

/**
 * Plugin 构造器类型
 * 约束插件类必须提供静态元数据
 */
export type PluginConstructor = {
  new (...args: any[]): Plugin;

  /**
   * 插件唯一标识符（静态属性，必填）
   */
  readonly name: string;

  /**
   * 插件版本号（静态属性，必填）
   */
  readonly version: string;

  /**
   * 插件配置 Schema（静态属性，可选）
   * 如果插件需要配置，应定义此静态属性来描述配置项
   */
  readonly configSchema?: PluginConfigField[];

  /**
   * 插件扩展元数据（静态属性，可选）
   * 用于 UI 集成、权限声明、依赖管理等高级功能
   */
  readonly metadata?: PluginMetadata;

  /**
   * 插件翻译内容（静态属性，可选）
   *
   * 用于提供插件 UI 元素的多语言翻译
   * 系统会自动收集并注册到前端 i18n 系统
   */
  readonly translations?: PluginTranslations;
};

/**
 * 插件定义辅助函数
 * 提供编译时类型检查，确保插件满足所有静态和实例要求
 *
 * @example
 * ```typescript
 * export const MyPlugin = definePlugin(
 *   class implements Plugin {
 *     static readonly name = 'my-plugin';
 *     static readonly version = '1.0.0';
 *     static readonly metadata = {
 *       name: 'My Plugin',
 *       description: 'My plugin description',
 *       icon: 'extension'
 *     };
 *
 *     constructor(options: MyOptions) { }
 *
 *     register(hooks: PluginHooks) {
 *       hooks.onBeforeRequest.tapPromise({ name: 'my-plugin' }, async (ctx) => {
 *         // Plugin logic here
 *         return ctx;
 *       });
 *     }
 *   }
 * );
 *
 * export default MyPlugin;
 * ```
 */
export function definePlugin<T extends Plugin>(
  plugin: PluginConstructor & { new(...args: any[]): T }
): typeof plugin {
  return plugin;
}

/**
 * 运行时辅助函数：获取插件实例的名称
 * 从插件类的静态属性读取
 */
export function getPluginName(plugin: Plugin): string {
  return (plugin.constructor as PluginConstructor).name;
}

/**
 * 运行时辅助函数：获取插件实例的版本
 * 从插件类的静态属性读取
 */
export function getPluginVersion(plugin: Plugin): string {
  return (plugin.constructor as PluginConstructor).version;
}

/**
 * 运行时辅助函数：获取插件实例的描述
 * 从插件类的 metadata.description 静态属性读取
 */
export function getPluginDescription(plugin: Plugin): string | undefined {
  return (plugin.constructor as PluginConstructor).metadata?.description;
}

/**
 * 运行时辅助函数：获取插件实例的元数据
 * 从插件类的静态属性读取
 */
export function getPluginMetadata(plugin: Plugin): PluginMetadata | undefined {
  return (plugin.constructor as PluginConstructor).metadata;
}
