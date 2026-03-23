import { afterEach, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import type { AppConfig, ModificationRules } from '@jeffusion/bungee-types';
import type { ExpressionContext } from '../src/expression-engine';
import { MigrationManager } from '../src/migrations/migration-manager';
import { accessLogWriter } from '../src/logger/access-log-writer';
import { bodyStorageManager } from '../src/logger/body-storage';
import { RequestLogger } from '../src/logger/request-logger';
import { prepareResponse } from '../src/worker/response/processor';

const trackedRequestIds: string[] = [];
const trackedBodyIds: string[] = [];

const baseContext: ExpressionContext = {
  headers: {},
  body: {},
  url: {
    pathname: '/v1/messages',
    search: '',
    host: 'localhost',
    protocol: 'http:',
  },
  method: 'POST',
  env: {},
};

const emptyRules: ModificationRules = {};

beforeAll(async () => {
  const dbPath = path.resolve(process.cwd(), 'logs', 'access.db');
  const migrationManager = new MigrationManager(dbPath);
  await migrationManager.migrate();
});

function createSSEBody(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function enqueueAccessLog(requestId: string): void {
  accessLogWriter.write({
    requestId,
    timestamp: Date.now(),
    method: 'POST',
    path: '/v1/messages',
    status: 200,
    duration: 12,
  });
}

function getBodyFilePath(bodyId: string): string {
  return path.resolve(process.cwd(), 'logs', 'bodies', `${bodyId}.json`);
}

afterEach(async () => {
  await accessLogWriter.flush();
  const db = accessLogWriter.getDatabase();

  for (const requestId of trackedRequestIds.splice(0)) {
    db.prepare('DELETE FROM access_logs WHERE request_id = ?').run(requestId);
  }

  for (const bodyId of trackedBodyIds.splice(0)) {
    const filePath = getBodyFilePath(bodyId);
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }
});

describe('prepareResponse streamed logging', () => {
  test('applies pending resp_body_id update when log entry is written later', async () => {
    const reqLogger = new RequestLogger(new Request('http://localhost/v1/messages?stream=true', { method: 'POST' }));
    const requestId = reqLogger.getRequestId();
    trackedRequestIds.push(requestId);

    const expectedBodyId = `manual-${requestId}`;
    accessLogWriter.updateResponseBodyId(requestId, expectedBodyId);

    enqueueAccessLog(requestId);
    await accessLogWriter.flush();

    const row = accessLogWriter
      .getDatabase()
      .prepare('SELECT resp_body_id FROM access_logs WHERE request_id = ?')
      .get(requestId) as { resp_body_id: string | null } | null;

    expect(row).not.toBeNull();
    expect(row?.resp_body_id).toBe(expectedBodyId);
  });

  test('records full SSE messages beyond body size limit and updates resp_body_id', async () => {
    const reqLogger = new RequestLogger(new Request('http://localhost/v1/messages?stream=true', { method: 'POST' }));
    const requestId = reqLogger.getRequestId();
    trackedRequestIds.push(requestId);
    enqueueAccessLog(requestId);

    const longSuffix = 'TAIL_END_MARKER';
    const longDeltaText = `${'x'.repeat(1024)}${longSuffix}`;
    const streamChunks: string[] = [
      'event: message_start\n',
      'data: {"type":"message_start","message":{"id":"msg_full"}}\n\n',
    ];

    for (let i = 0; i < 18; i += 1) {
      const payload = JSON.stringify({
        type: 'content_block_delta',
        index: i,
        delta: {
          text: `segment-${i}-${longDeltaText}`,
        },
      });
      streamChunks.push('event: content_block_delta\n');
      streamChunks.push(`data: ${payload}\n\n`);
    }

    streamChunks.push('data: [DONE]\n\n');

    const expectedMessageCount = 20;

    const config: AppConfig = {
      routes: [],
      logging: {
        body: {
          enabled: true,
          maxSize: 64,
          retentionDays: 1,
        },
      },
    };

    const upstreamResponse = new Response(
      createSSEBody(streamChunks),
      { headers: { 'content-type': 'text/event-stream' } }
    );

    const prepared = await prepareResponse(
      upstreamResponse,
      emptyRules,
      baseContext,
      { requestId },
      true,
      reqLogger,
      config
    );

    expect(prepared.body).not.toBeNull();
    const emittedText = await new Response(prepared.body as ReadableStream<Uint8Array>).text();
    expect(emittedText.includes('event: message_start')).toBeTrue();
    expect(emittedText.includes('data: [DONE]')).toBeTrue();
    expect(emittedText.includes(longSuffix)).toBeTrue();

    await accessLogWriter.flush();

    const row = accessLogWriter
      .getDatabase()
      .prepare('SELECT resp_body_id FROM access_logs WHERE request_id = ?')
      .get(requestId) as { resp_body_id: string | null } | null;

    expect(row).not.toBeNull();
    expect(typeof row?.resp_body_id).toBe('string');

    const respBodyId = row?.resp_body_id as string;
    trackedBodyIds.push(respBodyId);

    const recorded = await bodyStorageManager.load(respBodyId) as {
      kind: string;
      totalMessages: number;
      capturedMessages: number;
      droppedMessages: number;
      messages: Array<{ event?: string; done?: boolean; dataText: string }>;
    };

    expect(recorded.kind).toBe('sse_messages');
    expect(recorded.totalMessages).toBe(expectedMessageCount);
    expect(recorded.capturedMessages).toBe(expectedMessageCount);
    expect(recorded.droppedMessages).toBe(0);
    expect(recorded.messages.length).toBe(expectedMessageCount);
    expect(recorded.messages[0]?.event).toBe('message_start');
    expect(recorded.messages[1]?.event).toBe('content_block_delta');
    expect(recorded.messages[1]?.dataText.includes(longSuffix)).toBeTrue();
    expect(recorded.messages[expectedMessageCount - 1]?.done).toBeTrue();
  });

  test('does not record streamed body when body logging is disabled', async () => {
    const reqLogger = new RequestLogger(new Request('http://localhost/v1/messages?stream=true', { method: 'POST' }));
    const requestId = reqLogger.getRequestId();
    trackedRequestIds.push(requestId);
    enqueueAccessLog(requestId);

    const config: AppConfig = {
      routes: [],
      logging: {
        body: {
          enabled: false,
          maxSize: 5_120,
          retentionDays: 1,
        },
      },
    };

    const upstreamResponse = new Response(
      createSSEBody([
        'event: message_start\n',
        'data: {"type":"message_start"}\n\n',
        'data: [DONE]\n\n',
      ]),
      { headers: { 'content-type': 'text/event-stream' } }
    );

    const prepared = await prepareResponse(
      upstreamResponse,
      emptyRules,
      baseContext,
      { requestId },
      true,
      reqLogger,
      config
    );

    expect(prepared.body).not.toBeNull();
    await new Response(prepared.body as ReadableStream<Uint8Array>).text();

    await accessLogWriter.flush();

    const row = accessLogWriter
      .getDatabase()
      .prepare('SELECT resp_body_id FROM access_logs WHERE request_id = ?')
      .get(requestId) as { resp_body_id: string | null } | null;

    expect(row).not.toBeNull();
    expect(row?.resp_body_id).toBeNull();
  });
});
