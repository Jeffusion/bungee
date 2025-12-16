/**
 * AI Transformer Plugin
 *
 * 统一的 AI 格式转换插件，通过配置支持多种转换方向
 *
 * 使用方式：
 * ```json
 * {
 *   "name": "ai-transformer",
 *   "options": {
 *     "from": "anthropic",
 *     "to": "openai"
 *   }
 * }
 * ```
 *
 * 支持的转换方向：
 * - anthropic ↔ openai
 * - anthropic ↔ gemini
 * - openai ↔ gemini
 */

import type { Plugin, PluginConfigField, PluginTranslations } from '../../plugin.types';
import { definePlugin } from '../../plugin.types';
import type { PluginHooks } from '../../hooks';
import { TransformerRegistry, AIConverter } from './converters';
import { logger } from '../../logger';

// 导入所有 converter
import { AnthropicToOpenAIConverter } from './converters/anthropic-to-openai.converter';
import { OpenAIToAnthropicConverter } from './converters/openai-to-anthropic.converter';
import { AnthropicToGeminiConverter } from './converters/anthropic-to-gemini.converter';
import { GeminiToAnthropicConverter } from './converters/gemini-to-anthropic.converter';
import { OpenAIToGeminiConverter } from './converters/openai-to-gemini.converter';
import { GeminiToOpenAIConverter } from './converters/gemini-to-openai.converter';

/**
 * AI Transformer Plugin Options
 */
interface AITransformerOptions {
  /**
   * 源格式标识符（如 'anthropic', 'openai', 'gemini'）
   */
  from: string;

  /**
   * 目标格式标识符（如 'anthropic', 'openai', 'gemini'）
   */
  to: string;
}

/**
 * AI Transformer Plugin
 *
 * 通过配置动态选择转换器，实现统一的转换接口
 */
export const AITransformerPlugin = definePlugin(
  class implements Plugin {
    /**
     * 插件唯一标识符（静态）
     */
    static readonly name = 'ai-transformer';

    /**
     * 插件版本（静态）
     */
    static readonly version = '2.0.0';

    /**
     * 插件元数据（静态）
     */
    static readonly metadata = {
      name: 'metadata.name',
      description: 'plugin.description',
      icon: 'transform'
    };

    /**
     * 插件配置 Schema（静态）
     * 定义插件所需的配置项，用于 UI 动态生成表单
     */
    static readonly configSchema: PluginConfigField[] = [
      {
        name: 'transformation',
        type: 'select',
        label: 'transformation.label',
        required: true,
        description: 'transformation.description',

        // 🔑 字段转换规则（可序列化）
        fieldTransform: {
          type: 'split',
          separator: '-',
          fields: ['from', 'to']
        },

        options: [
          {
            label: 'options.anthropic_openai.label',
            value: 'anthropic-openai',
            description: 'options.anthropic_openai.description'
          },
          {
            label: 'options.openai_anthropic.label',
            value: 'openai-anthropic',
            description: 'options.openai_anthropic.description'
          },
          {
            label: 'options.anthropic_gemini.label',
            value: 'anthropic-gemini',
            description: 'options.anthropic_gemini.description'
          },
          {
            label: 'options.gemini_anthropic.label',
            value: 'gemini-anthropic',
            description: 'options.gemini_anthropic.description'
          },
          {
            label: 'options.openai_gemini.label',
            value: 'openai-gemini',
            description: 'options.openai_gemini.description'
          },
          {
            label: 'options.gemini_openai.label',
            value: 'gemini-openai',
            description: 'options.gemini_openai.description'
          }
        ]
      }
    ];

    /**
     * 插件翻译内容（静态）
     * 提供插件 UI 元素的多语言翻译
     */
    static readonly translations: PluginTranslations = {
      en: {
        'plugin.description': 'Unified AI format transformer supporting Anthropic, OpenAI, and Gemini',
        'metadata.name': 'AI Transformer',
        'transformation.label': 'Transformation Direction',
        'transformation.description': 'Select the AI format transformation direction',
        'options.anthropic_openai.label': 'Anthropic → OpenAI',
        'options.anthropic_openai.description': 'Transform from Claude API to OpenAI GPT API',
        'options.openai_anthropic.label': 'OpenAI → Anthropic',
        'options.openai_anthropic.description': 'Transform from OpenAI GPT API to Claude API',
        'options.anthropic_gemini.label': 'Anthropic → Gemini',
        'options.anthropic_gemini.description': 'Transform from Claude API to Google Gemini API',
        'options.gemini_anthropic.label': 'Gemini → Anthropic',
        'options.gemini_anthropic.description': 'Transform from Google Gemini API to Claude API',
        'options.openai_gemini.label': 'OpenAI → Gemini',
        'options.openai_gemini.description': 'Transform from OpenAI GPT API to Google Gemini API',
        'options.gemini_openai.label': 'Gemini → OpenAI',
        'options.gemini_openai.description': 'Transform from Google Gemini API to OpenAI GPT API'
      },
      'zh-CN': {
        'plugin.description': '统一的 AI 格式转换器，支持 Anthropic、OpenAI 和 Gemini',
        'metadata.name': 'AI 格式转换器',
        'transformation.label': '转换方向',
        'transformation.description': '选择 AI 格式转换方向',
        'options.anthropic_openai.label': 'Anthropic → OpenAI',
        'options.anthropic_openai.description': '将 Claude API 转换为 OpenAI GPT API',
        'options.openai_anthropic.label': 'OpenAI → Anthropic',
        'options.openai_anthropic.description': '将 OpenAI GPT API 转换为 Claude API',
        'options.anthropic_gemini.label': 'Anthropic → Gemini',
        'options.anthropic_gemini.description': '将 Claude API 转换为 Google Gemini API',
        'options.gemini_anthropic.label': 'Gemini → Anthropic',
        'options.gemini_anthropic.description': '将 Google Gemini API 转换为 Claude API',
        'options.openai_gemini.label': 'OpenAI → Gemini',
        'options.openai_gemini.description': '将 OpenAI GPT API 转换为 Google Gemini API',
        'options.gemini_openai.label': 'Gemini → OpenAI',
        'options.gemini_openai.description': '将 Google Gemini API 转换为 OpenAI GPT API'
      }
    };

    converter: AIConverter;
    options: AITransformerOptions;

    constructor(options: AITransformerOptions) {
    // 验证 options
    if (!options || !options.from || !options.to) {
      throw new Error(
        'AITransformerPlugin requires both "from" and "to" in options.\n' +
        'Example: { "from": "anthropic", "to": "openai" }\n\n' +
        'Available formats: anthropic, openai, gemini'
      );
    }

    this.options = options;

    try {
      // 从注册表获取对应的 converter
      this.converter = TransformerRegistry.get(options.from, options.to);

      logger.info(
        { from: options.from, to: options.to },
        'AI transformer initialized'
      );
    } catch (error) {
      logger.error(
        { error, from: options.from, to: options.to },
        'Failed to initialize AI transformer'
      );
      throw error;
    }
  }

  /**
   * 注册插件 hooks
   */
  register(hooks: PluginHooks): void {
    // 1. 请求前处理：转换请求格式
    if (this.converter.onBeforeRequest) {
      hooks.onBeforeRequest.tapPromise(
        { name: 'ai-transformer', stage: 0 },
        async (ctx) => {
          try {
            await this.converter.onBeforeRequest!(ctx);
            logger.debug(
              { from: this.options.from, to: this.options.to, path: ctx.url.pathname },
              'Request transformed'
            );
          } catch (error) {
            logger.error(
              { error, from: this.options.from, to: this.options.to },
              'Error transforming request'
            );
            throw error;
          }
          return ctx;
        }
      );
    }

    // 2. 响应处理：转换响应格式
    if (this.converter.onResponse) {
      hooks.onResponse.tapPromise(
        { name: 'ai-transformer' },
        async (response, ctx) => {
          try {
            const result = await this.converter.onResponse!(ctx);
            if (result) {
              logger.debug(
                { from: this.options.from, to: this.options.to },
                'Response transformed'
              );
              return result;
            }
            return response;
          } catch (error) {
            logger.error(
              { error, from: this.options.from, to: this.options.to },
              'Error transforming response'
            );
            throw error;
          }
        }
      );
    }

    // 3. 流式响应块处理：转换流数据格式
    if (this.converter.processStreamChunk) {
      hooks.onStreamChunk.tapPromise(
        { name: 'ai-transformer', stage: 0 },
        async (chunk, ctx) => {
          try {
            const result = await this.converter.processStreamChunk!(chunk, ctx);
            return result;
          } catch (error) {
            logger.error(
              { error, from: this.options.from, to: this.options.to },
              'Error processing stream chunk'
            );
            throw error;
          }
        }
      );
    }

    // 4. 流结束时刷新缓冲区
    if (this.converter.flushStream) {
      hooks.onFlushStream.tapPromise(
        { name: 'ai-transformer' },
        async (chunks, ctx) => {
          try {
            const flushed = await this.converter.flushStream!(ctx);
            // 合并已有的 chunks 和新刷新的 chunks
            return [...chunks, ...flushed];
          } catch (error) {
            logger.error(
              { error, from: this.options.from, to: this.options.to },
              'Error flushing stream'
            );
            throw error;
          }
        }
      );
    }
  }

  /**
   * 重置插件状态（对象池复用时调用）
   */
  async reset(): Promise<void> {
    // Transformer 是无状态的，不需要重置
  }
}
);

// 注册所有内置 converters
TransformerRegistry.register('anthropic', 'openai', AnthropicToOpenAIConverter);
TransformerRegistry.register('openai', 'anthropic', OpenAIToAnthropicConverter);
TransformerRegistry.register('anthropic', 'gemini', AnthropicToGeminiConverter);
TransformerRegistry.register('gemini', 'anthropic', GeminiToAnthropicConverter);
TransformerRegistry.register('openai', 'gemini', OpenAIToGeminiConverter);
TransformerRegistry.register('gemini', 'openai', GeminiToOpenAIConverter);

export default AITransformerPlugin;
