/**
 * Token 计算工具模块
 *
 * 使用 js-tiktoken 进行本地 token 计算
 * 支持 OpenAI、Anthropic、Gemini 等模型
 */

import { getEncoding, type Tiktoken } from 'js-tiktoken';

/**
 * Encoding 类型
 */
type EncodingType = 'cl100k_base' | 'o200k_base';

/**
 * 模型到 Encoding 的映射
 */
const MODEL_ENCODING_MAP: Record<string, EncodingType> = {
  // OpenAI GPT-4o 系列 (o200k_base)
  'gpt-4o': 'o200k_base',
  'gpt-4o-mini': 'o200k_base',
  'gpt-4o-2024': 'o200k_base',
  'o1': 'o200k_base',
  'o1-mini': 'o200k_base',
  'o1-preview': 'o200k_base',
  'o3': 'o200k_base',
  'o3-mini': 'o200k_base',

  // OpenAI GPT-4/3.5 系列 (cl100k_base)
  'gpt-4': 'cl100k_base',
  'gpt-4-turbo': 'cl100k_base',
  'gpt-4-32k': 'cl100k_base',
  'gpt-3.5-turbo': 'cl100k_base',
  'gpt-3.5': 'cl100k_base',

  // Anthropic Claude 系列 (近似使用 cl100k_base)
  'claude': 'cl100k_base',
  'claude-3': 'cl100k_base',
  'claude-3.5': 'cl100k_base',
  'claude-3-opus': 'cl100k_base',
  'claude-3-sonnet': 'cl100k_base',
  'claude-3-haiku': 'cl100k_base',
  'claude-3.5-sonnet': 'cl100k_base',
  'claude-3.5-haiku': 'cl100k_base',

  // Google Gemini 系列 (近似使用 cl100k_base)
  'gemini': 'cl100k_base',
  'gemini-pro': 'cl100k_base',
  'gemini-1.5': 'cl100k_base',
  'gemini-2.0': 'cl100k_base',
  'gemini-2.5': 'cl100k_base',

  // DeepSeek 系列 (近似使用 cl100k_base)
  'deepseek': 'cl100k_base',
  'deepseek-chat': 'cl100k_base',
  'deepseek-coder': 'cl100k_base',
};

/**
 * Encoding 实例缓存
 */
const encodingCache = new Map<EncodingType, Tiktoken>();

/**
 * 获取 Encoding 实例（带缓存）
 */
function getEncodingCached(type: EncodingType): Tiktoken {
  let encoder = encodingCache.get(type);
  if (!encoder) {
    encoder = getEncoding(type);
    encodingCache.set(type, encoder);
  }
  return encoder;
}

/**
 * 根据模型名称获取对应的 Encoding 类型
 */
function getEncodingForModel(model: string): EncodingType {
  // 精确匹配
  if (MODEL_ENCODING_MAP[model]) {
    return MODEL_ENCODING_MAP[model];
  }

  // 前缀匹配
  const modelLower = model.toLowerCase();
  for (const [prefix, encoding] of Object.entries(MODEL_ENCODING_MAP)) {
    if (modelLower.startsWith(prefix)) {
      return encoding;
    }
  }

  // 默认使用 cl100k_base
  return 'cl100k_base';
}

/**
 * 计算文本的 token 数
 */
export function countTokens(text: string, model: string = 'gpt-4'): number {
  if (!text) return 0;

  try {
    const encodingType = getEncodingForModel(model);
    const encoder = getEncodingCached(encodingType);
    return encoder.encode(text).length;
  } catch {
    // Fallback: 粗略估算（4 字符 ≈ 1 token）
    return Math.ceil(text.length / 4);
  }
}

/**
 * 消息内容类型
 */
interface MessageContent {
  type: string;
  text?: string;
  image_url?: { url: string };
  source?: { type: string; media_type?: string; data?: string };
}

/**
 * 消息类型
 */
interface Message {
  role: string;
  content?: string | MessageContent[];
  tool_calls?: any[];
}

/**
 * 计算消息数组的输入 token 数
 *
 * 支持格式：
 * - OpenAI: messages 数组
 * - Anthropic: messages 数组 + system
 * - Gemini: contents 数组 + systemInstruction
 */
export function countInputTokens(body: any, model: string = 'gpt-4'): number {
  let totalTokens = 0;

  // 1. System prompt
  if (body.system) {
    totalTokens += countTokens(body.system, model);
    totalTokens += 4; // system 消息格式开销
  }

  // Gemini systemInstruction
  if (body.systemInstruction?.parts) {
    for (const part of body.systemInstruction.parts) {
      if (part.text) {
        totalTokens += countTokens(part.text, model);
      }
    }
    totalTokens += 4;
  }

  // 2. Messages (OpenAI/Anthropic 格式)
  const messages = body.messages || [];
  for (const msg of messages) {
    totalTokens += countMessageTokens(msg, model);
  }

  // 3. Contents (Gemini 格式)
  const contents = body.contents || [];
  for (const content of contents) {
    totalTokens += countGeminiContentTokens(content, model);
  }

  // 4. Tools/Functions 定义
  if (body.tools) {
    const toolsJson = JSON.stringify(body.tools);
    totalTokens += countTokens(toolsJson, model);
  }

  return totalTokens;
}

/**
 * 计算单条消息的 token 数
 */
function countMessageTokens(msg: Message, model: string): number {
  let tokens = 4; // 消息格式开销 (<|im_start|>role\n...content...<|im_end|>)

  // 文本内容
  if (typeof msg.content === 'string') {
    tokens += countTokens(msg.content, model);
  } else if (Array.isArray(msg.content)) {
    // 多模态内容
    for (const part of msg.content) {
      if (part.type === 'text' && part.text) {
        tokens += countTokens(part.text, model);
      } else if (part.type === 'image_url' || part.type === 'image') {
        // 图片估算（根据 OpenAI 文档：low detail = 85, high detail = 170-1105）
        tokens += estimateImageTokens(part);
      }
    }
  }

  // Tool calls
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      tokens += countTokens(tc.function?.name || '', model);
      tokens += countTokens(tc.function?.arguments || '', model);
      tokens += 10; // tool call 格式开销
    }
  }

  return tokens;
}

/**
 * 计算 Gemini content 的 token 数
 */
function countGeminiContentTokens(content: any, model: string): number {
  let tokens = 4; // 消息格式开销

  const parts = content.parts || [];
  for (const part of parts) {
    if (part.text) {
      tokens += countTokens(part.text, model);
    } else if (part.inlineData) {
      // 图片估算
      tokens += 258; // Gemini 2.0 标准图片 token 数
    } else if (part.functionCall) {
      tokens += countTokens(part.functionCall.name || '', model);
      tokens += countTokens(JSON.stringify(part.functionCall.args || {}), model);
      tokens += 10;
    } else if (part.functionResponse) {
      tokens += countTokens(part.functionResponse.name || '', model);
      tokens += countTokens(JSON.stringify(part.functionResponse.response || {}), model);
      tokens += 10;
    }
  }

  return tokens;
}

/**
 * 估算图片 token 数
 *
 * 基于 OpenAI 文档：
 * - low detail: 85 tokens
 * - high detail: 170 base + 85 per 512x512 tile
 * - 默认使用 170 tokens（中等估算）
 */
function estimateImageTokens(imagePart: MessageContent): number {
  // 简化估算：统一使用 170 tokens
  // 实际应根据图片尺寸和 detail 参数计算
  return 170;
}

/**
 * 计算输出文本的 token 数
 */
export function countOutputTokens(content: string, model: string = 'gpt-4'): number {
  return countTokens(content, model);
}
