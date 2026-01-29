import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { AppConfig } from '@jeffusion/bungee-types';
import { handleRequest, initializeRuntimeState, initializePluginRegistryForTests, cleanupPluginRegistry } from '../src/worker';

const mockConfig: AppConfig = {
  routes: [
    {
      path: '/same-target',
      upstreams: [
        {
          target: 'http://mock-upstream-a.com',
          priority: 1,
          plugins: [
            {
              name: 'header-injection-example',
              options: {
                headers: { 'x-only-a': '1' },
                priority: 10,
              }
            }
          ]
        },
        {
          target: 'http://mock-upstream-a.com',
          priority: 2,
          plugins: [
            {
              name: 'header-injection-example',
              options: {
                headers: { 'x-only-b': '1' },
                priority: 1,
              }
            }
          ]
        }
      ],
      failover: { enabled: false, retryableStatusCodes: [] },
    },
  ],
};

const mockedFetch = mock(async (_request: Request | string, options?: RequestInit) => {
  const headers = new Headers(options?.headers);
    const onlyA = headers.get('x-only-a') || '0';
    const onlyB = headers.get('x-only-b') || '0';
    return new Response(JSON.stringify({ onlyA, onlyB }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
});

global.fetch = mockedFetch as any;

describe('ScopedPluginRegistry upstream scope isolation', () => {
  beforeEach(async () => {
    mockedFetch.mockClear();
    initializeRuntimeState(mockConfig);
    await initializePluginRegistryForTests(mockConfig);
  });

  afterEach(async () => {
    await cleanupPluginRegistry();
  });

  test('should isolate upstream plugins when targets are identical', async () => {
    const req = new Request('http://localhost/same-target');
    await handleRequest(req, mockConfig);

    const fetchOptions = mockedFetch.mock.calls[0]?.[1];
    if (!fetchOptions) throw new Error('fetch was called without options');
    const forwardedHeaders = new Headers(fetchOptions.headers);

    expect(forwardedHeaders.get('x-only-a')).toBe('1');
    expect(forwardedHeaders.get('x-only-b')).toBeNull();
  });

  test('should not apply plugins from disabled upstream with same target', async () => {
    const configWithDisable: AppConfig = {
      routes: [
        {
          path: '/same-target-disabled',
          upstreams: [
            {
              target: 'http://mock-upstream-a.com',
              priority: 1,
              plugins: [
                {
                  name: 'header-injection-example',
                  options: {
                    headers: { 'x-enabled': '1' },
                    priority: 10,
                  }
                }
              ]
            },
            {
              target: 'http://mock-upstream-a.com',
              priority: 2,
              disabled: true,
              plugins: [
                {
                  name: 'header-injection-example',
                  options: {
                    headers: { 'x-disabled': '1' },
                    priority: 1,
                  }
                }
              ]
            }
          ],
          failover: { enabled: false, retryableStatusCodes: [] },
        },
      ],
    };

    await cleanupPluginRegistry();
    initializeRuntimeState(configWithDisable);
    await initializePluginRegistryForTests(configWithDisable);

    const req = new Request('http://localhost/same-target-disabled');
    await handleRequest(req, configWithDisable);

    const fetchOptions = mockedFetch.mock.calls[0]?.[1];
    if (!fetchOptions) throw new Error('fetch was called without options');
    const forwardedHeaders = new Headers(fetchOptions.headers);

    expect(forwardedHeaders.get('x-enabled')).toBe('1');
    expect(forwardedHeaders.get('x-disabled')).toBeNull();
  });
});
