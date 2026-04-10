import { describe, expect, test } from 'bun:test';
import * as llmsPluginApi from '@jeffusion/bungee-llms/plugin-api';

type TokenAccountingAuthority = 'official' | 'local' | 'heuristic' | 'partial' | 'none';

type CanonicalTokenAccountingEventV2 = {
  requestId: string;
  attemptId: string;
  routeId: string;
  upstreamId: string;
  provider: 'gemini';
  model: string;
  streaming: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  inputAuthority: TokenAccountingAuthority;
  outputAuthority: TokenAccountingAuthority;
  final: boolean;
  outcome: string;
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
  provider: 'gemini';
  model: string;
  routeId: string;
  upstreamId: string;
  requestId: string;
  attemptId: string;
  streaming: boolean;
}) => TokenAccountingSession;

type ProviderTokenAccountingCapabilities = {
  provider: 'gemini';
  supportsOfficialResponseUsage: boolean;
  supportsStreamingResponseUsage: boolean;
  supportsDedicatedCountEndpoint: boolean;
  supportsLocalTokenizer: boolean;
  supportsHeuristicFallback: boolean;
  countTokens: {
    supported: boolean;
    mode: 'input_estimate_only';
    livePathAuthority: false;
  };
};

type GetProviderTokenAccountingCapabilities = (
  provider: 'gemini'
) => ProviderTokenAccountingCapabilities;

function getAssertCanonicalTokenAccountingEventV2(): AssertCanonicalTokenAccountingEventV2 {
  if (!Reflect.has(llmsPluginApi, 'assertCanonicalTokenAccountingEventV2')) {
    throw new Error(
      'Stable facade @jeffusion/bungee-llms/plugin-api must export assertCanonicalTokenAccountingEventV2() for canonical v2 Gemini accounting assertions.'
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
      'Stable facade @jeffusion/bungee-llms/plugin-api must export createTokenAccountingSession() for shared Gemini token accounting sessions.'
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
      'Stable facade @jeffusion/bungee-llms/plugin-api must export getProviderTokenAccountingCapabilities() for Gemini capability lookup.'
    );
  }

  return Reflect.get(
    llmsPluginApi,
    'getProviderTokenAccountingCapabilities'
  ) as GetProviderTokenAccountingCapabilities;
}

function createGeminiSession(streaming: boolean): TokenAccountingSession {
  return getCreateTokenAccountingSession()({
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    routeId: 'gemini-route',
    upstreamId: 'gemini-primary',
    requestId: streaming ? 'req_gemini_stream_1' : 'req_gemini_sync_1',
    attemptId: streaming ? 'attempt_gemini_stream_1' : 'attempt_gemini_sync_1',
    streaming
  });
}

function createGeminiRequestBody(imageData: string): Record<string, unknown> {
  return {
    systemInstruction: {
      parts: [{ text: 'You are a multimodal tool-calling assistant.' }]
    },
    contents: [
      {
        role: 'user',
        parts: [
          { text: 'Describe the image and then call the summarizer tool.' },
          {
            inlineData: {
              mimeType: 'image/png',
              data: imageData
            }
          }
        ]
      },
      {
        role: 'model',
        parts: [
          {
            functionCall: {
              name: 'summarize_image',
              args: {
                format: 'bullet-list',
                language: 'zh-CN'
              }
            }
          }
        ]
      },
      {
        role: 'tool',
        parts: [
          {
            functionResponse: {
              name: 'summarize_image',
              response: {
                summary: 'A yellow bird standing on a branch.'
              }
            }
          }
        ]
      }
    ]
  };
}

function createUsageMetadataResponse(): Record<string, unknown> {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: 'The image shows a yellow bird.' }]
        },
        finishReason: 'STOP'
      }
    ],
    usageMetadata: {
      promptTokenCount: 111,
      candidatesTokenCount: 29,
      totalTokenCount: 140,
      cachedContentTokenCount: 13
    }
  };
}

function expectCanonicalEvent(event: unknown): CanonicalTokenAccountingEventV2 {
  const assertCanonicalTokenAccountingEventV2: AssertCanonicalTokenAccountingEventV2 =
    getAssertCanonicalTokenAccountingEventV2();
  const candidate: unknown = event;
  assertCanonicalTokenAccountingEventV2(candidate);
  return candidate;
}

function expectLocalOrHeuristic(authority: TokenAccountingAuthority): void {
  expect(['local', 'heuristic']).toContain(authority);
}

describe('Gemini token accounting adapter', () => {
  test('exposes Gemini capabilities and states countTokens is estimate-only, not live-path authority', () => {
    const getCapabilities = getProviderTokenAccountingCapabilities();

    expect(getCapabilities('gemini')).toEqual({
      provider: 'gemini',
      supportsOfficialResponseUsage: true,
      supportsStreamingResponseUsage: true,
      supportsDedicatedCountEndpoint: true,
      supportsLocalTokenizer: true,
      supportsHeuristicFallback: true,
      countTokens: {
        supported: true,
        mode: 'input_estimate_only',
        livePathAuthority: false
      }
    });
  });

  test('maps non-stream usageMetadata into canonical final event and preserves cache tokens distinctly', () => {
    const session = createGeminiSession(false);
    session.consumeRequest({ body: createGeminiRequestBody('ZmFrZS1pbWFnZQ==') });

    const settlement = expectCanonicalEvent(
      session.consumeResponse({ body: createUsageMetadataResponse() })
    );

    expect(settlement).toEqual(
      expect.objectContaining({
        requestId: 'req_gemini_sync_1',
        attemptId: 'attempt_gemini_sync_1',
        routeId: 'gemini-route',
        upstreamId: 'gemini-primary',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        streaming: false,
        inputTokens: 111,
        outputTokens: 29,
        cacheReadTokens: 13,
        inputAuthority: 'official',
        outputAuthority: 'official',
        final: true
      })
    );
    expect(settlement.cacheWriteTokens ?? 0).toBe(0);
    expect(settlement.outcome).toEqual(expect.any(String));
    expect(settlement.countedAt).toEqual(expect.any(String));
  });

  test('treats only the last stream chunk with usageMetadata as authoritative', () => {
    const session = createGeminiSession(true);
    session.consumeRequest({ body: createGeminiRequestBody('c21hbGw=') });

    const firstChunk = expectCanonicalEvent(
      session.consumeStreamChunk({
        chunk: {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'The image shows ' }]
              }
            }
          ]
        }
      })
    );

    expect(firstChunk.final).toBe(false);
    expect(firstChunk.streaming).toBe(true);
    expect(firstChunk.cacheReadTokens).toBeUndefined();
    expect(firstChunk.inputAuthority).not.toBe('official');
    expect(firstChunk.outputAuthority).not.toBe('official');

    const finalChunk = expectCanonicalEvent(
      session.consumeStreamChunk({
        chunk: {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'a yellow bird.' }]
              },
              finishReason: 'STOP'
            }
          ],
          usageMetadata: {
            promptTokenCount: 21,
            candidatesTokenCount: 9,
            totalTokenCount: 30,
            cachedContentTokenCount: 4
          }
        }
      })
    );

    expect(finalChunk).toEqual(
      expect.objectContaining({
        requestId: 'req_gemini_stream_1',
        attemptId: 'attempt_gemini_stream_1',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        streaming: true,
        inputTokens: 21,
        outputTokens: 9,
        cacheReadTokens: 4,
        inputAuthority: 'official',
        outputAuthority: 'official',
        final: true
      })
    );
  });

  test('falls back to local or heuristic accounting for inlineData, functionCall and functionResponse when usageMetadata is absent', () => {
    const textOnlySession = createGeminiSession(false);
    textOnlySession.consumeRequest({
      body: {
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Describe this image.' }]
          }
        ]
      }
    });
    const textOnlySettlement = expectCanonicalEvent(
      textOnlySession.consumeResponse({
        body: {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'I need an image to describe it.' }]
              },
              finishReason: 'STOP'
            }
          ]
        }
      })
    );

    const smallImageSession = createGeminiSession(false);
    smallImageSession.consumeRequest({ body: createGeminiRequestBody('c21hbGw=') });
    const smallImageSettlement = expectCanonicalEvent(
      smallImageSession.consumeResponse({
        body: {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Yellow bird.' }]
              },
              finishReason: 'STOP'
            }
          ]
        }
      })
    );

    const hugeBase64 = 'A'.repeat(16000);
    const hugeInlineDataPart = {
      inlineData: {
        mimeType: 'image/png',
        data: hugeBase64
      }
    };
    const hugeImageSession = createGeminiSession(false);
    hugeImageSession.consumeRequest({ body: createGeminiRequestBody(hugeBase64) });
    const hugeImageSettlement = expectCanonicalEvent(
      hugeImageSession.consumeResponse({
        body: {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Yellow bird.' }]
              },
              finishReason: 'STOP'
            }
          ]
        }
      })
    );

    expectLocalOrHeuristic(textOnlySettlement.inputAuthority);
    expectLocalOrHeuristic(textOnlySettlement.outputAuthority);
    expectLocalOrHeuristic(smallImageSettlement.inputAuthority);
    expectLocalOrHeuristic(smallImageSettlement.outputAuthority);
    expectLocalOrHeuristic(hugeImageSettlement.inputAuthority);
    expectLocalOrHeuristic(hugeImageSettlement.outputAuthority);

    expect(smallImageSettlement.inputTokens).toBeGreaterThan(textOnlySettlement.inputTokens ?? 0);
    expect(hugeImageSettlement.inputTokens).toBeGreaterThan(textOnlySettlement.inputTokens ?? 0);
    expect(Math.abs((hugeImageSettlement.inputTokens ?? 0) - (smallImageSettlement.inputTokens ?? 0))).toBeLessThan(256);
    expect(hugeImageSettlement.inputTokens).toBeLessThan(
      Math.ceil(JSON.stringify(hugeInlineDataPart).length / 4) / 4
    );
  });

  test('downgrades authority when non-stream responses omit usageMetadata', () => {
    const session = createGeminiSession(false);
    session.consumeRequest({ body: createGeminiRequestBody('ZmFrZS1pbWFnZQ==') });

    const settlement = expectCanonicalEvent(
      session.consumeResponse({
        body: {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'No authoritative usage metadata was returned.' }]
              },
              finishReason: 'STOP'
            }
          ]
        }
      })
    );

    expect(settlement.final).toBe(true);
    expect(settlement.streaming).toBe(false);
    expectLocalOrHeuristic(settlement.inputAuthority);
    expectLocalOrHeuristic(settlement.outputAuthority);
  });

  test('marks aborted streams without final usageMetadata as non-final and never official', () => {
    const session = createGeminiSession(true);
    session.consumeRequest({ body: createGeminiRequestBody('c29tZS1pbWFnZQ==') });

    const chunkBeforeAbort = expectCanonicalEvent(
      session.consumeStreamChunk({
        chunk: {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Partial stream content only.' }]
              }
            }
          ]
        }
      })
    );

    expect(chunkBeforeAbort.final).toBe(false);
    expect(chunkBeforeAbort.outputAuthority).not.toBe('official');

    const abortedSettlement = expectCanonicalEvent(session.finalizeAbortedStream());

    expect(abortedSettlement).toEqual(
      expect.objectContaining({
        requestId: 'req_gemini_stream_1',
        attemptId: 'attempt_gemini_stream_1',
        provider: 'gemini',
        streaming: true,
        final: false
      })
    );
    expect(abortedSettlement.outcome).toEqual(expect.any(String));
    expectLocalOrHeuristic(abortedSettlement.inputAuthority);
    expectLocalOrHeuristic(abortedSettlement.outputAuthority);
  });
});
