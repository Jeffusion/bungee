import type { LLMProvider } from '../core/types';
import { getProviderTokenAccountingCapabilities } from './capabilities';
import {
  asString,
  clampTokens,
  countModelTextTokens,
  countJsonLikeTokens,
  countTextTokens,
  createPartialTokenAccountingEvent,
  finalizeTokenAccountingEvent,
  isRecord,
  readNumber,
  readRecord
} from './helpers';
import type {
  CanonicalTokenAccountingEventV2,
  ProviderTokenAccountingAdapter,
  TokenAccountingSession,
  TokenAccountingSessionInput,
  TokenAccountingSessionState
} from './types';

type JsonRecord = Record<string, unknown>;

function countOpenAIStringTokens(value: unknown, model: string | undefined): number {
  return countModelTextTokens(asString(value) ?? '', model);
}

function countOpenAIJsonLikeTokens(value: unknown, model: string | undefined): number {
  if (typeof value === 'string') {
    return countOpenAIStringTokens(value, model);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return 1;
  }

  if (value === null || value === undefined) {
    return 0;
  }

  if (Array.isArray(value)) {
    return value.reduce((total, item) => total + countOpenAIJsonLikeTokens(item, model), 0);
  }

  if (isRecord(value)) {
    return Object.entries(value).reduce((total, [key, item]) => {
      return total + countOpenAIStringTokens(key, model) + countOpenAIJsonLikeTokens(item, model);
    }, 0);
  }

  return countOpenAIStringTokens(String(value), model);
}

function estimateOpenAIImageTokens(part: JsonRecord): number {
  const imageUrl = readRecord(part, 'image_url');
  const detail = asString(part.detail) ?? asString(imageUrl?.detail);
  if (detail === 'low') {
    return 85;
  }

  return 170;
}

function estimateOpenAIToolCallTokens(toolCall: unknown, model: string | undefined): number {
  if (!isRecord(toolCall)) {
    return countOpenAIJsonLikeTokens(toolCall, model);
  }

  const toolFunction = readRecord(toolCall, 'function');
  return 12
    + countOpenAIStringTokens(toolCall.id, model)
    + countOpenAIStringTokens(toolCall.type, model)
    + countOpenAIStringTokens(toolFunction?.name, model)
    + countOpenAIStringTokens(toolFunction?.arguments, model)
    + countOpenAIJsonLikeTokens(toolCall, model);
}

function estimateOpenAIMessageTokens(message: unknown, model: string | undefined): number {
  if (!isRecord(message)) {
    return countOpenAIJsonLikeTokens(message, model);
  }

  const content = message.content;
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  return 4
    + countOpenAIStringTokens(message.role, model)
    + countOpenAIStringTokens(message.name, model)
    + countOpenAIStringTokens(message.tool_call_id, model)
    + estimateOpenAIMessageContent(content, model)
    + toolCalls.reduce((total, toolCall) => total + estimateOpenAIToolCallTokens(toolCall, model), 0);
}

type AnthropicContentBlockState = {
  type?: string;
  start?: JsonRecord;
  text?: string;
  toolUseId?: string;
  toolName?: string;
  toolInputJson?: string;
};

type AnthropicSessionState = TokenAccountingSessionState & {
  anthropicContentBlocks?: Map<number, AnthropicContentBlockState>;
  anthropicEstimatedOutputTokens?: number;
};

function sum(values: Array<number | undefined>): number {
  let total = 0;
  for (const value of values) {
    total += value ?? 0;
  }

  return total;
}

function estimateGeminiInlineDataTokens(inlineData: JsonRecord): number {
  const mimeType = asString(inlineData.mimeType)?.toLowerCase() ?? '';

  if (mimeType.startsWith('image/')) {
    return 224;
  }

  if (mimeType.startsWith('video/')) {
    return 384;
  }

  if (mimeType.startsWith('audio/')) {
    return 128;
  }

  return 96;
}

function estimateGeminiFunctionCallTokens(functionCall: JsonRecord): number {
  return 12
    + countTextTokens(asString(functionCall.name) ?? '')
    + countJsonLikeTokens(functionCall.args);
}

function estimateGeminiFunctionResponseTokens(functionResponse: JsonRecord): number {
  return 12
    + countTextTokens(asString(functionResponse.name) ?? '')
    + countJsonLikeTokens(functionResponse.response);
}

function getAnthropicSessionState(state: TokenAccountingSessionState): AnthropicSessionState {
  const anthropicState = state as AnthropicSessionState;
  if (!anthropicState.anthropicContentBlocks) {
    anthropicState.anthropicContentBlocks = new Map();
  }

  return anthropicState;
}

function tryParseJsonRecord(value: string | undefined): JsonRecord | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function estimateAnthropicContentBlockTokens(block: AnthropicContentBlockState): number {
  if (block.type === 'text') {
    return countTextTokens(block.text ?? '');
  }

  if (block.type === 'tool_use') {
    const parsedInput = tryParseJsonRecord(block.toolInputJson);
    return countJsonLikeTokens({
      type: 'tool_use',
      id: block.toolUseId,
      name: block.toolName,
      input: parsedInput ?? (block.toolInputJson ? { partial_json: block.toolInputJson } : {})
    });
  }

  if (block.start) {
    return countJsonLikeTokens(block.start);
  }

  return 0;
}

function updateAnthropicEstimatedOutput(state: TokenAccountingSessionState): void {
  const anthropicState = getAnthropicSessionState(state);
  anthropicState.anthropicEstimatedOutputTokens = clampTokens(
    Array.from(anthropicState.anthropicContentBlocks?.values() ?? []).reduce((total, block) => {
      return total + estimateAnthropicContentBlockTokens(block);
    }, 0)
  ) ?? 0;

  if (state.outputAuthority === 'partial' || state.outputAuthority === 'official') {
    return;
  }

  state.outputTokens = anthropicState.anthropicEstimatedOutputTokens;
  state.outputAuthority = anthropicState.anthropicEstimatedOutputTokens > 0 ? 'local' : 'none';
}

function buildAnthropicStreamingEvent(
  state: TokenAccountingSessionState,
  overrides: Partial<CanonicalTokenAccountingEventV2> = {}
): CanonicalTokenAccountingEventV2 {
  return createPartialTokenAccountingEvent(state, {
    inputTokens: state.estimatedInputTokens,
    outputTokens: state.outputTokens,
    cacheReadTokens: state.cacheReadTokens,
    cacheWriteTokens: state.cacheWriteTokens,
    inputAuthority: state.estimatedInputAuthority ?? 'none',
    outputAuthority: state.outputAuthority ?? 'none',
    ...overrides
  });
}

function estimateOpenAIMessageContent(content: unknown, model: string | undefined): number {
  if (typeof content === 'string') {
    return countModelTextTokens(content, model);
  }

  if (!Array.isArray(content)) {
    return countOpenAIJsonLikeTokens(content, model);
  }

  return content.reduce((total, part) => {
    if (!isRecord(part)) {
      return total + countOpenAIJsonLikeTokens(part, model);
    }

    const type = asString(part.type);
    if (type === 'text') {
      return total + countOpenAIStringTokens(part.text, model);
    }

    if (type === 'image_url' || type === 'image') {
      return total + estimateOpenAIImageTokens(part);
    }

    return total + countOpenAIJsonLikeTokens(part, model);
  }, 0);
}

function estimateOpenAIInputTokens(body: JsonRecord): number {
  const model = asString(body.model);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const messageTokens = messages.reduce((total, message) => total + estimateOpenAIMessageTokens(message, model), 0);

  const tools = Array.isArray(body.tools) ? body.tools : [];
  const toolTokens = tools.reduce((total, tool) => total + 16 + countOpenAIJsonLikeTokens(tool, model), 0);
  return clampTokens(messageTokens + toolTokens + 8) ?? 0;
}

function estimateOpenAIResponseOutputTokens(body: JsonRecord, model?: string): number {
  const choices = Array.isArray(body.choices) ? body.choices : [];
  return clampTokens(choices.reduce((total, choice) => {
    if (!isRecord(choice)) {
      return total + countOpenAIJsonLikeTokens(choice, model);
    }

    const message = readRecord(choice, 'message');
    const delta = readRecord(choice, 'delta');
    const toolCalls = Array.isArray(message?.tool_calls)
      ? message.tool_calls
      : Array.isArray(delta?.tool_calls)
        ? delta.tool_calls
        : [];

    return total
      + countOpenAIStringTokens(message?.role ?? delta?.role, model)
      + countOpenAIStringTokens(message?.tool_call_id, model)
      + estimateOpenAIMessageContent(message?.content ?? delta?.content, model)
      + toolCalls.reduce((toolTotal, toolCall) => toolTotal + estimateOpenAIToolCallTokens(toolCall, model), 0)
      + (asString(choice.finish_reason) === 'tool_calls' ? 4 : 0);
  }, 0)) ?? 0;
}

function isOpenAIFinalUsageOnlyChunk(chunk: JsonRecord): boolean {
  if (!readRecord(chunk, 'usage')) {
    return false;
  }

  const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
  return choices.length === 0;
}

function estimateAnthropicInputTokens(body: JsonRecord): number {
  const system = asString(body.system) ?? '';
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return clampTokens(
    countTextTokens(system)
      + messages.reduce((total, message) => total + countJsonLikeTokens(message), 0)
      + tools.reduce((total, tool) => total + 16 + countJsonLikeTokens(tool), 0)
      + 8
  ) ?? 0;
}

function estimateAnthropicOutputTokens(body: JsonRecord): number {
  const content = Array.isArray(body.content) ? body.content : [];
  return clampTokens(content.reduce((total, block) => total + countJsonLikeTokens(block), 0)) ?? 0;
}

function estimateGeminiPartTokens(part: unknown): number {
  if (!isRecord(part)) {
    return countJsonLikeTokens(part);
  }

  if (typeof part.text === 'string') {
    return countTextTokens(part.text);
  }

  if (isRecord(part.inlineData)) {
    return estimateGeminiInlineDataTokens(part.inlineData);
  }

  if (isRecord(part.functionCall)) {
    return estimateGeminiFunctionCallTokens(part.functionCall);
  }

  if (isRecord(part.functionResponse)) {
    return estimateGeminiFunctionResponseTokens(part.functionResponse);
  }

  return countJsonLikeTokens(part);
}

function estimateGeminiInputTokens(body: JsonRecord): number {
  const systemInstruction = readRecord(body, 'systemInstruction');
  const systemParts = Array.isArray(systemInstruction?.parts) ? systemInstruction.parts : [];
  const contents = Array.isArray(body.contents) ? body.contents : [];
  return clampTokens(
    systemParts.reduce((total, part) => total + estimateGeminiPartTokens(part), 0)
      + contents.reduce((total, item) => {
        if (!isRecord(item)) {
          return total + countJsonLikeTokens(item);
        }

        const parts = Array.isArray(item.parts) ? item.parts : [];
        return total + parts.reduce((partTotal, part) => partTotal + estimateGeminiPartTokens(part), 0);
      }, 0)
      + 8
  ) ?? 0;
}

function estimateGeminiOutputTokens(body: JsonRecord): number {
  const candidates = Array.isArray(body.candidates) ? body.candidates : [];
  return clampTokens(candidates.reduce((total, candidate) => {
    if (!isRecord(candidate)) {
      return total + countJsonLikeTokens(candidate);
    }

    const content = readRecord(candidate, 'content');
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    return total + parts.reduce((partTotal, part) => partTotal + estimateGeminiPartTokens(part), 0);
  }, 0)) ?? 0;
}

function createOpenAIAdapter(): ProviderTokenAccountingAdapter {
  return {
    provider: 'openai',
    capabilities: getProviderTokenAccountingCapabilities('openai'),
    consumeRequest(state, body) {
      state.requestBody = body;
      state.model = asString(body.model) ?? state.model ?? 'unknown';
      state.estimatedInputTokens = estimateOpenAIInputTokens(body);
      state.estimatedInputAuthority = 'local';
    },
    consumeResponse(state, body) {
      const usage = readRecord(body, 'usage');
      const promptTokens = readNumber(usage, 'prompt_tokens');
      const completionTokens = readNumber(usage, 'completion_tokens');
      const promptDetails = readRecord(usage, 'prompt_tokens_details');
      const cacheReadTokens = readNumber(promptDetails, 'cached_tokens') ?? 0;

      if (promptTokens !== undefined || completionTokens !== undefined) {
        state.finalReceived = true;
        return finalizeTokenAccountingEvent(state, {
          inputTokens: promptTokens ?? state.estimatedInputTokens,
          outputTokens: completionTokens ?? estimateOpenAIResponseOutputTokens(body, state.model),
          cacheReadTokens,
          cacheWriteTokens: 0,
          inputAuthority: promptTokens !== undefined ? 'official' : (state.estimatedInputAuthority ?? 'heuristic'),
          outputAuthority: completionTokens !== undefined ? 'official' : 'heuristic'
        });
      }

      const outputTokens = estimateOpenAIResponseOutputTokens(body, state.model);
      state.outputTokens = outputTokens;
      state.outputAuthority = 'local';
      return finalizeTokenAccountingEvent(state, {
        inputTokens: state.estimatedInputTokens,
        outputTokens,
        inputAuthority: state.estimatedInputAuthority ?? 'heuristic',
        outputAuthority: 'local'
      });
    },
    consumeStreamChunk(state, chunk) {
      const usage = readRecord(chunk, 'usage');
      const promptTokens = readNumber(usage, 'prompt_tokens');
      const completionTokens = readNumber(usage, 'completion_tokens');
      if ((promptTokens !== undefined || completionTokens !== undefined) && isOpenAIFinalUsageOnlyChunk(chunk)) {
        state.finalReceived = true;
        return finalizeTokenAccountingEvent(state, {
          inputTokens: promptTokens ?? state.estimatedInputTokens,
          outputTokens: completionTokens ?? state.outputTokens ?? 0,
          cacheReadTokens: readNumber(readRecord(usage, 'prompt_tokens_details'), 'cached_tokens') ?? 0,
          cacheWriteTokens: 0,
          inputAuthority: promptTokens !== undefined ? 'official' : (state.estimatedInputAuthority ?? 'heuristic'),
          outputAuthority: completionTokens !== undefined ? 'official' : 'partial'
        });
      }

      const incrementalOutput = estimateOpenAIResponseOutputTokens(chunk, state.model);
      if (incrementalOutput > 0) {
        state.outputTokens = (state.outputTokens ?? 0) + incrementalOutput;
        state.outputAuthority = 'partial';
      }

      return createPartialTokenAccountingEvent(state, {
        outputTokens: state.outputTokens,
        inputAuthority: 'none',
        outputAuthority: state.outputTokens !== undefined ? 'partial' : 'none'
      });
    },
    finalizeAbortedStream(state) {
      return finalizeTokenAccountingEvent(state, {
        inputTokens: state.estimatedInputTokens,
        outputTokens: state.outputTokens ?? 0,
        inputAuthority: state.estimatedInputAuthority ?? 'heuristic',
        outputAuthority: state.outputTokens !== undefined ? (state.outputAuthority ?? 'partial') : 'heuristic'
      }, 'aborted');
    }
  };
}

function createAnthropicAdapter(): ProviderTokenAccountingAdapter {
  return {
    provider: 'anthropic',
    capabilities: getProviderTokenAccountingCapabilities('anthropic'),
    consumeRequest(state, body) {
      state.requestBody = body;
      state.model = asString(body.model) ?? state.model ?? 'unknown';
      state.estimatedInputTokens = estimateAnthropicInputTokens(body);
      state.estimatedInputAuthority = 'local';
    },
    consumeResponse(state, body) {
      const usage = readRecord(body, 'usage');
      const inputTokens = readNumber(usage, 'input_tokens');
      const outputTokens = readNumber(usage, 'output_tokens');
      const cacheWriteTokens = readNumber(usage, 'cache_creation_input_tokens') ?? 0;
      const cacheReadTokens = readNumber(usage, 'cache_read_input_tokens') ?? 0;

      if (inputTokens !== undefined || outputTokens !== undefined) {
        state.finalReceived = true;
        return finalizeTokenAccountingEvent(state, {
          inputTokens: inputTokens ?? state.estimatedInputTokens,
          outputTokens: outputTokens ?? estimateAnthropicOutputTokens(body),
          cacheReadTokens,
          cacheWriteTokens,
          inputAuthority: inputTokens !== undefined ? 'official' : (state.estimatedInputAuthority ?? 'heuristic'),
          outputAuthority: outputTokens !== undefined ? 'official' : 'heuristic'
        });
      }

      return finalizeTokenAccountingEvent(state, {
        inputTokens: state.estimatedInputTokens,
        outputTokens: estimateAnthropicOutputTokens(body),
        inputAuthority: state.estimatedInputAuthority ?? 'heuristic',
        outputAuthority: 'local'
      });
    },
    consumeStreamChunk(state, chunk) {
      const anthropicState = getAnthropicSessionState(state);
      const type = asString(chunk.type);
      if (type === 'message_start') {
        const message = readRecord(chunk, 'message');
        const usage = readRecord(message, 'usage');
        state.model = asString(message?.model) ?? state.model ?? 'unknown';
        state.estimatedInputTokens = readNumber(usage, 'input_tokens') ?? state.estimatedInputTokens;
        state.estimatedInputAuthority = state.estimatedInputTokens !== undefined ? 'official' : (state.estimatedInputAuthority ?? 'local');
        state.cacheWriteTokens = readNumber(usage, 'cache_creation_input_tokens') ?? 0;
        state.cacheReadTokens = readNumber(usage, 'cache_read_input_tokens') ?? 0;
        state.outputTokens = readNumber(usage, 'output_tokens') ?? 0;
        state.outputAuthority = 'none';
        anthropicState.anthropicEstimatedOutputTokens = 0;
        anthropicState.anthropicContentBlocks?.clear();
        return buildAnthropicStreamingEvent(state, {
          inputAuthority: state.estimatedInputAuthority ?? 'none',
          outputAuthority: 'none'
        });
      }

      if (type === 'content_block_start') {
        const index = readNumber(chunk, 'index') ?? 0;
        const contentBlock = readRecord(chunk, 'content_block');
        anthropicState.anthropicContentBlocks?.set(index, {
          type: asString(contentBlock?.type),
          start: contentBlock,
          text: asString(contentBlock?.text) ?? '',
          toolUseId: asString(contentBlock?.id),
          toolName: asString(contentBlock?.name),
          toolInputJson: ''
        });
        updateAnthropicEstimatedOutput(state);
        return buildAnthropicStreamingEvent(state);
      }

      if (type === 'content_block_delta') {
        const index = readNumber(chunk, 'index') ?? 0;
        const delta = readRecord(chunk, 'delta');
        const block = anthropicState.anthropicContentBlocks?.get(index) ?? {};
        const deltaType = asString(delta?.type);

        if (deltaType === 'text_delta') {
          block.type = block.type ?? 'text';
          block.text = `${block.text ?? ''}${asString(delta?.text) ?? ''}`;
        }

        if (deltaType === 'input_json_delta') {
          block.type = block.type ?? 'tool_use';
          block.toolInputJson = `${block.toolInputJson ?? ''}${asString(delta?.partial_json) ?? ''}`;
        }

        anthropicState.anthropicContentBlocks?.set(index, block);
        updateAnthropicEstimatedOutput(state);
        return buildAnthropicStreamingEvent(state);
      }

      if (type === 'content_block_stop') {
        updateAnthropicEstimatedOutput(state);
        return buildAnthropicStreamingEvent(state);
      }

      if (type === 'message_delta') {
        const usage = readRecord(chunk, 'usage');
        const outputTokens = readNumber(usage, 'output_tokens');
        if (outputTokens !== undefined) {
          state.outputTokens = outputTokens;
          state.outputAuthority = 'partial';
        }

        return buildAnthropicStreamingEvent(state, {
          outputAuthority: state.outputTokens !== undefined ? 'partial' : 'none'
        });
      }

      if (type === 'message_stop') {
        if (state.finalReceived) {
          return null;
        }

        state.finalReceived = true;
        return finalizeTokenAccountingEvent(state, {
          inputTokens: state.estimatedInputTokens,
          outputTokens: state.outputTokens,
          cacheReadTokens: state.cacheReadTokens ?? 0,
          cacheWriteTokens: state.cacheWriteTokens ?? 0,
          inputAuthority: state.estimatedInputAuthority ?? 'none',
          outputAuthority: state.outputAuthority === 'partial' || state.outputAuthority === 'official'
            ? 'official'
            : (state.outputAuthority ?? 'none')
        });
      }

      return null;
    },
    finalizeAbortedStream(state) {
      return finalizeTokenAccountingEvent(state, {
        inputTokens: state.estimatedInputTokens,
        outputTokens: state.outputTokens,
        cacheReadTokens: state.cacheReadTokens ?? 0,
        cacheWriteTokens: state.cacheWriteTokens ?? 0,
        inputAuthority: state.estimatedInputAuthority ?? 'heuristic',
        outputAuthority: state.outputTokens !== undefined ? (state.outputAuthority ?? 'partial') : 'none'
      }, 'aborted');
    }
  };
}

function createGeminiAdapter(): ProviderTokenAccountingAdapter {
  return {
    provider: 'gemini',
    capabilities: getProviderTokenAccountingCapabilities('gemini'),
    consumeRequest(state, body) {
      state.requestBody = body;
      state.model = asString(body.model) ?? state.model ?? 'unknown';
      state.estimatedInputTokens = estimateGeminiInputTokens(body);
      state.estimatedInputAuthority = 'local';
    },
    consumeResponse(state, body) {
      const usageMetadata = readRecord(body, 'usageMetadata');
      const promptTokenCount = readNumber(usageMetadata, 'promptTokenCount');
      const candidatesTokenCount = readNumber(usageMetadata, 'candidatesTokenCount');
      const cachedContentTokenCount = readNumber(usageMetadata, 'cachedContentTokenCount') ?? 0;

      if (promptTokenCount !== undefined || candidatesTokenCount !== undefined) {
        state.finalReceived = true;
        return finalizeTokenAccountingEvent(state, {
          inputTokens: promptTokenCount ?? state.estimatedInputTokens,
          outputTokens: candidatesTokenCount ?? estimateGeminiOutputTokens(body),
          cacheReadTokens: cachedContentTokenCount,
          cacheWriteTokens: 0,
          inputAuthority: promptTokenCount !== undefined ? 'official' : (state.estimatedInputAuthority ?? 'heuristic'),
          outputAuthority: candidatesTokenCount !== undefined ? 'official' : 'heuristic'
        });
      }

      const outputTokens = estimateGeminiOutputTokens(body);
      state.outputTokens = outputTokens;
      state.outputAuthority = 'local';
      return finalizeTokenAccountingEvent(state, {
        inputTokens: state.estimatedInputTokens,
        outputTokens,
        inputAuthority: state.estimatedInputAuthority ?? 'heuristic',
        outputAuthority: 'local'
      });
    },
    consumeStreamChunk(state, chunk) {
      const usageMetadata = readRecord(chunk, 'usageMetadata');
      const promptTokenCount = readNumber(usageMetadata, 'promptTokenCount');
      const candidatesTokenCount = readNumber(usageMetadata, 'candidatesTokenCount');
      if (promptTokenCount !== undefined || candidatesTokenCount !== undefined) {
        state.finalReceived = true;
        return finalizeTokenAccountingEvent(state, {
          inputTokens: promptTokenCount ?? state.estimatedInputTokens,
          outputTokens: candidatesTokenCount ?? state.outputTokens,
          cacheReadTokens: readNumber(usageMetadata, 'cachedContentTokenCount') ?? 0,
          cacheWriteTokens: 0,
          inputAuthority: promptTokenCount !== undefined ? 'official' : (state.estimatedInputAuthority ?? 'heuristic'),
          outputAuthority: candidatesTokenCount !== undefined ? 'official' : 'partial'
        });
      }

      const incrementalOutput = estimateGeminiOutputTokens(chunk);
      if (incrementalOutput > 0) {
        state.outputTokens = sum([state.outputTokens, incrementalOutput]);
        state.outputAuthority = 'partial';
      }

      return createPartialTokenAccountingEvent(state, {
        inputTokens: state.estimatedInputTokens,
        outputTokens: state.outputTokens,
        inputAuthority: state.estimatedInputAuthority ?? 'heuristic',
        outputAuthority: state.outputTokens !== undefined ? 'partial' : 'none'
      });
    },
    finalizeAbortedStream(state) {
      return finalizeTokenAccountingEvent(state, {
        inputTokens: state.estimatedInputTokens,
        outputTokens: state.outputTokens,
        inputAuthority: state.estimatedInputAuthority ?? 'heuristic',
        outputAuthority: state.outputTokens !== undefined ? 'local' : 'heuristic'
      }, 'aborted');
    }
  };
}

const PROVIDER_ADAPTERS = {
  openai: createOpenAIAdapter(),
  anthropic: createAnthropicAdapter(),
  gemini: createGeminiAdapter()
} as const satisfies Record<string, ProviderTokenAccountingAdapter>;

function normalizeProvider(provider: LLMProvider): keyof typeof PROVIDER_ADAPTERS {
  return String(provider).trim().toLowerCase() as keyof typeof PROVIDER_ADAPTERS;
}

function getProviderAdapter(provider: LLMProvider): ProviderTokenAccountingAdapter {
  const adapter = PROVIDER_ADAPTERS[normalizeProvider(provider)];
  if (!adapter) {
    throw new Error(`Unsupported token accounting provider: ${provider}`);
  }

  return adapter;
}

export function createTokenAccountingSession(input: TokenAccountingSessionInput): TokenAccountingSession {
  const adapter = getProviderAdapter(input.provider);
  const state: TokenAccountingSessionState = {
    provider: adapter.provider,
    routeId: input.routeId,
    upstreamId: input.upstreamId,
    requestId: input.requestId,
    attemptId: input.attemptId,
    streaming: input.streaming,
    model: input.model,
    finalReceived: false
  };

  return {
    consumeRequest({ body }) {
      adapter.consumeRequest(state, body);
    },
    consumeResponse({ body }): CanonicalTokenAccountingEventV2 {
      return adapter.consumeResponse(state, body);
    },
    consumeStreamChunk({ chunk }): CanonicalTokenAccountingEventV2 | null {
      return adapter.consumeStreamChunk(state, chunk);
    },
    finalizeAbortedStream(): CanonicalTokenAccountingEventV2 {
      return adapter.finalizeAbortedStream(state);
    }
  };
}
