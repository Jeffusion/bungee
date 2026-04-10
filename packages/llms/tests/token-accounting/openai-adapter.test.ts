import { describe, expect, test } from 'bun:test';
import * as llmsPluginApi from '@jeffusion/bungee-llms/plugin-api';

type TokenAccountingAuthority = 'official' | 'local' | 'heuristic' | 'partial' | 'none';
type TokenAccountingOutcome = 'completed' | 'aborted' | 'failed';

type CanonicalTokenAccountingEventV2 = {
  requestId: string;
  attemptId: string;
  routeId: string;
  upstreamId: string;
  provider: 'openai';
  model: string;
  streaming: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  inputAuthority: TokenAccountingAuthority;
  outputAuthority: TokenAccountingAuthority;
  final: boolean;
  outcome: TokenAccountingOutcome;
  countedAt: string;
};

type AssertCanonicalTokenAccountingEventV2 = (
  event: unknown
) => asserts event is CanonicalTokenAccountingEventV2;

type TokenAccountingSession = {
  consumeRequest(input: { body: Record<string, unknown> }): void;
  consumeResponse(input: { body: Record<string, unknown> }): CanonicalTokenAccountingEventV2;
  consumeStreamChunk(input: { chunk: Record<string, unknown> }): CanonicalTokenAccountingEventV2 | null;
  finalizeAbortedStream(): CanonicalTokenAccountingEventV2;
};

type CreateTokenAccountingSession = (input: {
  provider: 'openai';
  model: string;
  routeId: string;
  upstreamId: string;
  requestId: string;
  attemptId: string;
  streaming: boolean;
}) => TokenAccountingSession;

type ProviderTokenAccountingCapabilities = {
  provider: 'openai';
  supportsOfficialResponseUsage: boolean;
  supportsStreamingResponseUsage: boolean;
  supportsDedicatedCountEndpoint: boolean;
  supportsLocalTokenizer: boolean;
  supportsHeuristicFallback: boolean;
  dedicatedCountEndpoint: {
    supported: boolean;
    mode: 'input_estimate_only';
    defaultEnabled: false;
    endpoint: '/responses/input_tokens';
    livePathAuthority: false;
  };
};

type GetProviderTokenAccountingCapabilities = (
  provider: 'openai'
) => ProviderTokenAccountingCapabilities;

function getAssertCanonicalTokenAccountingEventV2(): AssertCanonicalTokenAccountingEventV2 {
  if (!Reflect.has(llmsPluginApi, 'assertCanonicalTokenAccountingEventV2')) {
    throw new Error(
      'Stable facade @jeffusion/bungee-llms/plugin-api must export assertCanonicalTokenAccountingEventV2() for canonical v2 OpenAI accounting assertions.'
    );
  }

  return Reflect.get(
    llmsPluginApi,
    'assertCanonicalTokenAccountingEventV2'
  ) as AssertCanonicalTokenAccountingEventV2;
}

function getCreateTokenAccountingSession(): CreateTokenAccountingSession {
  if (!Reflect.has(llmsPluginApi, 'createTokenAccountingSession')) {
    throw new Error(
      'Stable facade @jeffusion/bungee-llms/plugin-api must export createTokenAccountingSession() for shared OpenAI token accounting sessions.'
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
      'Stable facade @jeffusion/bungee-llms/plugin-api must export getProviderTokenAccountingCapabilities() for OpenAI capability lookup.'
    );
  }

  return Reflect.get(
    llmsPluginApi,
    'getProviderTokenAccountingCapabilities'
  ) as GetProviderTokenAccountingCapabilities;
}

function createOpenAISession(streaming: boolean): TokenAccountingSession {
  return getCreateTokenAccountingSession()({
    provider: 'openai',
    model: 'gpt-4o-mini',
    routeId: 'openai-route',
    upstreamId: 'openai-primary',
    requestId: streaming ? 'req_openai_stream_1' : 'req_openai_sync_1',
    attemptId: streaming ? 'attempt_openai_stream_1' : 'attempt_openai_sync_1',
    streaming
  });
}

function expectCanonicalEvent(event: unknown): CanonicalTokenAccountingEventV2 {
  const assertCanonicalTokenAccountingEventV2: AssertCanonicalTokenAccountingEventV2 =
    getAssertCanonicalTokenAccountingEventV2();
  const candidate: unknown = event;
  assertCanonicalTokenAccountingEventV2(candidate);
  return candidate as CanonicalTokenAccountingEventV2;
}

function createTextOnlyRequestBody(): Record<string, unknown> {
  return {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: 'Summarize the attached item in one sentence.'
      }
    ]
  };
}

function createRichRequestBody(): Record<string, unknown> {
  return {
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Describe what is in this image before calling any tools.'
          },
          {
            type: 'image_url',
            image_url: {
              url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Wdl8AAAAASUVORK5CYII='
            }
          }
        ]
      }
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'lookup_weather',
          description: 'Look up current weather for a place.',
          parameters: {
            type: 'object',
            properties: {
              location: { type: 'string' },
              unit: { type: 'string', enum: ['c', 'f'] }
            },
            required: ['location']
          }
        }
      }
    ]
  };
}

function createOpenAIOfficialUsageResponse(): Record<string, unknown> {
  return {
    id: 'chatcmpl_official_usage',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'A concise summary.'
        },
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: 18,
      completion_tokens: 7,
      total_tokens: 25,
      prompt_tokens_details: {
        cached_tokens: 11
      }
    }
  };
}

function createOpenAIMixedAuthorityResponse(): Record<string, unknown> {
  return {
    id: 'chatcmpl_mixed_authority',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'Authority can differ.'
        },
        finish_reason: 'stop'
      }
    ],
    usage: {
      completion_tokens: 6,
      total_tokens: 20,
      prompt_tokens_details: {
        cached_tokens: 5
      }
    }
  };
}

function createOpenAIToolCallResponse(): Record<string, unknown> {
  return {
    id: 'chatcmpl_tool_calls',
    object: 'chat.completion',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_lookup_weather_1',
              type: 'function',
              function: {
                name: 'lookup_weather',
                arguments: '{"location":"Paris","unit":"c"}'
              }
            }
          ]
        },
        finish_reason: 'tool_calls'
      },
      {
        index: 1,
        message: {
          role: 'tool',
          tool_call_id: 'call_lookup_weather_1',
          content: '{"temp":19,"condition":"clear"}'
        }
      }
    ]
  };
}

function expectLocalOrHeuristic(authority: TokenAccountingAuthority): void {
  expect(['local', 'heuristic']).toContain(authority);
}

describe('OpenAI token accounting facade contract', () => {
  test('exposes OpenAI capabilities and keeps dedicated count endpoint disabled in the default live path', () => {
    const getCapabilities = getProviderTokenAccountingCapabilities();

    expect(getCapabilities('openai')).toEqual({
      provider: 'openai',
      supportsOfficialResponseUsage: true,
      supportsStreamingResponseUsage: true,
      supportsDedicatedCountEndpoint: true,
      supportsLocalTokenizer: true,
      supportsHeuristicFallback: true,
      dedicatedCountEndpoint: {
        supported: true,
        mode: 'input_estimate_only',
        defaultEnabled: false,
        endpoint: '/responses/input_tokens',
        livePathAuthority: false
      }
    });
  });

  test('maps non-stream official usage into canonical final fields and preserves cached prompt tokens as cacheReadTokens', () => {
    const session = createOpenAISession(false);
    session.consumeRequest({ body: createTextOnlyRequestBody() });

    const event = expectCanonicalEvent(
      session.consumeResponse({ body: createOpenAIOfficialUsageResponse() })
    );

    expect(event).toEqual(
      expect.objectContaining({
        requestId: 'req_openai_sync_1',
        attemptId: 'attempt_openai_sync_1',
        routeId: 'openai-route',
        upstreamId: 'openai-primary',
        provider: 'openai',
        model: 'gpt-4o-mini',
        streaming: false,
        inputTokens: 18,
        outputTokens: 7,
        cacheReadTokens: 11,
        inputAuthority: 'official',
        outputAuthority: 'official',
        final: true,
        outcome: 'completed'
      })
    );
    expect(event.cacheWriteTokens ?? 0).toBe(0);
    expect(event.countedAt).toEqual(expect.any(String));
  });

  test('allows inputAuthority and outputAuthority to differ when only completion usage is authoritative', () => {
    const session = createOpenAISession(false);
    session.consumeRequest({ body: createTextOnlyRequestBody() });

    const event = expectCanonicalEvent(
      session.consumeResponse({ body: createOpenAIMixedAuthorityResponse() })
    );

    expect(event.requestId).toBe('req_openai_sync_1');
    expect(event.attemptId).toBe('attempt_openai_sync_1');
    expect(event.outputTokens).toBe(6);
    expect(event.cacheReadTokens).toBe(5);
    expect(['local', 'heuristic']).toContain(event.inputAuthority);
    expect(event.outputAuthority).toBe('official');
    expect(event.inputAuthority).not.toBe(event.outputAuthority);
    expect(event.final).toBe(true);
    expect(event.outcome).toBe('completed');
    expect(event.countedAt).toEqual(expect.any(String));
  });

  test('uses local fallback for multimodal input and tool-call payloads instead of text-only heuristics', () => {
    const plainSession = createOpenAISession(false);
    plainSession.consumeRequest({ body: createTextOnlyRequestBody() });
    const plainEvent = expectCanonicalEvent(
      plainSession.consumeResponse({
        body: {
          id: 'chatcmpl_plain_text',
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: 'done'
              },
              finish_reason: 'stop'
            }
          ]
        }
      })
    );

    const richSession = createOpenAISession(false);
    richSession.consumeRequest({ body: createRichRequestBody() });
    const richEvent = expectCanonicalEvent(
      richSession.consumeResponse({ body: createOpenAIToolCallResponse() })
    );

    expectLocalOrHeuristic(plainEvent.inputAuthority);
    expectLocalOrHeuristic(plainEvent.outputAuthority);
    expectLocalOrHeuristic(richEvent.inputAuthority);
    expectLocalOrHeuristic(richEvent.outputAuthority);
    expect(richEvent.inputTokens).toBeGreaterThan(plainEvent.inputTokens ?? 0);
    expect(richEvent.outputTokens).toBeGreaterThan(plainEvent.outputTokens ?? 0);
    expect(richEvent.final).toBe(true);
    expect(richEvent.outcome).toBe('completed');
  });

  test('treats only the final usage-only include_usage chunk as authoritative stream usage', () => {
    const session = createOpenAISession(true);
    session.consumeRequest({
      body: {
        ...createTextOnlyRequestBody(),
        stream: true,
        stream_options: {
          include_usage: true
        }
      }
    });

    const firstChunk = expectCanonicalEvent(
      session.consumeStreamChunk({
        chunk: {
          id: 'chatcmpl_stream_1',
          object: 'chat.completion.chunk',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: 'Hello'
              },
              finish_reason: null
            }
          ]
        }
      })
    );

    expect(firstChunk).toEqual(
      expect.objectContaining({
        requestId: 'req_openai_stream_1',
        attemptId: 'attempt_openai_stream_1',
        routeId: 'openai-route',
        upstreamId: 'openai-primary',
        provider: 'openai',
        model: 'gpt-4o-mini',
        streaming: true,
        final: false,
        outcome: 'completed'
      })
    );
    expect(firstChunk.inputTokens).toBeUndefined();
    expect(firstChunk.cacheReadTokens).toBeUndefined();
    expect(firstChunk.inputAuthority).not.toBe('official');
    expect(firstChunk.outputAuthority).not.toBe('official');

    const finalChunk = expectCanonicalEvent(
      session.consumeStreamChunk({
        chunk: {
          id: 'chatcmpl_stream_1',
          object: 'chat.completion.chunk',
          choices: [],
          usage: {
            prompt_tokens: 31,
            completion_tokens: 9,
            total_tokens: 40,
            prompt_tokens_details: {
              cached_tokens: 4
            }
          }
        }
      })
    );

    expect(finalChunk).toEqual(
      expect.objectContaining({
        requestId: 'req_openai_stream_1',
        attemptId: 'attempt_openai_stream_1',
        routeId: 'openai-route',
        upstreamId: 'openai-primary',
        provider: 'openai',
        model: 'gpt-4o-mini',
        streaming: true,
        inputTokens: 31,
        outputTokens: 9,
        cacheReadTokens: 4,
        inputAuthority: 'official',
        outputAuthority: 'official',
        final: true,
        outcome: 'completed'
      })
    );
    expect(finalChunk.cacheWriteTokens ?? 0).toBe(0);
    expect(finalChunk.countedAt).toEqual(expect.any(String));
  });

  test('models an aborted stream with final false and outcome aborted when the final usage-only chunk never arrives', () => {
    const session = createOpenAISession(true);
    session.consumeRequest({
      body: {
        ...createRichRequestBody(),
        stream: true,
        stream_options: {
          include_usage: true
        }
      }
    });

    const chunkBeforeAbort = expectCanonicalEvent(
      session.consumeStreamChunk({
        chunk: {
          id: 'chatcmpl_stream_abort',
          object: 'chat.completion.chunk',
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: 'Partial answer'
              },
              finish_reason: null
            }
          ]
        }
      })
    );

    expect(chunkBeforeAbort.final).toBe(false);
    expect(chunkBeforeAbort.outputAuthority).not.toBe('official');

    session.consumeStreamChunk({
      chunk: {
        id: 'chatcmpl_stream_abort',
        object: 'chat.completion.chunk',
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  id: 'call_lookup_weather_2',
                  type: 'function',
                  function: {
                    name: 'lookup_weather',
                    arguments: '{"location":"Tokyo"}'
                  }
                }
              ]
            },
            finish_reason: null
          }
        ]
      }
    });

    const abortedSettlement = expectCanonicalEvent(session.finalizeAbortedStream());

    expect(abortedSettlement).toEqual(
      expect.objectContaining({
        requestId: 'req_openai_stream_1',
        attemptId: 'attempt_openai_stream_1',
        routeId: 'openai-route',
        upstreamId: 'openai-primary',
        provider: 'openai',
        model: 'gpt-4o-mini',
        streaming: true,
        final: false,
        outcome: 'aborted'
      })
    );
    expect(abortedSettlement.inputTokens).toBeGreaterThan(0);
    expect(abortedSettlement.outputTokens).toBeGreaterThan(0);
    expect(['local', 'heuristic', 'partial']).toContain(abortedSettlement.inputAuthority);
    expect(['local', 'heuristic', 'partial']).toContain(abortedSettlement.outputAuthority);
    expect(abortedSettlement.outputAuthority).not.toBe('official');
    expect(abortedSettlement.countedAt).toEqual(expect.any(String));
  });
});
