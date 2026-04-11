<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { _ } from '../i18n';
  import ComboInput from './smart-input/ComboInput.svelte';
  import { PluginsAPI } from '../api/plugins';
  import { getCachedPluginModelCatalog } from './model-mapping/catalog-cache';
  import {
    buildRowOptions,
    buildProviderOptions,
    canonicalizeProviderFilter,
    type ModelOption,
    type RowOptionSet,
    type RowProviderFilter
  } from './model-mapping/filtering';

  type ModelMapping = { source: string; target: string };

  export let value: ModelMapping[] = [];
  export let pluginName = 'model-mapping';
  export let catalogPlugin = 'model-mapping';
  export let sourceCatalogProvider = '';
  export let targetCatalogProvider = '';

  const dispatch = createEventDispatcher<{ change: ModelMapping[] }>();

  let allOptions: ModelOption[] = [];
  let providerOptions: string[] = [];
  let providerFilterOptions: ModelOption[] = [];
  let rowProviderFilters: RowProviderFilter[] = [];
  let rowOptions: RowOptionSet[] = [];
  let loading = false;
  let lastCatalogRequestKey = '';
  let catalogRequestToken = 0;

  $: rows = Array.isArray(value)
    ? value.map((item) => ({
      source: typeof item?.source === 'string' ? item.source : '',
      target: typeof item?.target === 'string' ? item.target : ''
    }))
    : [];

  $: i18nPrefix = `plugins.${(pluginName || 'model-mapping').trim()}.modelMapping`;

  $: providerOptions = buildProviderOptions(allOptions);
  $: normalizedCatalogPlugin = (catalogPlugin || 'model-mapping').trim();
  $: normalizedSourceCatalogProvider = sourceCatalogProvider.trim();
  $: normalizedTargetCatalogProvider = targetCatalogProvider.trim();
  $: showProviderFilters = true;
  $: catalogRequestKey = JSON.stringify([
    normalizedCatalogPlugin,
    normalizedSourceCatalogProvider,
    normalizedTargetCatalogProvider,
  ]);
  $: if (normalizedCatalogPlugin) {
    void loadCatalogOptions(catalogRequestKey);
  } else {
    allOptions = [];
    lastCatalogRequestKey = '';
  }

  $: providerFilterOptions = [
    {
      value: '',
      label: textOrFallback('allProviders', 'All providers')
    },
    ...providerOptions.map((provider) => ({
      value: provider,
      label: provider
    }))
  ];

  $: {
    if (rowProviderFilters.length !== rows.length) {
      rowProviderFilters = Array.from({ length: rows.length }, (_, index) => {
        const previous = rowProviderFilters[index];
        return {
          source: previous?.source ?? '',
          target: previous?.target ?? ''
        };
      });
    }
  }

  $: rowOptions = buildRowOptions(allOptions, rowProviderFilters, rows.length);

  function i18nKey(suffix: string): string {
    return `${i18nPrefix}.${suffix}`;
  }

  function textOrFallback(suffix: string, fallback: string): string {
    const key = i18nKey(suffix);
    const translated = $_(key);
    return translated === key ? fallback : translated;
  }

  function getRowProviderFilter(index: number, kind: 'source' | 'target'): string {
    return rowProviderFilters[index]?.[kind] ?? '';
  }

  function updateRowProviderFilter(index: number, kind: 'source' | 'target', provider: string): void {
    const nextFilters = [...rowProviderFilters];
    while (nextFilters.length <= index) {
      nextFilters.push({ source: '', target: '' });
    }

    const currentFilter = nextFilters[index] ?? { source: '', target: '' };
    const normalizedProvider = canonicalizeProviderFilter(provider, providerOptions);
    nextFilters[index] = {
      ...currentFilter,
      [kind]: normalizedProvider
    };

    rowProviderFilters = nextFilters;
  }

  async function loadCatalogOptions(requestKey: string): Promise<void> {
    if (!normalizedCatalogPlugin || requestKey === lastCatalogRequestKey) {
      return;
    }

    lastCatalogRequestKey = requestKey;
    const requestToken = ++catalogRequestToken;

    loading = true;

    try {
      const fixedProviders = Array.from(new Set([
        normalizedSourceCatalogProvider,
        normalizedTargetCatalogProvider,
      ].filter((provider) => provider.length > 0)));

      if (fixedProviders.length > 0) {
        const responses = await Promise.all(
          fixedProviders.map(async (provider) => {
            const response = await getCachedPluginModelCatalog(PluginsAPI.getPluginModels, normalizedCatalogPlugin, provider);
            const models = Array.isArray(response?.models) ? response.models : [];
            return models.map((model) => ({
              ...model,
              provider: typeof model.provider === 'string' && model.provider.length > 0 ? model.provider : provider,
            }));
          })
        );

        if (requestToken === catalogRequestToken) {
          allOptions = responses.flat();
        }
        return;
      }

      const response = await getCachedPluginModelCatalog(PluginsAPI.getPluginModels, normalizedCatalogPlugin);
      if (requestToken === catalogRequestToken) {
        allOptions = Array.isArray(response?.models) ? response.models : [];
      }
    } catch (_error) {
      if (requestToken === catalogRequestToken) {
        lastCatalogRequestKey = '';
      }
    } finally {
      if (requestToken === catalogRequestToken) {
        loading = false;
      }
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
    rowProviderFilters = [...rowProviderFilters, { source: '', target: '' }];
    emit([...rows, { source: '', target: '' }]);
  }

  function removeRow(index: number): void {
    rowProviderFilters = rowProviderFilters.filter((_, i) => i !== index);
    emit(rows.filter((_, i) => i !== index));
  }
</script>

<div class="space-y-2">
  {#if rows.length === 0}
    <div class="text-sm text-gray-500">{$_(i18nKey('empty'))}</div>
  {/if}

  {#each rows as row, index}
    <div class="space-y-2 rounded-lg border border-base-300 p-2">
      {#if showProviderFilters}
        <div class="grid grid-cols-[1fr_1fr_auto] gap-2 items-start">
          <div class="form-control w-full">
            <span class="label-text text-xs opacity-80 mb-1">{textOrFallback('sourceProviderFilter', 'Source provider filter')}</span>
            {#if normalizedSourceCatalogProvider}
              <div class="input input-bordered flex items-center bg-base-200/60 text-base-content/80">{normalizedSourceCatalogProvider}</div>
            {:else}
              <ComboInput
                value={getRowProviderFilter(index, 'source')}
                options={providerFilterOptions}
                allowCustom={false}
                placeholder={textOrFallback('allProviders', 'All providers')}
                on:change={(event) => updateRowProviderFilter(index, 'source', String(event.detail ?? ''))}
                on:select={(event) => updateRowProviderFilter(index, 'source', String(event.detail?.value ?? ''))}
              />
            {/if}
          </div>

          <div class="form-control w-full">
            <span class="label-text text-xs opacity-80 mb-1">{textOrFallback('targetProviderFilter', 'Target provider filter')}</span>
            {#if normalizedTargetCatalogProvider}
              <div class="input input-bordered flex items-center bg-base-200/60 text-base-content/80">{normalizedTargetCatalogProvider}</div>
            {:else}
              <ComboInput
                value={getRowProviderFilter(index, 'target')}
                options={providerFilterOptions}
                allowCustom={false}
                placeholder={textOrFallback('allProviders', 'All providers')}
                on:change={(event) => updateRowProviderFilter(index, 'target', String(event.detail ?? ''))}
                on:select={(event) => updateRowProviderFilter(index, 'target', String(event.detail?.value ?? ''))}
              />
            {/if}
          </div>

          <button class="btn btn-sm btn-ghost invisible pointer-events-none" type="button" aria-hidden="true">
            {$_('common.delete')}
          </button>
        </div>
      {/if}

      <div class="grid grid-cols-[1fr_1fr_auto] gap-2 items-start">
        <div class="min-w-0">
          <ComboInput
            value={row.source}
            options={rowOptions[index]?.source ?? []}
            allowCustom={true}
            placeholder={$_(i18nKey('sourceLabel'))}
            on:change={(event) => updateRow(index, 'source', String(event.detail ?? ''))}
          />
        </div>

        <div class="min-w-0">
          <ComboInput
            value={row.target}
            options={rowOptions[index]?.target ?? []}
            allowCustom={true}
            placeholder={$_(i18nKey('targetLabel'))}
            on:change={(event) => updateRow(index, 'target', String(event.detail ?? ''))}
          />
        </div>

        <button class="btn btn-sm btn-ghost text-error" type="button" on:click={() => removeRow(index)}>
          {$_('common.delete')}
        </button>
      </div>
    </div>
  {/each}

  <div class="flex items-center justify-between gap-2">
    <button class="btn btn-sm btn-outline" type="button" on:click={addRow}>
      {$_(i18nKey('addRow'))}
    </button>

    {#if loading}
      <span
        class="loading loading-spinner loading-xs text-base-content/50"
        aria-label="loading model catalog"
        title="loading"
      ></span>
    {/if}
  </div>
</div>
