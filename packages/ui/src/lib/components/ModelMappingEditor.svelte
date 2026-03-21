<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { _ } from '../i18n';
  import ComboInput from './smart-input/ComboInput.svelte';
  import { PluginsAPI } from '../api/plugins';

  type ModelOption = { value: string; label?: string; description?: string };
  type ModelMapping = { source: string; target: string };
  type CatalogCacheEntry = { models: ModelOption[]; expiresAt: number; source: 'fresh' | 'static' | '' };

  const OPTION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

  export let value: ModelMapping[] = [];
  export let fromProvider = '';
  export let toProvider = '';

  const dispatch = createEventDispatcher<{ change: ModelMapping[] }>();

  const optionCache = new Map<string, CatalogCacheEntry>();

  let sourceOptions: ModelOption[] = [];
  let targetOptions: ModelOption[] = [];
  let loadingSource = false;
  let loadingTarget = false;

  $: rows = Array.isArray(value)
    ? value.map((item) => ({
      source: typeof item?.source === 'string' ? item.source : '',
      target: typeof item?.target === 'string' ? item.target : ''
    }))
    : [];

  $: if (fromProvider) {
    void loadProviderOptions(fromProvider, true);
  } else {
    sourceOptions = [];
  }

  $: if (toProvider) {
    void loadProviderOptions(toProvider, false);
  } else {
    targetOptions = [];
  }

  async function loadProviderOptions(provider: string, isSource: boolean): Promise<void> {
    const key = provider.trim();
    if (!key) return;

    const cached = optionCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      if (isSource) sourceOptions = cached.models;
      else targetOptions = cached.models;
      return;
    }

    if (isSource) loadingSource = true;
    else loadingTarget = true;

    try {
      const response = await PluginsAPI.getAITransformerModels(key);
      const models = Array.isArray(response?.models) ? response.models : [];

      optionCache.set(key, {
        models,
        expiresAt: Date.now() + OPTION_CACHE_TTL_MS,
        source: response?.source === 'fresh' || response?.source === 'static' ? response.source : ''
      });

      if (isSource) sourceOptions = models;
      else targetOptions = models;
    } catch (_error) {
      optionCache.set(key, {
        models: [],
        expiresAt: Date.now() + OPTION_CACHE_TTL_MS,
        source: ''
      });
      if (isSource) sourceOptions = [];
      else targetOptions = [];
    } finally {
      if (isSource) loadingSource = false;
      else loadingTarget = false;
    }
  }

  function emit(nextRows: ModelMapping[]): void {
    dispatch('change', nextRows);
  }

  function updateRow(index: number, key: 'source' | 'target', nextValue: string): void {
    const nextRows = rows.map((row, i) => (i === index ? { ...row, [key]: nextValue } : row));
    emit(nextRows);
  }

  function addRow(): void {
    emit([...rows, { source: '', target: '' }]);
  }

  function removeRow(index: number): void {
    emit(rows.filter((_, i) => i !== index));
  }
</script>

<div class="space-y-2">
  {#if rows.length === 0}
    <div class="text-sm text-gray-500">{$_('plugins.ai-transformer.modelMapping.empty')}</div>
  {/if}

  {#each rows as row, index}
    <div class="grid grid-cols-[1fr_1fr_auto] gap-2 items-start">
      <div class="min-w-0">
        <ComboInput
          value={row.source}
          options={sourceOptions}
          allowCustom={true}
          placeholder={$_('plugins.ai-transformer.modelMapping.sourceLabel')}
          on:change={(event) => updateRow(index, 'source', String(event.detail ?? ''))}
        />
      </div>

      <div class="min-w-0">
        <ComboInput
          value={row.target}
          options={targetOptions}
          allowCustom={true}
          placeholder={$_('plugins.ai-transformer.modelMapping.targetLabel')}
          on:change={(event) => updateRow(index, 'target', String(event.detail ?? ''))}
        />
      </div>

      <button class="btn btn-sm btn-ghost text-error" type="button" on:click={() => removeRow(index)}>
        {$_('common.delete')}
      </button>
    </div>
  {/each}

  <div class="flex items-center justify-between gap-2">
    <button class="btn btn-sm btn-outline" type="button" on:click={addRow}>
      {$_('plugins.ai-transformer.modelMapping.addRow')}
    </button>

    {#if loadingSource || loadingTarget}
      <span
        class="loading loading-spinner loading-xs text-base-content/50"
        aria-label="loading model catalog"
        title="loading"
      ></span>
    {/if}
  </div>
</div>
