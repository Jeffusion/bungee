import type { Plugin, PluginServiceContext } from '../../../packages/core/src/plugin.types';
import { definePlugin } from '../../../packages/core/src/plugin.types';
import type { MutableRequestContext, PluginHooks } from '../../../packages/core/src/hooks';
import { fetchModels, listModels } from 'tokenlens';
import type { ModelCatalog, ProviderInfo, ProviderModel } from 'tokenlens';
import { logger } from '../../../packages/core/src/logger';
import { SQLitePluginStorage } from '../../../packages/core/src/plugin-storage';
import { getPluginRuntimeOrchestrator } from '../../../packages/core/src/worker/state/plugin-manager';

interface ModelMappingOptions {
  modelMappings?: Array<{
    source: string;
    target: string;
  }> | Record<string, string>;
}

export type ModelOption = { value: string; label: string; description: string; provider?: string };
export type ModelCatalogSource = 'stored' | 'static';
export type ModelCatalogResponse = { provider: string; models: ModelOption[]; source: ModelCatalogSource; fetchedAt?: number };
export type ModelCatalogStatus = {
  source: ModelCatalogSource;
  fetchedAt: number | null;
  modelCount: number;
  providerCount: number;
  models: ModelOption[];
  providers: string[];
};

type StoredModelCatalog = {
  fetchedAt: number;
  models: ModelOption[];
};

const MODEL_MAPPING_PLUGIN_NAME = 'model-mapping';
const MODEL_CATALOG_STORAGE_KEY = 'catalog:v1:data';
const STATIC_MODEL_CATALOG = listModels({});
const KNOWN_PROVIDER_PREFIXES = new Set(
  STATIC_MODEL_CATALOG
    .map((model) => {
      const separatorIndex = model.id.indexOf(':');
      if (separatorIndex <= 0) {
        return '';
      }
      return model.id.slice(0, separatorIndex).trim();
    })
    .filter((provider) => provider.length > 0)
);

export function resetModelMappingCatalogCache(): void {
}

function getModelMappingStorage(): SQLitePluginStorage | null {
  const db = getPluginRuntimeOrchestrator()?.getDatabase();
  if (!db) {
    return null;
  }

  return new SQLitePluginStorage(db, MODEL_MAPPING_PLUGIN_NAME);
}

async function loadStoredModelCatalog(storage: SQLitePluginStorage | null = getModelMappingStorage()): Promise<StoredModelCatalog | null> {
  if (!storage) {
    return null;
  }

  const stored = await storage.get<StoredModelCatalog>(MODEL_CATALOG_STORAGE_KEY);
  if (!stored || !Array.isArray(stored.models) || typeof stored.fetchedAt !== 'number') {
    return null;
  }

  return stored;
}

async function saveStoredModelCatalog(models: ModelOption[], storage: SQLitePluginStorage | null = getModelMappingStorage()): Promise<StoredModelCatalog> {
  if (!storage) {
    throw new Error('Plugin storage is not initialized');
  }

  const payload: StoredModelCatalog = {
    fetchedAt: Date.now(),
    models,
  };
  await storage.set(MODEL_CATALOG_STORAGE_KEY, payload);
  return payload;
}

function summarizeCatalog(source: ModelCatalogSource, models: ModelOption[], fetchedAt: number | null): ModelCatalogStatus {
  const providers = [...new Set(models.map((model) => model.provider).filter((provider): provider is string => typeof provider === 'string' && provider.length > 0))].sort();
  return {
    source,
    fetchedAt,
    modelCount: models.length,
    providerCount: providers.length,
    models,
    providers,
  };
}

export async function getModelMappingCatalogStatus(storage: SQLitePluginStorage | null = getModelMappingStorage()): Promise<ModelCatalogStatus> {
  const stored = await loadStoredModelCatalog(storage);
  if (stored) {
    return summarizeCatalog('stored', stored.models, stored.fetchedAt);
  }

  const fallbackModels = buildStaticAllModels();
  return summarizeCatalog('static', fallbackModels, null);
}

export async function refreshStoredModelMappingCatalog(storage: SQLitePluginStorage | null = getModelMappingStorage()): Promise<ModelCatalogStatus> {
  const models = await buildFreshAllModels();
  const stored = await saveStoredModelCatalog(models, storage);
  return summarizeCatalog('stored', stored.models, stored.fetchedAt);
}

export async function getModelCatalogResponse(storage: SQLitePluginStorage | null = getModelMappingStorage()): Promise<ModelCatalogResponse> {
  const stored = await loadStoredModelCatalog(storage);
  if (stored) {
    return {
      provider: '',
      models: stored.models,
      source: 'stored',
      fetchedAt: stored.fetchedAt,
    };
  }

  return {
    provider: '',
    models: buildStaticAllModels(),
    source: 'static',
  };
}

async function buildFreshAllModels(): Promise<ModelOption[]> {
  const catalog = await fetchModels();
  return flattenFreshCatalog(catalog);
}

function flattenFreshCatalog(catalog: ModelCatalog): ModelOption[] {
      const rows: Array<{ dedupeKey: string; value: string; label: string; description: string; provider: string; sortKey: string }> = [];

      for (const [provider, providerInfo] of Object.entries(catalog)) {
        const normalizedProvider = provider.trim();
        if (!normalizedProvider) {
          continue;
        }

        KNOWN_PROVIDER_PREFIXES.add(normalizedProvider);

        const modelEntries = getProviderModelEntries(providerInfo);
        for (const [modelKey, model] of modelEntries) {
          const modelId = resolveFreshModelId(model, modelKey);
          if (!modelId) {
            continue;
          }

          const canonicalModelId = modelId.includes(':') ? modelId : `${normalizedProvider}:${modelId}`;
          const canonicalParsed = parseCanonicalModelId(canonicalModelId);
          const canonicalProvider = canonicalParsed?.provider || normalizedProvider;
          const bareModelId = canonicalParsed?.model || modelId;
          const selectableModelId = toSelectableModelId(canonicalModelId, normalizedProvider);

          KNOWN_PROVIDER_PREFIXES.add(canonicalProvider);

          const context = typeof model.limit?.context === 'number' ? model.limit.context : undefined;
          const descriptionParts = [canonicalProvider, context ? `ctx ${context}` : ''].filter(Boolean);
          const sortKey = resolveFreshModelSortKey(model);

          rows.push({
            dedupeKey: canonicalModelId,
            value: selectableModelId,
            label: resolveFreshModelLabel(model, bareModelId),
            description: descriptionParts.join(' · '),
            provider: canonicalProvider,
            sortKey
          });
        }
      }

      rows.sort((a, b) => {
        const byDate = b.sortKey.localeCompare(a.sortKey);
        if (byDate !== 0) {
          return byDate;
        }
        return a.dedupeKey.localeCompare(b.dedupeKey);
      });

      const dedup = new Map<string, ModelOption>();
      for (const row of rows) {
        if (!dedup.has(row.dedupeKey)) {
          dedup.set(row.dedupeKey, {
            value: row.value,
            label: row.label,
            description: row.description,
            provider: row.provider
          });
        }
      }

      return Array.from(dedup.values());
}

function getProviderModelEntries(providerInfo: ProviderInfo | undefined): Array<[string, ProviderModel]> {
      if (!providerInfo || typeof providerInfo !== 'object') {
        return [];
      }

      const modelMap = providerInfo.models;
      if (!modelMap || typeof modelMap !== 'object') {
        return [];
      }

      return Object.entries(modelMap).filter((entry): entry is [string, ProviderModel] => {
        const model = entry[1];
        return Boolean(model && typeof model === 'object');
      });
}

function resolveFreshModelId(model: ProviderModel, modelKey: string): string {
      const fromModelId = typeof model.id === 'string' ? model.id.trim() : '';
      if (fromModelId) {
        return fromModelId;
      }

      const fromModelKey = modelKey.trim();
      return fromModelKey;
}

function resolveFreshModelLabel(model: ProviderModel, fallback: string): string {
      const name = typeof model.name === 'string' ? model.name.trim() : '';
      return name || fallback;
}

function resolveFreshModelSortKey(model: ProviderModel): string {
      const lastUpdated = typeof model.last_updated === 'string' ? model.last_updated : '';
      if (lastUpdated) {
        return lastUpdated;
      }

      const releaseDate = typeof model.release_date === 'string' ? model.release_date : '';
      return releaseDate;
}

function toSelectableModelId(modelId: string, providerHint: string): string {
      const trimmedModelId = modelId.trim();
      const trimmedProviderHint = providerHint.trim();

      if (trimmedProviderHint && trimmedModelId.startsWith(`${trimmedProviderHint}:`) && trimmedModelId.length > trimmedProviderHint.length + 1) {
        return trimmedModelId.slice(trimmedProviderHint.length + 1);
      }

      const canonical = parseCanonicalModelId(trimmedModelId);
      if (!canonical) {
        return trimmedModelId;
      }

      if (KNOWN_PROVIDER_PREFIXES.has(canonical.provider)) {
        return canonical.model;
      }

      return trimmedModelId;
}

function parseCanonicalModelId(model: string): { provider: string; model: string } | null {
      const trimmed = model.trim();
      const separatorIndex = trimmed.indexOf(':');
      if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
        return null;
      }

      const provider = trimmed.slice(0, separatorIndex).trim();
      const modelId = trimmed.slice(separatorIndex + 1).trim();
      if (!provider || !modelId) {
        return null;
      }

      return { provider, model: modelId };
}

function buildStaticAllModels(): ModelOption[] {
      const dedup = new Map<string, ModelOption>();
      for (const model of STATIC_MODEL_CATALOG) {
        const canonicalModelId = model.id.trim();
        if (!canonicalModelId || dedup.has(canonicalModelId)) {
          continue;
        }

        const separatorIndex = canonicalModelId.indexOf(':');
        const hasProviderPrefix = separatorIndex > 0;
        const provider = hasProviderPrefix ? canonicalModelId.slice(0, separatorIndex) : '';
        const bareModelId = hasProviderPrefix ? canonicalModelId.slice(separatorIndex + 1) : canonicalModelId;

        if (provider) {
          KNOWN_PROVIDER_PREFIXES.add(provider);
        }

        const contextMax = model.context?.combinedMax ?? model.context?.inputMax;
        const descriptionParts = [provider, contextMax ? `ctx ${contextMax}` : ''].filter(Boolean);
        const selectableModelId = toSelectableModelId(canonicalModelId, provider);
        dedup.set(canonicalModelId, {
          value: selectableModelId,
          label: model.displayName || bareModelId,
          description: descriptionParts.join(' · '),
          provider
        });
      }

      return Array.from(dedup.values());
}

class ModelMappingPluginImpl implements Plugin {
    static readonly name = MODEL_MAPPING_PLUGIN_NAME;
    static readonly version = '1.0.0';

    static async getEditorModels(_req: Request, context: PluginServiceContext): Promise<Response> {
      const storage = context.db ? new SQLitePluginStorage(context.db, MODEL_MAPPING_PLUGIN_NAME) : null;
      return new Response(JSON.stringify(await getModelCatalogResponse(storage)), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    options: ModelMappingOptions;
    modelMappingMap = new Map<string, string>();

    constructor(options?: ModelMappingOptions) {
      this.options = options ?? {};
      this.modelMappingMap = this.buildModelMappingMap(this.options.modelMappings);
    }

    register(hooks: PluginHooks): void {
      hooks.onBeforeRequest.tapPromise(
        { name: 'model-mapping', stage: -10 },
        async (ctx) => {
          this.applyModelMapping(ctx);
          return ctx;
        }
      );
    }

    async reset(): Promise<void> {
    }

    async getModels(_req: Request): Promise<Response> {
      return new Response(JSON.stringify(await getModelCatalogResponse()), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    private buildModelMappingMap(input: ModelMappingOptions['modelMappings']): Map<string, string> {
      const map = new Map<string, string>();

      if (!input) return map;

      if (Array.isArray(input)) {
        for (const item of input) {
          const source = typeof item?.source === 'string' ? item.source.trim() : '';
          const target = typeof item?.target === 'string' ? item.target.trim() : '';
          if (source && target) {
            map.set(source, target);
          }
        }
        return map;
      }

      if (typeof input === 'object') {
        for (const [source, target] of Object.entries(input)) {
          const sourceKey = source.trim();
          const targetValue = typeof target === 'string' ? target.trim() : '';
          if (sourceKey && targetValue) {
            map.set(sourceKey, targetValue);
          }
        }
      }

      return map;
    }

    private applyModelMapping(ctx: MutableRequestContext): void {
      if (this.modelMappingMap.size === 0) return;

      const modelInfo = this.extractModelFromContext(ctx);
      if (!modelInfo) return;

      const { model: currentModel, source } = modelInfo;
      if (!currentModel) return;

      const mappedModel = this.resolveMappedModel(currentModel);
      if (!mappedModel || mappedModel === currentModel) return;

      const normalizedMappedModel = this.normalizeMappedTargetModel(mappedModel);
      if (!normalizedMappedModel || normalizedMappedModel === currentModel) return;

      if (source === 'body' && ctx.body && typeof ctx.body === 'object') {
        (ctx.body as Record<string, unknown>).model = normalizedMappedModel;
      } else if (source === 'url') {
        this.updateModelInUrlPath(ctx.url, currentModel, normalizedMappedModel);
      }

      logger.debug(
        {
          fromModel: currentModel,
          toModel: normalizedMappedModel,
          source
        },
        'Model mapping applied'
      );
    }

    private extractModelFromContext(ctx: MutableRequestContext): { model: string; source: 'body' | 'url' } | null {
      if (ctx.body && typeof ctx.body === 'object') {
        const bodyModel = (ctx.body as Record<string, unknown>).model;
        if (typeof bodyModel === 'string' && bodyModel.trim()) {
          return { model: bodyModel.trim(), source: 'body' };
        }
      }

      const urlModel = this.extractModelFromUrlPath(ctx.url.pathname);
      if (urlModel) {
        return { model: urlModel, source: 'url' };
      }

      return null;
    }

    private extractModelFromUrlPath(pathname: string): string | null {
      const geminiMatch = pathname.match(/^\/v1(?:beta)?\/models\/([^/:]+)(?::|(?:\/(?:generateContent|streamGenerateContent)))/);
      if (geminiMatch) {
        const rawModel = geminiMatch[1];
        try {
          return decodeURIComponent(rawModel);
        } catch {
          return rawModel;
        }
      }

      return null;
    }

    private updateModelInUrlPath(url: URL, oldModel: string, newModel: string): void {
      const encodedNewModel = encodeURIComponent(newModel);
      const encodedOldModel = encodeURIComponent(oldModel);

      if (url.pathname.includes(encodedOldModel)) {
        url.pathname = url.pathname.replace(encodedOldModel, encodedNewModel);
      } else {
        url.pathname = url.pathname.replace(oldModel, encodedNewModel);
      }
    }

    private resolveMappedModel(currentModel: string): string | undefined {
      const exactMappedModel = this.modelMappingMap.get(currentModel);
      if (exactMappedModel) {
        return exactMappedModel;
      }

      const canonicalMappedModel = this.findCanonicalSuffixMappedModel(currentModel);
      if (canonicalMappedModel) {
        return canonicalMappedModel;
      }

      const strippedModel = this.stripModelRevisionSuffix(currentModel);
      if (strippedModel !== currentModel) {
        const strippedMappedModel = this.modelMappingMap.get(strippedModel);
        if (strippedMappedModel) {
          return strippedMappedModel;
        }

        const strippedCanonicalMappedModel = this.findCanonicalSuffixMappedModel(strippedModel);
        if (strippedCanonicalMappedModel) {
          return strippedCanonicalMappedModel;
        }
      }

      const prefixMappedModel = this.findLongestPrefixMappedModel(currentModel);
      if (prefixMappedModel) {
        return prefixMappedModel;
      }

      if (strippedModel !== currentModel) {
        return this.findLongestPrefixMappedModel(strippedModel);
      }

      return undefined;
    }

    private findCanonicalSuffixMappedModel(model: string): string | undefined {
      let candidate: string | undefined;

      for (const [source, target] of this.modelMappingMap.entries()) {
        const canonicalSource = this.parseCanonicalModelId(source);
        if (!canonicalSource) {
          continue;
        }

        if (canonicalSource.model !== model) {
          continue;
        }

        if (candidate === undefined) {
          candidate = target;
          continue;
        }

        if (candidate !== target) {
          return undefined;
        }
      }

      return candidate;
    }

    private stripModelRevisionSuffix(model: string): string {
      const trimmed = model.trim();
      const revisionSuffix = /^(.*)-\d{8}$/;
      const matched = trimmed.match(revisionSuffix);
      if (!matched || !matched[1]) {
        return trimmed;
      }

      return matched[1];
    }

    private findLongestPrefixMappedModel(model: string): string | undefined {
      let matchedSource = '';
      let mappedModel: string | undefined;

      for (const [source, target] of this.modelMappingMap.entries()) {
        if (!source || source === model) {
          continue;
        }

        if (!model.startsWith(`${source}-`)) {
          continue;
        }

        if (source.length > matchedSource.length) {
          matchedSource = source;
          mappedModel = target;
        }
      }

      return mappedModel;
    }

    private normalizeMappedTargetModel(model: string): string {
      const trimmed = model.trim();
      const canonical = this.parseCanonicalModelId(trimmed);
      if (!canonical) {
        return trimmed;
      }

      if (KNOWN_PROVIDER_PREFIXES.has(canonical.provider)) {
        return canonical.model;
      }

      return trimmed;
    }

    private toSelectableModelId(modelId: string, providerHint: string): string {
      const trimmedModelId = modelId.trim();
      const trimmedProviderHint = providerHint.trim();

      if (trimmedProviderHint && trimmedModelId.startsWith(`${trimmedProviderHint}:`) && trimmedModelId.length > trimmedProviderHint.length + 1) {
        return trimmedModelId.slice(trimmedProviderHint.length + 1);
      }

      const canonical = this.parseCanonicalModelId(trimmedModelId);
      if (!canonical) {
        return trimmedModelId;
      }

      if (KNOWN_PROVIDER_PREFIXES.has(canonical.provider)) {
        return canonical.model;
      }

      return trimmedModelId;
    }

    private parseCanonicalModelId(model: string): { provider: string; model: string } | null {
      const trimmed = model.trim();
      const separatorIndex = trimmed.indexOf(':');
      if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
        return null;
      }

      const provider = trimmed.slice(0, separatorIndex).trim();
      const modelId = trimmed.slice(separatorIndex + 1).trim();
      if (!provider || !modelId) {
        return null;
      }

      return { provider, model: modelId };
    }
  }

export const ModelMappingPlugin = definePlugin(ModelMappingPluginImpl);

export default ModelMappingPlugin;
