/**
 * Plugin 系统类型定义
 */

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
   *
   * 翻译键命名规范：
   * - 使用点号分隔的扁平结构（如 'field.label', 'options.value1.label'）
   * - 避免使用插件名前缀（系统会自动添加 `plugins.{pluginName}` 前缀）
   *
   * @example
   * ```typescript
   * static readonly translations: PluginTranslations = {
   *   'en': {
   *     'transformation.label': 'Transformation Direction',
   *     'options.anthropic_openai.label': 'Anthropic → OpenAI'
   *   },
   *   'zh-CN': {
   *     'transformation.label': '转换方向',
   *     'options.anthropic_openai.label': 'Anthropic → OpenAI'
   *   }
   * };
   * ```
   */
  readonly translations?: PluginTranslations;
};

/**
 * 类型守卫：检查插件类是否有 configSchema
 */
export function hasConfigSchema(
  PluginClass: any
): PluginClass is PluginConstructor & { configSchema: PluginConfigField[] } {
  return 'configSchema' in PluginClass && Array.isArray(PluginClass.configSchema);
}

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
 *     async onBeforeRequest(ctx: PluginContext) { }
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

/**
 * Plugin 初始化上下文
 */
export interface PluginInitContext {
  /**
   * Plugin 专属存储实例
   */
  storage: PluginStorage;

  /**
   * 日志记录器
   */
  logger: any;

  /**
   * 插件配置
   */
  config: any;
}

/**
 * Plugin 可修改的 URL 字段（白名单）
 *
 * 只暴露路径相关的字段，不暴露 host/protocol 等上游信息，
 * 确保 plugin 无法修改请求的目标服务器，保证请求隔离。
 */
export interface ModifiableUrlFields {
  /**
   * 路径部分，如 /v1/chat/completions
   * Plugin 可以修改此字段来转换请求路径
   */
  pathname: string;

  /**
   * 查询参数，如 ?foo=bar
   * Plugin 可以修改此字段来添加或修改查询参数
   */
  search: string;

  /**
   * Hash 部分，如 #section
   * Plugin 可以修改此字段（通常较少使用）
   */
  hash: string;
}

/**
 * Plugin Context 中的受保护 URL 对象
 *
 * 设计理念：
 * - Plugin 可以读取完整的 URL 信息（用于判断逻辑）
 * - 但只能修改 pathname, search, hash（白名单字段）
 * - protocol, host 等字段为只读，确保请求不会被转发到错误的服务器
 *
 * 实现方式：
 * - 使用 Proxy 在运行时拦截非法修改
 * - 使用 readonly 在编译时阻止非法修改
 */
export interface PluginUrl extends ModifiableUrlFields {
  /** 只读的完整 URL 字符串，用于日志和调试 */
  readonly href: string;

  /** 只读的协议，如 https: */
  readonly protocol: string;

  /** 只读的主机名（含端口），如 api.example.com:443 */
  readonly host: string;

  /** 只读的主机名（不含端口），如 api.example.com */
  readonly hostname: string;

  /** 只读的端口，如 443 */
  readonly port: string;

  /** 只读的 origin，如 https://api.example.com */
  readonly origin: string;
}

/**
 * Plugin 上下文
 * 提供给 plugin 钩子的请求上下文信息
 */
export interface PluginContext {
  /**
   * 请求方法
   */
  method: string;

  /**
   * 请求 URL（受保护）
   *
   * Plugin 可以：
   * - 读取：所有字段（protocol, host, pathname, search, hash 等）
   * - 修改：pathname, search, hash
   *
   * 不可修改：protocol, host, hostname, port, origin
   */
  url: PluginUrl;

  /**
   * 请求 headers（可修改）
   */
  headers: Record<string, string>;

  /**
   * 请求 body（可修改）
   */
  body: any;

  /**
   * 请求日志对象
   */
  request: any;
}

/**
 * 流式 Chunk 上下文
 * 提供给流式转换钩子的上下文信息
 */
export interface StreamChunkContext {
  /**
   * 当前 chunk 的索引（从 0 开始）
   */
  chunkIndex: number;

  /**
   * 是否是第一个 chunk
   */
  isFirstChunk: boolean;

  /**
   * 是否是最后一个 chunk
   */
  isLastChunk: boolean;

  /**
   * 跨 chunk 的状态存储
   * 用于在多个 chunks 之间共享状态
   */
  streamState: Map<string, any>;

  /**
   * 请求日志对象
   */
  request: any;
}

/**
 * Plugin 接口
 * 所有 plugins 必须实现此接口
 *
 * 注意：
 * 1. 插件的元数据（name、version、description、configSchema、metadata）
 *    应定义为类的静态属性
 * 2. 运行时通过 getPluginName(plugin) 等辅助函数访问元数据
 * 3. 使用 definePlugin() 辅助函数包装类定义以获得编译时类型检查
 */
export interface Plugin {
  /**
   * Plugin 初始化钩子（全局级别）
   * 在插件加载时调用一次，用于初始化全局资源
   * @param context - 插件初始化上下文
   */
  onInit?(context: PluginInitContext): Promise<void>;

  /**
   * 请求初始化时调用
   * 可以在这里初始化请求级别的状态
   */
  onRequestInit?(ctx: PluginContext): Promise<void>;

  /**
   * 在发送到 upstream 之前调用
   * 可以修改请求的 URL、headers、body
   */
  onBeforeRequest?(ctx: PluginContext): Promise<void>;

  /**
   * 拦截请求
   * 如果返回 Response 对象，则不会转发到 upstream
   * 如果返回 null，则继续正常流程
   */
  onInterceptRequest?(ctx: PluginContext): Promise<Response | null>;

  /**
   * 收到 upstream 响应后调用
   * 可以在这里记录响应或进行后处理
   * 如果返回新的 Response 对象，将使用该对象替换原响应
   */
  onResponse?(ctx: PluginContext & { response: Response }): Promise<Response | void>;

  /**
   * 发生错误时调用
   */
  onError?(ctx: PluginContext & { error: Error }): Promise<void>;

  /**
   * 处理流式响应的每个 chunk
   * 支持 N:M 转换：
   * - 返回 null/undefined: 不处理，原样输出
   * - 返回 []: 缓冲当前 chunk，不输出（N:0）
   * - 返回 [chunk]: 1:1 转换
   * - 返回 [chunk1, chunk2, ...]: 1:M 拆分或 N:M 批处理
   */
  processStreamChunk?(
    chunk: any,
    ctx: StreamChunkContext
  ): Promise<any[] | null>;

  /**
   * 流结束时调用（flush 缓冲区）
   * 用于输出缓冲区中剩余的 chunks
   */
  flushStream?(ctx: StreamChunkContext): Promise<any[]>;

  /**
   * 重置 plugin 状态（池化 plugin 专用）
   *
   * 当 plugin 使用 @Pooled 装饰器启用对象池时，此方法会在每次归还到池时被调用，
   * 用于清理请求级别的状态，确保下次被获取时状态是干净的。
   *
   * ⚠️ 注意事项：
   * - 只有使用 @Pooled 装饰器的 plugin 才需要实现此方法
   * - 非池化 plugin 每次请求都会创建新实例，不需要实现 reset
   * - 必须清理所有可变的实例状态（Map、Set、Array、对象属性等）
   * - 不应重置构造函数传入的配置选项
   *
   * @example
   * ```ts
   * @Pooled({ minSize: 2, maxSize: 10 })
   * export class MyHeavyPlugin implements Plugin {
   *   name = 'my-heavy-plugin';
   *   private requestCache = new Map<string, any>();
   *   private apiKey: string; // 构造函数传入的配置
   *
   *   constructor(options: { apiKey: string }) {
   *     this.apiKey = options.apiKey;
   *   }
   *
   *   async reset() {
   *     // ✅ 清理请求级状态
   *     this.requestCache.clear();
   *
   *     // ❌ 不要重置配置
   *     // this.apiKey = ''; // 错误！
   *   }
   * }
   * ```
   */
  reset?(): void | Promise<void>;

  /**
   * Plugin 卸载时调用
   * 可以在这里清理资源
   *
   * 生命周期说明：
   * - 非池化 plugin：每个请求结束时调用
   * - 池化 plugin：对象池销毁时调用（服务器关闭）
   */
  onDestroy?(): Promise<void>;
}
