/**
 * OpenAI to Anthropic Converter
 *
 * 将 OpenAI Chat Completions API 格式转换为 Anthropic Messages API 格式
 *
 * 转换规则：
 * - 请求：/v1/chat/completions → /v1/messages
 * - 请求：messages、tools、reasoning_effort
 * - 响应：Anthropic message → OpenAI chat.completion
 * - 响应：Anthropic SSE → OpenAI SSE
 */

import type { AIConverter } from './base';
import type { MutableRequestContext, ResponseContext, StreamChunkContext } from '../../../../packages/core/src/hooks';
import { parseThinkingTags } from './utils';

export class OpenAIToAnthropicConverter implements AIConverter {
  readonly from = 'openai';
  readonly to = 'anthropic';

  async onBeforeRequest(ctx: MutableRequestContext): Promise<void> {
    const body = ctx.body as any;
    if (!body) return;

    const isChatEndpoint = ctx.url.pathname === '/v1/chat/completions';
    const isResponsesEndpoint = ctx.url.pathname === '/v1/responses';
    if (!isChatEndpoint && !isResponsesEndpoint) return;

    // 路径转换
    ctx.url.pathname = '/v1/messages';

    const normalizedBody = this.normalizeOpenAIRequestBody(body, isResponsesEndpoint);

    // 转换 body
    const anthropicBody: any = {};

    // Model
    anthropicBody.model = normalizedBody.model;

    const instructionParts: string[] = [];
    if (typeof normalizedBody.system === 'string' && normalizedBody.system.trim()) {
      instructionParts.push(normalizedBody.system.trim());
    }

    if (normalizedBody.messages) {
      const instructionMessages = normalizedBody.messages
        .filter((m: any) => m.role === 'system' || m.role === 'developer')
        .map((m: any) => this.extractInstructionText(m.content))
        .filter((text: string) => text.length > 0);

      instructionParts.push(...instructionMessages);
    }

    if (instructionParts.length > 0) {
      anthropicBody.system = instructionParts.join('\n');
    }

    // Convert non-system messages
    if (normalizedBody.messages) {
      anthropicBody.messages = this.convertMessages(normalizedBody.messages);
      this.validateAndCleanToolCalls(anthropicBody.messages);
    }

    // Max tokens
    if (normalizedBody.max_tokens) {
      anthropicBody.max_tokens = normalizedBody.max_tokens;
    } else if (process.env.ANTHROPIC_MAX_TOKENS) {
      anthropicBody.max_tokens = parseInt(process.env.ANTHROPIC_MAX_TOKENS);
    } else if (!normalizedBody.max_completion_tokens) {
      throw new Error('max_tokens is required. Provide it in request or set ANTHROPIC_MAX_TOKENS environment variable');
    }

    // Other parameters
    if (normalizedBody.temperature !== undefined) {
      anthropicBody.temperature = normalizedBody.temperature;
    }

    if (normalizedBody.top_p !== undefined) {
      anthropicBody.top_p = normalizedBody.top_p;
    }

    // Stop sequences
    if (normalizedBody.stop) {
      anthropicBody.stop_sequences = Array.isArray(normalizedBody.stop) ? normalizedBody.stop : [normalizedBody.stop];
    }

    // Stream
    if (normalizedBody.stream !== undefined) {
      anthropicBody.stream = normalizedBody.stream;
    }

    // Tools conversion
    if (normalizedBody.tools) {
      anthropicBody.tools = this.convertTools(normalizedBody.tools);
    }

    // Thinking budget conversion for reasoning models
    if (normalizedBody.max_completion_tokens) {
      const effort = normalizedBody.reasoning_effort || 'medium';
      const envKey = `OPENAI_${effort.toUpperCase()}_TO_ANTHROPIC_TOKENS`;
      const tokens = process.env[envKey];

      if (!tokens) {
        throw new Error(`Environment variable ${envKey} not configured for reasoning_effort conversion`);
      }

      const thinkingBudget = parseInt(tokens);
      if (isNaN(thinkingBudget)) {
        throw new Error(`Invalid ${envKey} value: must be integer`);
      }

      anthropicBody.thinking = {
        type: 'enabled',
        budget_tokens: thinkingBudget
      };
    }

    ctx.body = anthropicBody;
  }

  private normalizeOpenAIRequestBody(body: any, isResponsesEndpoint: boolean): any {
    if (!isResponsesEndpoint) return body;

    const normalized: any = {
      ...body,
      messages: this.convertResponsesInputToMessages(body.input)
    };

    if (normalized.max_tokens === undefined && body.max_output_tokens !== undefined) {
      normalized.max_tokens = body.max_output_tokens;
    }

    if (typeof body.instructions === 'string' && body.instructions.trim()) {
      normalized.system = body.instructions.trim();
    }

    return normalized;
  }

  private convertResponsesInputToMessages(input: any): any[] {
    if (typeof input === 'string') {
      const text = input.trim();
      return text ? [{ role: 'user', content: text }] : [];
    }

    if (!Array.isArray(input)) {
      return [];
    }

    const messages: any[] = [];
    const pendingTopLevelInputParts: any[] = [];

    const flushPendingTopLevelInputParts = (): void => {
      if (pendingTopLevelInputParts.length === 0) return;

      messages.push({
        role: 'user',
        content: this.normalizeResponsesMessageContent([...pendingTopLevelInputParts])
      });

      pendingTopLevelInputParts.length = 0;
    };

    for (const item of input) {
      if (typeof item === 'string') {
        if (item.trim()) {
          pendingTopLevelInputParts.push({ type: 'input_text', text: item });
        }
        continue;
      }

      if (!item || typeof item !== 'object') {
        continue;
      }

      const itemType = item.type;

      if (
        itemType === 'input_text'
        || itemType === 'output_text'
        || itemType === 'input_image'
        || itemType === 'text'
        || itemType === 'image_url'
      ) {
        pendingTopLevelInputParts.push(item);
        continue;
      }

      if (itemType === 'function_call') {
        flushPendingTopLevelInputParts();

        const rawArgs = item.arguments;
        const argumentsString = typeof rawArgs === 'string'
          ? rawArgs
          : JSON.stringify(rawArgs || {});

        messages.push({
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: item.call_id || item.id || '',
            type: 'function',
            function: {
              name: item.name || '',
              arguments: argumentsString
            }
          }]
        });
        continue;
      }

      if (itemType === 'function_call_output') {
        flushPendingTopLevelInputParts();

        messages.push({
          role: 'tool',
          tool_call_id: item.call_id || '',
          content: item.output ?? '',
          is_error: item.is_error === true || item.status === 'error' || item.status === 'failed'
        });
        continue;
      }

      if (itemType === 'message') {
        flushPendingTopLevelInputParts();

        const role = item.role || 'user';
        if (typeof role === 'string') {
          messages.push({
            role,
            content: this.normalizeResponsesMessageContent(item.content)
          });
        }
        continue;
      }

      if (typeof item.role === 'string') {
        flushPendingTopLevelInputParts();

        messages.push({
          role: item.role,
          content: this.normalizeResponsesMessageContent(item.content)
        });
      }
    }

    flushPendingTopLevelInputParts();

    return messages;
  }

  private normalizeResponsesMessageContent(content: any): any {
    if (typeof content === 'string') {
      return content;
    }

    if (!Array.isArray(content)) {
      return content;
    }

    const converted = content
      .map((part: any) => {
        if (typeof part === 'string') {
          return { type: 'text', text: part };
        }

        if (!part || typeof part !== 'object') {
          return null;
        }

        if (part.type === 'input_text' || part.type === 'output_text') {
          return { type: 'text', text: part.text || '' };
        }

        if (part.type === 'input_image') {
          const imageUrl = typeof part.image_url === 'string'
            ? part.image_url
            : part.image_url?.url;

          if (typeof imageUrl === 'string' && imageUrl) {
            return {
              type: 'image_url',
              image_url: { url: imageUrl }
            };
          }
        }

        return part;
      })
      .filter((part: any) => part !== null);

    return converted;
  }

  private convertTools(tools: any[]): any[] {
    return tools
      .filter((t: any) => t?.type === 'function')
      .map((t: any) => {
        if (t.function) {
          return {
            name: t.function.name || '',
            description: t.function.description || '',
            input_schema: t.function.parameters || {}
          };
        }

        return {
          name: t.name || '',
          description: t.description || '',
          input_schema: t.parameters || {}
        };
      })
      .filter((t: any) => t.name);
  }

  private extractInstructionText(content: any): string {
    if (typeof content === 'string') {
      return content.trim();
    }

    if (Array.isArray(content)) {
      return content
        .map((item: any) => {
          if (typeof item === 'string') return item;
          if (item?.type === 'text') return item.text || '';
          if (typeof item?.text === 'string') return item.text;
          return '';
        })
        .join('')
        .trim();
    }

    return '';
  }

  private validateAndCleanToolCalls(messages: any[]): void {
    const toolResultIds = new Set<string>();

    for (const msg of messages) {
      if (msg.role === 'user' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            toolResultIds.add(block.tool_use_id);
          }
        }
      }
    }

    for (const msg of messages) {
      if (msg.role === 'assistant' && Array.isArray(msg.content)) {
        msg.content = msg.content.filter((block: any) => {
          if (block.type === 'tool_use') {
            return toolResultIds.has(block.id);
          }
          return true;
        });
      }
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && Array.isArray(msg.content) && msg.content.length === 0) {
        messages.splice(i, 1);
      }
    }
  }

  private parseImageSource(url: string): any | null {
    if (!url) return null;

    if (url.startsWith('data:')) {
      const parts = url.split(';base64,');
      if (parts.length !== 2) return null;

      return {
        type: 'base64',
        media_type: parts[0].replace('data:', ''),
        data: parts[1]
      };
    }

    if (url.startsWith('http://') || url.startsWith('https://')) {
      return {
        type: 'url',
        url
      };
    }

    return null;
  }

  private normalizeToolResultContent(content: any): string | any[] {
    if (content === undefined || content === null) {
      return '';
    }

    if (typeof content === 'string') {
      return content;
    }

    if (Array.isArray(content)) {
      const blocks = content
        .map((part: any) => this.convertToolResultPart(part))
        .filter((part: any) => part !== null);

      if (blocks.length === 0) {
        return '';
      }

      if (blocks.length === 1 && blocks[0].type === 'text') {
        return blocks[0].text;
      }

      return blocks;
    }

    if (typeof content === 'object') {
      if ('content' in content) {
        return this.normalizeToolResultContent(content.content);
      }

      return JSON.stringify(content);
    }

    return String(content);
  }

  private convertToolResultPart(part: any): any | null {
    if (typeof part === 'string') {
      const text = part.trim();
      return text ? { type: 'text', text } : null;
    }

    if (!part || typeof part !== 'object') {
      return null;
    }

    if (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') {
      const text = typeof part.text === 'string' ? part.text : '';
      return text.trim() ? { type: 'text', text } : null;
    }

    if (part.type === 'image_url' || part.type === 'input_image') {
      const imageUrl = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      const source = typeof imageUrl === 'string' ? this.parseImageSource(imageUrl) : null;

      if (source) {
        return {
          type: 'image',
          source
        };
      }
    }

    if (part.type === 'image' && part.source) {
      return {
        type: 'image',
        source: part.source
      };
    }

    return {
      type: 'text',
      text: JSON.stringify(part)
    };
  }

  private convertToolMessageToResultBlock(toolMsg: any): any {
    const resultContent = this.normalizeToolResultContent(toolMsg.content);
    const block: any = {
      type: 'tool_result',
      tool_use_id: toolMsg.tool_call_id || '',
      content: resultContent
    };

    if (toolMsg.is_error === true) {
      block.is_error = true;
    }

    return block;
  }

  private convertMessages(messages: any[]): any[] {
    const anthropicMessages: any[] = [];
    const filtered = messages.filter((m: any) => m.role !== 'system' && m.role !== 'developer');

    let i = 0;
    while (i < filtered.length) {
      const msg = filtered[i];
      const role = msg.role;

      // Merge consecutive tool messages
      if (role === 'tool') {
        const toolResults: any[] = [];

        while (i < filtered.length && filtered[i].role === 'tool') {
          const toolMsg = filtered[i];
          toolResults.push(this.convertToolMessageToResultBlock(toolMsg));
          i++;
        }

        if (toolResults.length > 0) {
          anthropicMessages.push({
            role: 'user',
            content: toolResults
          });
        }
        continue;
      }

      i++;

      if (role === 'user') {
        const content = msg.content;

        if (typeof content === 'string') {
          const textContent = content.trim();
          if (!textContent) continue;

          const blocks = parseThinkingTags(content);

          if (blocks.length === 0) {
            anthropicMessages.push({ role: 'user', content: textContent });
          } else if (blocks.length === 1 && blocks[0].type === 'text') {
            anthropicMessages.push({ role: 'user', content: blocks[0].text });
          } else {
            anthropicMessages.push({ role: 'user', content: blocks });
          }
        } else if (Array.isArray(content)) {
          const images: any[] = [];
          const texts: any[] = [];
          const others: any[] = [];

          for (const item of content) {
            if (typeof item === 'string') {
              texts.push({ type: 'text', text: item });
            } else if (item.type === 'image_url' || item.type === 'input_image') {
              images.push(item);
            } else if (item.type === 'text' || item.type === 'input_text' || item.type === 'output_text') {
              texts.push(item);
            } else {
              others.push(item);
            }
          }

          const anthropicContent: any[] = [];

          for (const img of images) {
            const url = typeof img.image_url === 'string' ? img.image_url : (img.image_url?.url || '');
            const source = this.parseImageSource(url);
            if (source) {
              anthropicContent.push({
                type: 'image',
                source
              });
            }
          }

          for (const txt of texts) {
            const textContent = txt.text || '';
            if (textContent.trim()) {
              anthropicContent.push({ type: 'text', text: textContent });
            }
          }

          anthropicContent.push(...others);

          if (anthropicContent.length > 0) {
            if (anthropicContent.length === 1 && anthropicContent[0].type === 'text') {
              anthropicMessages.push({ role: 'user', content: anthropicContent[0].text });
            } else {
              anthropicMessages.push({ role: 'user', content: anthropicContent });
            }
          }
        }
      } else if (role === 'assistant') {
        if (msg.tool_calls) {
          const content: any[] = [];

          const assistantText = this.extractInstructionText(msg.content);
          if (assistantText) {
            content.push({ type: 'text', text: assistantText });
          }

          for (const tc of msg.tool_calls) {
            if (tc.type === 'function' && tc.function) {
              const argsStr = tc.function.arguments || '{}';
              let argsObj = {};

              try {
                argsObj = typeof argsStr === 'string' ? JSON.parse(argsStr) : argsStr;
              } catch (e) {
                // Ignore parse error
              }

              content.push({
                type: 'tool_use',
                id: tc.id || '',
                name: tc.function.name || '',
                input: argsObj
              });
            }
          }

          if (content.length > 0) {
            anthropicMessages.push({ role: 'assistant', content });
          }
        } else {
          const content = msg.content;

          if (typeof content === 'string') {
            if (content.trim()) {
              anthropicMessages.push({ role: 'assistant', content });
            }
          } else if (Array.isArray(content)) {
            const anthropicContent: any[] = [];

            for (const part of content) {
              if (typeof part === 'string') {
                if (part.trim()) {
                  anthropicContent.push({ type: 'text', text: part });
                }
                continue;
              }

              if (!part || typeof part !== 'object') {
                continue;
              }

              if (part.type === 'text' || part.type === 'input_text' || part.type === 'output_text') {
                const text = typeof part.text === 'string' ? part.text : '';
                if (text.trim()) {
                  anthropicContent.push({ type: 'text', text });
                }
                continue;
              }

              if (part.type === 'thinking') {
                const thinking = typeof part.thinking === 'string' ? part.thinking : '';
                if (thinking.trim()) {
                  anthropicContent.push({ type: 'thinking', thinking });
                }
                continue;
              }

              if (part.type === 'image_url' || part.type === 'input_image') {
                const imageUrl = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
                const source = typeof imageUrl === 'string' ? this.parseImageSource(imageUrl) : null;
                if (source) {
                  anthropicContent.push({ type: 'image', source });
                }
                continue;
              }

              if (part.type === 'image' && part.source) {
                anthropicContent.push({ type: 'image', source: part.source });
              }
            }

            if (anthropicContent.length === 1 && anthropicContent[0].type === 'text') {
              anthropicMessages.push({ role: 'assistant', content: anthropicContent[0].text });
            } else if (anthropicContent.length > 0) {
              anthropicMessages.push({ role: 'assistant', content: anthropicContent });
            }
          }
        }
      }
    }

    return anthropicMessages;
  }

  async onResponse(ctx: ResponseContext): Promise<Response | void> {
    const contentType = ctx.response.headers.get('content-type') || '';
    if (!contentType.includes('application/json') || !ctx.response.ok) {
      return;
    }

    const responseClone = ctx.response.clone();
    const anthropicBody = await responseClone.json();

    const openaiBody = this.convertAnthropicResponseToOpenAI(anthropicBody);

    return new Response(JSON.stringify(openaiBody), {
      status: ctx.response.status,
      statusText: ctx.response.statusText,
      headers: ctx.response.headers
    });
  }

  private convertAnthropicResponseToOpenAI(anthropicBody: any): any {
    const content = anthropicBody.content || [];
    let textContent = '';
    const toolCalls: any[] = [];
    let thinkingContent = '';

    for (const item of content) {
      if (item.type === 'text') {
        textContent += item.text || '';
      } else if (item.type === 'thinking') {
        thinkingContent += item.thinking || '';
      } else if (item.type === 'tool_use') {
        toolCalls.push({
          id: item.id || '',
          type: 'function',
          function: {
            name: item.name || '',
            arguments: JSON.stringify(item.input || {})
          }
        });
      }
    }

    if (thinkingContent.trim()) {
      textContent = `<thinking>\n${thinkingContent.trim()}\n</thinking>\n\n${textContent}`;
    }

    const message: any = { role: 'assistant' };
    if (toolCalls.length > 0) {
      message.content = textContent || null;
      message.tool_calls = toolCalls;
    } else {
      message.content = textContent;
    }

    const stopReason = anthropicBody.stop_reason;
    let finishReason = 'stop';
    if (stopReason === 'tool_use') finishReason = 'tool_calls';
    else if (stopReason === 'end_turn') finishReason = 'stop';
    else if (stopReason === 'max_tokens') finishReason = 'length';
    else if (stopReason === 'stop_sequence') finishReason = 'stop';

    return {
      id: `chatcmpl-${anthropicBody.id.replace('msg_', '')}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: anthropicBody.model,
      choices: [{
        index: 0,
        message,
        finish_reason: finishReason
      }],
      usage: {
        prompt_tokens: anthropicBody.usage?.input_tokens || 0,
        completion_tokens: anthropicBody.usage?.output_tokens || 0,
        total_tokens: (anthropicBody.usage?.input_tokens || 0) + (anthropicBody.usage?.output_tokens || 0)
      }
    };
  }

  async processStreamChunk(chunk: any, ctx: StreamChunkContext): Promise<any[] | null> {
    const eventType = chunk.type;

    if (!ctx.streamState.has('streamId')) {
      ctx.streamState.set('streamId', crypto.randomUUID());
    }
    const streamId = ctx.streamState.get('streamId') as string;

    if (eventType === 'message_start') {
      return [{
        id: `chatcmpl-${streamId}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: chunk.message?.model || 'claude',
        choices: [{
          index: 0,
          delta: { role: 'assistant' },
          finish_reason: null
        }]
      }];
    }

    if (eventType === 'content_block_start') {
      const contentBlock = chunk.content_block || {};

      if (contentBlock.type === 'tool_use') {
        return [{
          id: `chatcmpl-${streamId}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: chunk.message?.model || 'claude',
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: chunk.index || 0,
                id: contentBlock.id || '',
                type: 'function',
                function: { name: contentBlock.name || '' }
              }]
            },
            finish_reason: null
          }]
        }];
      }

      return [];
    }

    if (eventType === 'content_block_delta') {
      const delta = chunk.delta || {};
      const openaiDelta: any = {};

      if (delta.type === 'text_delta') {
        openaiDelta.content = delta.text || '';
      } else if (delta.type === 'thinking_delta') {
        openaiDelta.content = `<thinking>${delta.thinking || ''}</thinking>`;
      } else if (delta.type === 'input_json_delta') {
        openaiDelta.tool_calls = [{
          index: chunk.index || 0,
          function: {
            arguments: delta.partial_json || ''
          }
        }];
      }

      if (Object.keys(openaiDelta).length === 0) {
        return [];
      }

      return [{
        id: `chatcmpl-${streamId}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: chunk.message?.model || 'claude',
        choices: [{
          index: 0,
          delta: openaiDelta,
          finish_reason: null
        }]
      }];
    }

    if (eventType === 'message_delta') {
      const stopReason = chunk.delta?.stop_reason;
      let finishReason = 'stop';
      if (stopReason === 'tool_use') finishReason = 'tool_calls';
      else if (stopReason === 'max_tokens') finishReason = 'length';
      else if (stopReason === 'stop_sequence') finishReason = 'stop';

      // Anthropic message_delta 的 usage 在顶层，包含 input_tokens 和 output_tokens
      const usage = chunk.usage ? {
        prompt_tokens: chunk.usage.input_tokens || 0,
        completion_tokens: chunk.usage.output_tokens || 0,
        total_tokens: (chunk.usage.input_tokens || 0) + (chunk.usage.output_tokens || 0)
      } : undefined;

      return [{
        id: `chatcmpl-${streamId}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: chunk.message?.model || 'claude',
        choices: [{
          index: 0,
          delta: {},
          finish_reason: finishReason
        }],
        ...(usage && { usage })
      }];
    }

    return [];
  }

  async flushStream(ctx: StreamChunkContext): Promise<any[]> {
    return [];
  }
}
