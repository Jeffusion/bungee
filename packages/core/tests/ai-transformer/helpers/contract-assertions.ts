import { expect } from 'bun:test';

export async function readResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }

  const decoder = new TextDecoder();
  let allData = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    allData += decoder.decode(value);
  }

  return allData;
}

export function parseSSEJsonEvents(raw: string): any[] {
  return raw
    .split('\n\n')
    .filter((line) => line.startsWith('data: ') && !line.includes('[DONE]'))
    .map((line) => {
      const dataContent = line.substring(6);
      try {
        return JSON.parse(dataContent);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function normalizeDynamicFields<T>(payload: T): T {
  const walk = (value: any): any => {
    if (Array.isArray(value)) {
      return value.map((item) => walk(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const clone: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      if (key === 'id' && typeof val === 'string' && (val.startsWith('chatcmpl-') || val.startsWith('msg_'))) {
        clone[key] = '<dynamic-id>';
        continue;
      }
      if (key === 'created' && typeof val === 'number') {
        clone[key] = '<dynamic-ts>';
        continue;
      }
      clone[key] = walk(val);
    }

    return clone;
  };

  return walk(payload);
}

export function expectOpenAIStreamingChunkContract(events: any[]): void {
  expect(events.length).toBeGreaterThan(0);
  for (const event of events) {
    expect(event.object).toBe('chat.completion.chunk');
    expect(Array.isArray(event.choices)).toBe(true);
    expect(event.choices.length).toBeGreaterThan(0);
  }

  const firstDelta = events[0].choices[0].delta || {};
  expect(firstDelta.role).toBe('assistant');
}

export function expectToolResultMessagesLinked(messages: any[]): void {
  const assistantToolCallIds = new Set<string>();

  for (const msg of messages) {
    if (msg.role !== 'assistant' || !Array.isArray(msg.tool_calls)) continue;
    for (const toolCall of msg.tool_calls) {
      if (typeof toolCall?.id === 'string' && toolCall.id.length > 0) {
        assistantToolCallIds.add(toolCall.id);
      }
    }
  }

  const toolMessages = messages.filter((msg) => msg.role === 'tool');
  for (const toolMsg of toolMessages) {
    expect(typeof toolMsg.tool_call_id).toBe('string');
    expect(assistantToolCallIds.has(toolMsg.tool_call_id)).toBe(true);
  }
}
