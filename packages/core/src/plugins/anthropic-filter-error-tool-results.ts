/**
 * Anthropic Filter Error Tool Results Plugin
 *
 * 功能：
 * - 遍历请求体中的 messages 数组
 * - 针对每一条 user 消息，检查其 tool_result 内容
 * - 获取前一条 assistant 消息中的所有 tool_use id
 * - 过滤 user 消息：移除所有 tool_use_id 不在上一条 assistant 消息中的 tool_result
 * - 移除 content 为空的消息
 *
 * 使用场景：
 * - 修复 "Phantom Tool Results" (幻影工具结果)，即 user 消息中包含了 assistant 未曾请求的工具结果
 * - 确保 tool_result 与 tool_use 的严格对应
 * - 避免发送空消息给 upstream
 */

import { isArray, filter, map, includes, isEmpty } from 'lodash-es';
import type { Plugin, PluginContext, PluginTranslations } from '../plugin.types';
import { definePlugin } from '../plugin.types';

export const AnthropicFilterErrorToolResultsPlugin = definePlugin(
  class implements Plugin {
    /**
     * 插件唯一标识符（静态）
     */
    static readonly name = 'anthropic-filter-error-tool-results';

    /**
     * 插件版本（静态）
     */
    static readonly version = '1.0.0';

    /**
     * 插件元数据（静态）
     */
    static readonly metadata = {
      name: 'metadata.name',
      description: 'plugin.description',
      icon: 'filter_alt'
    };

    /**
     * 插件翻译内容（静态）
     */
    static readonly translations: PluginTranslations = {
      en: {
        'plugin.description': 'Filters out invalid tool results that do not match any tool_use in the previous assistant message',
        'metadata.name': 'Anthropic Tool Results Filter'
      },
      'zh-CN': {
        'plugin.description': '过滤无效的工具结果，确保每个 tool_result 都对应前一条 assistant 消息中的 tool_use',
        'metadata.name': 'Anthropic 工具结果过滤器'
      }
    };

    constructor(options?: any) {
      // 插件不需要任何配置选项
    }

  /**
   * 在发送到 upstream 之前过滤无效的 tool_result
   */
  async onBeforeRequest(ctx: PluginContext): Promise<void> {
    const body = ctx.body as any;

    if (!body || !isArray(body.messages)) {
      return;
    }

    const messages = body.messages;
    const newMessages: any[] = [];

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];

      // 只处理 user 消息，且 content 为数组的情况
      if (message.role === 'user' && isArray(message.content)) {
        let validToolIds: string[] = [];

        // 检查上一条消息是否为 assistant 且包含 content
        if (i > 0) {
          const prevMessage = messages[i - 1];
          if (prevMessage.role === 'assistant' && isArray(prevMessage.content)) {
            // 使用 lodash 提取所有 tool_use 的 id
            validToolIds = map(
              filter(prevMessage.content, { type: 'tool_use' }),
              'id'
            );
          }
        }

        // 过滤当前 user 消息的 content
        // 保留条件：
        // 1. 不是 tool_result (如 text)
        // 2. 是 tool_result 且其 tool_use_id 在 validToolIds 中
        message.content = filter(message.content, (item) => {
          if (item && item.type === 'tool_result') {
            return includes(validToolIds, item.tool_use_id);
          }
          return true;
        });
      }

      // 只有 content 不为空（且不是空数组）时才保留该消息
      if (!isEmpty(message.content)) {
        newMessages.push(message);
      }
    }

    // 更新请求体
    ctx.body.messages = newMessages;
  }
}
);

export default AnthropicFilterErrorToolResultsPlugin;
