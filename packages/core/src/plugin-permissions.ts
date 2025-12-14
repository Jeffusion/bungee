/**
 * 插件权限管理系统
 *
 * 基于 PluginMetadata 中的 capabilities 声明，实现细粒度的权限控制
 */

import type { PluginMetadata } from './plugin.types';
import { logger } from './logger';

/**
 * 权限类型枚举
 */
export enum Permission {
  // 网络权限
  NETWORK = 'network',

  // 文件系统权限
  FILESYSTEM = 'filesystem',

  // 数据库权限
  DATABASE = 'database',

  // UI权限
  UI_MODALS = 'ui:modals',
  UI_POPUPS = 'ui:popups',
  UI_FORMS = 'ui:forms',
  UI_NAVIGATION = 'ui:navigation',

  // API权限
  API_ROUTES = 'api:routes',
  API_PLUGINS = 'api:plugins',
  API_LOGS = 'api:logs',

  // Storage权限（所有插件默认拥有）
  STORAGE = 'storage',
}

/**
 * Sandbox属性映射
 * 将权限映射到iframe sandbox属性
 */
const PERMISSION_TO_SANDBOX: Record<string, string> = {
  [Permission.UI_MODALS]: 'allow-modals',
  [Permission.UI_POPUPS]: 'allow-popups allow-popups-to-escape-sandbox',
  [Permission.UI_FORMS]: 'allow-forms',
  [Permission.UI_NAVIGATION]: 'allow-top-navigation-by-user-activation',
};

/**
 * 插件权限管理器
 */
export class PluginPermissionManager {
  /**
   * 插件名称 -> 权限集合
   */
  private permissions: Map<string, Set<Permission>> = new Map();

  /**
   * 注册插件权限
   *
   * @param pluginName - 插件名称
   * @param metadata - 插件元数据
   */
  registerPlugin(pluginName: string, metadata: PluginMetadata): void {
    const permissions = new Set<Permission>();

    // 所有插件默认拥有storage权限
    permissions.add(Permission.STORAGE);

    // 基于 capabilities 添加权限
    if (metadata.capabilities) {
      const { network, filesystem, database } = metadata.capabilities;

      if (network) permissions.add(Permission.NETWORK);
      if (filesystem) permissions.add(Permission.FILESYSTEM);
      if (database) permissions.add(Permission.DATABASE);
    }

    // 基于 contributes 添加UI权限
    if (metadata.contributes) {
      // 如果提供了导航菜单，添加navigation权限
      if (metadata.contributes.navigation?.length) {
        permissions.add(Permission.UI_NAVIGATION);
      }

      // 如果提供了命令，添加相关权限
      if (metadata.contributes.commands?.length) {
        permissions.add(Permission.API_ROUTES);
      }
    }

    // UI插件默认需要基本的UI权限
    if (metadata.contributes?.navigation || metadata.contributes?.widgets) {
      permissions.add(Permission.UI_FORMS);
      permissions.add(Permission.UI_MODALS);
    }

    this.permissions.set(pluginName, permissions);

    logger.debug(
      { pluginName, permissions: Array.from(permissions) },
      'Registered plugin permissions'
    );
  }

  /**
   * 检查插件是否拥有某个权限
   *
   * @param pluginName - 插件名称
   * @param permission - 权限类型
   * @returns 是否拥有权限
   */
  hasPermission(pluginName: string, permission: Permission): boolean {
    const perms = this.permissions.get(pluginName);
    if (!perms) {
      logger.warn({ pluginName, permission }, 'Plugin not registered in permission manager');
      return false;
    }

    return perms.has(permission);
  }

  /**
   * 检查插件是否拥有多个权限（全部需要满足）
   *
   * @param pluginName - 插件名称
   * @param requiredPermissions - 需要的权限列表
   * @returns 是否拥有所有权限
   */
  hasPermissions(pluginName: string, requiredPermissions: Permission[]): boolean {
    return requiredPermissions.every(perm => this.hasPermission(pluginName, perm));
  }

  /**
   * 获取插件的所有权限
   *
   * @param pluginName - 插件名称
   * @returns 权限集合
   */
  getPermissions(pluginName: string): Set<Permission> {
    return this.permissions.get(pluginName) || new Set();
  }

  /**
   * 生成插件的iframe sandbox属性
   *
   * @param pluginName - 插件名称
   * @returns sandbox属性字符串
   */
  getSandboxAttributes(pluginName: string): string {
    const perms = this.permissions.get(pluginName);
    if (!perms) {
      // 默认最严格的sandbox
      return 'allow-scripts';
    }

    const sandboxAttrs = new Set<string>([
      'allow-scripts', // 允许执行脚本（必需）
      'allow-same-origin', // 允许访问同源资源（必需，否则无法使用localStorage等）
    ]);

    // 根据权限添加sandbox属性
    for (const perm of perms) {
      const sandboxAttr = PERMISSION_TO_SANDBOX[perm];
      if (sandboxAttr) {
        sandboxAttr.split(' ').forEach(attr => sandboxAttrs.add(attr));
      }
    }

    return Array.from(sandboxAttrs).join(' ');
  }

  /**
   * 生成插件的CSP (Content Security Policy)
   *
   * @param pluginName - 插件名称
   * @returns CSP字符串
   */
  getCSP(pluginName: string): string {
    const perms = this.permissions.get(pluginName);
    if (!perms) {
      // 默认最严格的CSP
      return "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'";
    }

    const cspDirectives: string[] = [];

    // 默认禁止所有来源
    cspDirectives.push("default-src 'self'");

    // 脚本来源（允许自身 + inline，因为某些框架需要）
    cspDirectives.push("script-src 'self' 'unsafe-inline' 'unsafe-eval'");

    // 样式来源（允许自身 + inline）
    cspDirectives.push("style-src 'self' 'unsafe-inline'");

    // 字体来源
    cspDirectives.push("font-src 'self' data:");

    // 图片来源
    cspDirectives.push("img-src 'self' data: blob:");

    // 连接来源（fetch, XHR, WebSocket等）
    if (perms.has(Permission.NETWORK)) {
      cspDirectives.push("connect-src 'self' https: wss:");
    } else {
      cspDirectives.push("connect-src 'self'");
    }

    // Frame祖先（防止被其他站点嵌入）
    cspDirectives.push("frame-ancestors 'self'");

    // 对象来源（禁止 <object>, <embed>）
    cspDirectives.push("object-src 'none'");

    // 基础URI（防止修改<base>标签）
    cspDirectives.push("base-uri 'self'");

    return cspDirectives.join('; ');
  }

  /**
   * 验证API调用权限
   *
   * @param pluginName - 插件名称
   * @param apiPath - API路径
   * @returns 是否允许访问
   */
  canAccessAPI(pluginName: string, apiPath: string): boolean {
    // API路径权限映射
    const apiPermissionMap: Record<string, Permission> = {
      '/api/plugins': Permission.API_PLUGINS,
      '/api/routes': Permission.API_ROUTES,
      '/api/logs': Permission.API_LOGS,
    };

    // 查找匹配的API权限
    for (const [prefix, permission] of Object.entries(apiPermissionMap)) {
      if (apiPath.startsWith(prefix)) {
        return this.hasPermission(pluginName, permission);
      }
    }

    // 默认允许访问未定义的API（向后兼容）
    return true;
  }

  /**
   * 注销插件权限
   *
   * @param pluginName - 插件名称
   */
  unregisterPlugin(pluginName: string): void {
    this.permissions.delete(pluginName);
    logger.debug({ pluginName }, 'Unregistered plugin permissions');
  }

  /**
   * 清空所有权限
   */
  clear(): void {
    this.permissions.clear();
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      totalPlugins: this.permissions.size,
      plugins: Array.from(this.permissions.keys()),
    };
  }
}

/**
 * 全局权限管理器实例
 */
let globalPermissionManager: PluginPermissionManager | null = null;

/**
 * 初始化全局权限管理器
 */
export function initializePermissionManager(): PluginPermissionManager {
  if (!globalPermissionManager) {
    globalPermissionManager = new PluginPermissionManager();
    logger.info('Plugin permission manager initialized');
  }
  return globalPermissionManager;
}

/**
 * 获取全局权限管理器
 */
export function getPermissionManager(): PluginPermissionManager {
  if (!globalPermissionManager) {
    throw new Error(
      'PermissionManager not initialized. Call initializePermissionManager() first.'
    );
  }
  return globalPermissionManager;
}
