import { afterEach, describe, expect, test } from 'bun:test';
import { initializePermissionManager } from '../../src/plugin-permissions';
import { handleGetPluginSchemas, handleGetPluginTranslations } from '../../src/api/handlers/plugins';
import { cleanupPluginRegistry, initializePluginRuntime } from '../../src/worker/state/plugin-manager';

afterEach(async () => {
  await cleanupPluginRegistry();
});

describe('plugin schema i18n', () => {
  test('exposes ai-transformer schema fields as plugin-scoped translation keys', async () => {
    initializePermissionManager();
    await initializePluginRuntime({
      plugins: [{ name: 'ai-transformer', path: 'plugins/ai-transformer/server/index.ts', enabled: true }],
      routes: [],
    }, { basePath: process.cwd() });

    const schemas = await (await handleGetPluginSchemas(new Request('http://localhost/api/plugins/schemas'))).json() as Record<string, any>;
    const translations = await (await handleGetPluginTranslations(new Request('http://localhost/api/plugin-translations'))).json() as Record<string, any>;

    const schema = schemas['ai-transformer'];
    expect(schema).toBeDefined();
    expect(schema.metadata.name).toBe('plugins.ai-transformer.metadata.name');
    expect(schema.description).toBe('plugins.ai-transformer.plugin.description');
    expect(schema.configSchema[0].label).toBe('plugins.ai-transformer.transformation.label');
    expect(schema.configSchema[0].description).toBe('plugins.ai-transformer.transformation.description');
    expect(schema.configSchema[0].options[0].label).toBe('plugins.ai-transformer.options.anthropic_openai.label');
    expect(translations.en.plugins['ai-transformer']['transformation.label']).toBe('Transformation Direction');
    expect(translations['zh-CN'].plugins['ai-transformer']['transformation.label']).toBe('转换方向');
  });
});
