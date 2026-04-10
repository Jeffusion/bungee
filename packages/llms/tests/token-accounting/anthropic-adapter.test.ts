import { describe, expect, test } from 'bun:test';
import * as llmsPluginApi from '@jeffusion/bungee-llms/plugin-api';

type TokenAuthority = 'official' | 'local' | 'heuristic' | 'partial' | 'none';
type TokenAccountingOutcome = 'completed' | 'aborted' | 'failed';

type CanonicalAnthropicAccountingEvent = {
  requestId: string;
  attemptId: string;
  routeId: string;
  upstreamId: string;
  provider: 'anthropic';
  model: string;
  streaming: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  inputAuthority: TokenAuthority;
  outputAuthority: TokenAuthority;
  final: boolean;
  outcome: TokenAccountingOutcome;
  countedAt: string;
};

type TokenAccountingSession = {
  consumeRequest(input: { body: Record<string, unknown> }): void;
  consumeResponse(input: { body: Record<string, unknown> }): CanonicalAnthropicAccountingEvent;
  consumeStreamChunk(input: { chunk: Record<string, unknown> }): CanonicalAnthropicAccountingEvent | null;
  finalizeAbortedStream(): CanonicalAnthropicAccountingEvent;
};

type CreateTokenAccountingSession = (input: {
  provider: 'anthropic';
  routeId: string;
  upstreamId: string;
  requestId: string;
  attemptId: string;
  streaming: boolean;
}) => TokenAccountingSession;

type ProviderTokenAccountingCapabilities = {
  provider: 'anthropic';
  supportsOfficialResponseUsage: true;
  supportsStreamingResponseUsage: true;
  supportsDedicatedCountEndpoint: true;
  supportsLocalTokenizer: true;
  supportsHeuristicFallback: true;
  dedicatedCountEndpoint: {
    supported: true;
    mode: 'input_estimate_only';
    livePathAuthority: false;
    endpoint: '/v1/messages/count_tokens';
  };
};

type GetProviderTokenAccountingCapabilities = (
  provider: 'anthropic'
) => ProviderTokenAccountingCapabilities;

function getCreateTokenAccountingSession(): CreateTokenAccountingSession {
  if (!Reflect.has(llmsPluginApi, 'createTokenAccountingSession')) {
    throw new Error(
      'Stable facade @jeffusion/bungee-llms/plugin-api must export createTokenAccountingSession() for Anthropic token accounting sessions.'
    );
  }

  return Reflect.get(
    llmsPluginApi,
    'createTokenAccountingSession'
  ) as CreateTokenAccountingSession;
}

function getProviderTokenAccountingCapabilities(): GetProviderTokenAccountingCapabilities {
  if (!Reflect.has(llmsPluginApi, 'getProviderTokenAccountingCapabilities')) {
    throw new Error(
      'Stable facade @jeffusion/bungee-llms/plugin-api must export getProviderTokenAccountingCapabilities() for Anthropic token accounting capability lookup.'
    );
  }

  return Reflect.get(
    llmsPluginApi,
    'getProviderTokenAccountingCapabilities'
  ) as GetProviderTokenAccountingCapabilities;
}

function createAnthropicSession(streaming: boolean): TokenAccountingSession {
  return getCreateTokenAccountingSession()({
    provider: 'anthropic',
    routeId: 'anthropic-route',
    upstreamId: 'anthropic-primary',
    requestId: streaming ? 'req_anthropic_stream_1' : 'req_anthropic_sync_1',
    attemptId: 'attempt_anthropic_1',
    streaming
  });
}

function createAnthropicRequestBody(): Record<string, unknown> {
  return {
    model: 'claude-3-7-sonnet-20250219',
    system: 'You are concise.',
    messages: [
      {
        role: 'user',
        content: 'Summarize the weather in one sentence and call the weather tool if needed.'
      }
    ],
    tools: [
      {
        name: 'get_weather',
        description: 'Look up the weather for a city.',
        input_schema: {
          type: 'object',
          properties: {
            location: { type: 'string' }
          },
          required: ['location']
        }
      }
    ],
    stream: true
  };
}

function createMessageStartChunk(): Record<string, unknown> {
  return {
    type: 'message_start',
    message: {
      id: 'msg_cache_start',
      type: 'message',
      role: 'assistant',
      model: 'claude-3-7-sonnet-20250219',
      usage: {
        input_tokens: 12,
        output_tokens: 0,
        cache_creation_input_tokens: 7,
        cache_read_input_tokens: 5
      }
    }
  };
}

function expectCanonicalEventShape(
  event: CanonicalAnthropicAccountingEvent | null,
  expected: Omit<CanonicalAnthropicAccountingEvent, 'countedAt'>
): void {
  expect(event).toEqual({
    ...expected,
    countedAt: expect.any(String)
  });
}

describe('Anthropic token accounting facade contract', () => {
  test('exposes Anthropic capabilities through the shared plugin-api facade', () => {
    const getCapabilities = getProviderTokenAccountingCapabilities();

    expect(getCapabilities('anthropic')).toEqual({
      provider: 'anthropic',
      supportsOfficialResponseUsage: true,
      supportsStreamingResponseUsage: true,
      supportsDedicatedCountEndpoint: true,
      supportsLocalTokenizer: true,
      supportsHeuristicFallback: true,
      dedicatedCountEndpoint: {
        supported: true,
        mode: 'input_estimate_only',
        livePathAuthority: false,
        endpoint: '/v1/messages/count_tokens'
      }
    });
  });

  test('maps message_start into the task-1 canonical event fields and preserves cache read/write tokens separately', () => {
    const session = createAnthropicSession(true);
    session.consumeRequest({ body: createAnthropicRequestBody() });

    const snapshot = session.consumeStreamChunk({
      chunk: createMessageStartChunk()
    });

    expectCanonicalEventShape(snapshot, {
      requestId: 'req_anthropic_stream_1',
      attemptId: 'attempt_anthropic_1',
      routeId: 'anthropic-route',
      upstreamId: 'anthropic-primary',
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-20250219',
      streaming: true,
      inputTokens: 12,
      outputTokens: 0,
      cacheReadTokens: 5,
      cacheWriteTokens: 7,
      inputAuthority: 'official',
      outputAuthority: 'none',
      final: false,
      outcome: 'completed'
    });
  });

  test('treats message_delta usage as cumulative and reaches a final canonical event only at message_stop', () => {
    const session = createAnthropicSession(true);
    session.consumeRequest({ body: createAnthropicRequestBody() });

    session.consumeStreamChunk({ chunk: createMessageStartChunk() });
    session.consumeStreamChunk({
      chunk: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'toolu_weather_1',
          name: 'get_weather'
        }
      }
    });
    session.consumeStreamChunk({
      chunk: {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"location":"'
        }
      }
    });
    session.consumeStreamChunk({
      chunk: {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: 'NYC"}'
        }
      }
    });
    session.consumeStreamChunk({
      chunk: {
        type: 'content_block_stop',
        index: 0
      }
    });

    const firstDelta = session.consumeStreamChunk({
      chunk: {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 4 }
      }
    });
    const secondDelta = session.consumeStreamChunk({
      chunk: {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { output_tokens: 9 }
      }
    });
    const finalEvent = session.consumeStreamChunk({
      chunk: {
        type: 'message_stop'
      }
    });

    expectCanonicalEventShape(firstDelta, {
      requestId: 'req_anthropic_stream_1',
      attemptId: 'attempt_anthropic_1',
      routeId: 'anthropic-route',
      upstreamId: 'anthropic-primary',
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-20250219',
      streaming: true,
      inputTokens: 12,
      outputTokens: 4,
      cacheReadTokens: 5,
      cacheWriteTokens: 7,
      inputAuthority: 'official',
      outputAuthority: 'partial',
      final: false,
      outcome: 'completed'
    });
    expectCanonicalEventShape(secondDelta, {
      requestId: 'req_anthropic_stream_1',
      attemptId: 'attempt_anthropic_1',
      routeId: 'anthropic-route',
      upstreamId: 'anthropic-primary',
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-20250219',
      streaming: true,
      inputTokens: 12,
      outputTokens: 9,
      cacheReadTokens: 5,
      cacheWriteTokens: 7,
      inputAuthority: 'official',
      outputAuthority: 'partial',
      final: false,
      outcome: 'completed'
    });
    expect(secondDelta?.outputTokens).toBe(9);
    expect(secondDelta?.outputTokens).not.toBe(13);
    expectCanonicalEventShape(finalEvent, {
      requestId: 'req_anthropic_stream_1',
      attemptId: 'attempt_anthropic_1',
      routeId: 'anthropic-route',
      upstreamId: 'anthropic-primary',
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-20250219',
      streaming: true,
      inputTokens: 12,
      outputTokens: 9,
      cacheReadTokens: 5,
      cacheWriteTokens: 7,
      inputAuthority: 'official',
      outputAuthority: 'official',
      final: true,
      outcome: 'completed'
    });
  });

  test('finalizes aborted streams with final=false and outcome=aborted while keeping output authority non-official', () => {
    const session = createAnthropicSession(true);
    session.consumeRequest({ body: createAnthropicRequestBody() });
    session.consumeStreamChunk({ chunk: createMessageStartChunk() });
    session.consumeStreamChunk({
      chunk: {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'text',
          text: ''
        }
      }
    });
    session.consumeStreamChunk({
      chunk: {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: 'partial answer'
        }
      }
    });
    session.consumeStreamChunk({
      chunk: {
        type: 'content_block_stop',
        index: 0
      }
    });
    session.consumeStreamChunk({
      chunk: {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 4 }
      }
    });

    const abortedEvent = session.finalizeAbortedStream();

    expectCanonicalEventShape(abortedEvent, {
      requestId: 'req_anthropic_stream_1',
      attemptId: 'attempt_anthropic_1',
      routeId: 'anthropic-route',
      upstreamId: 'anthropic-primary',
      provider: 'anthropic',
      model: 'claude-3-7-sonnet-20250219',
      streaming: true,
      inputTokens: 12,
      outputTokens: 4,
      cacheReadTokens: 5,
      cacheWriteTokens: 7,
      inputAuthority: 'official',
      outputAuthority: 'partial',
      final: false,
      outcome: 'aborted'
    });
    expect(abortedEvent.outputAuthority).not.toBe('official');
  });
});
