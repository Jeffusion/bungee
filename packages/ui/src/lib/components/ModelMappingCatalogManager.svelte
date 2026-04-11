<script lang="ts">
  import { onMount } from 'svelte';
  import { PluginsAPI, type ModelMappingCatalogStatus } from '../api/plugins';
  import { _ } from '../i18n';
  import { toast } from '../stores/toast';

  let loading = true;
  let refreshing = false;
  let status: ModelMappingCatalogStatus | null = null;

  let searchQuery = '';
  let selectedProvider = '';
  let providerFilter = '';
  let showProviderDropdown = false;
  let providerDropdownRef: HTMLElement | null = null;
  
  let currentPage = 1;
  const itemsPerPage = 50;

  async function loadStatus(): Promise<void> {
    loading = true;
    try {
      status = await PluginsAPI.getModelMappingCatalogStatus();
    } catch (error: any) {
      toast.show(`${$_('common.error')}: ${error.message}`, 'error');
    } finally {
      loading = false;
    }
  }

  async function refreshCatalog(): Promise<void> {
    refreshing = true;
    try {
      status = await PluginsAPI.refreshModelMappingCatalog();
      toast.show($_('plugins.modelMappingCatalog.refreshSuccess'), 'success');
      currentPage = 1;
    } catch (error: any) {
      toast.show(`${$_('plugins.modelMappingCatalog.refreshFailed')}: ${error.message}`, 'error');
    } finally {
      refreshing = false;
    }
  }

  function formatTime(timestamp: number | null): string {
    if (!timestamp) {
      return $_('plugins.modelMappingCatalog.neverRefreshed');
    }

    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(timestamp);
  }

  $: filteredModels = (status?.models || []).filter((model: any) => {
    const matchesSearch = !searchQuery || 
      model.label.toLowerCase().includes(searchQuery.toLowerCase()) || 
      model.value.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesProvider = !selectedProvider || model.provider === selectedProvider;
    return matchesSearch && matchesProvider;
  });

  $: filteredProviders = (status?.providers || []).filter((p: string) =>
    !providerFilter || p.toLowerCase().includes(providerFilter.toLowerCase())
  );

  $: totalPages = Math.ceil(filteredModels.length / itemsPerPage) || 1;
  $: paginatedModels = filteredModels.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  $: {
    if (searchQuery !== undefined || selectedProvider !== undefined) {
      currentPage = 1;
    }
  }

  function selectProvider(provider: string): void {
    selectedProvider = provider;
    providerFilter = '';
    showProviderDropdown = false;
  }

  function clearProvider(): void {
    selectedProvider = '';
    providerFilter = '';
    showProviderDropdown = false;
  }

  function handleProviderKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      showProviderDropdown = false;
      providerFilter = '';
    } else if (event.key === 'Enter' && filteredProviders.length > 0) {
      selectProvider(filteredProviders[0]);
    }
  }

  function handleGlobalClick(event: MouseEvent): void {
    if (providerDropdownRef && !providerDropdownRef.contains(event.target as Node)) {
      showProviderDropdown = false;
    }
  }

  onMount(() => {
    loadStatus();
    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
  });
</script>

<div class="p-6 space-y-6">
  <div class="flex items-start justify-between gap-4">
    <div>
      <h2 class="text-2xl font-semibold">{$_('plugins.modelMappingCatalog.title')}</h2>
      <p class="text-sm text-base-content/70 mt-1">{$_('plugins.modelMappingCatalog.description')}</p>
    </div>

    <button class="btn btn-primary btn-sm" on:click={refreshCatalog} disabled={refreshing || loading}>
      {#if refreshing}
        <span class="loading loading-spinner loading-xs"></span>
      {/if}
      {$_('plugins.modelMappingCatalog.refreshAction')}
    </button>
  </div>

  {#if loading}
    <div class="flex justify-center items-center h-48">
      <span class="loading loading-spinner loading-lg"></span>
    </div>
  {:else if status}
    <!-- Summary Stats -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div class="card bg-base-200">
        <div class="card-body p-4">
          <div class="text-sm text-base-content/60">{$_('plugins.modelMappingCatalog.catalogSource')}</div>
          <div class="mt-2">
            {#if status.source === 'stored'}
              <span class="badge badge-success badge-lg">{$_('plugins.modelMappingCatalog.sourceStored')}</span>
            {:else}
              <span class="badge badge-warning badge-lg">{$_('plugins.modelMappingCatalog.sourceStatic')}</span>
            {/if}
          </div>
        </div>
      </div>

      <div class="card bg-base-200">
        <div class="card-body p-4">
          <div class="text-sm text-base-content/60">{$_('plugins.modelMappingCatalog.modelCount')}</div>
          <div class="text-3xl font-semibold mt-2">{status.modelCount}</div>
        </div>
      </div>

      <div class="card bg-base-200">
        <div class="card-body p-4">
          <div class="text-sm text-base-content/60">{$_('plugins.modelMappingCatalog.providerCount')}</div>
          <div class="text-3xl font-semibold mt-2">{status.providerCount}</div>
        </div>
      </div>

      <div class="card bg-base-200">
        <div class="card-body p-4">
          <div class="text-sm text-base-content/60">{$_('plugins.modelMappingCatalog.lastRefresh')}</div>
          <div class="font-medium mt-2">{formatTime(status.fetchedAt)}</div>
        </div>
      </div>
    </div>

    {#if status.source === 'static'}
      <div class="alert alert-warning">
        <span>{$_('plugins.modelMappingCatalog.staticHint')}</span>
      </div>
    {:else}
      <div class="alert alert-success">
        <span>{$_('plugins.modelMappingCatalog.storedHint')}</span>
      </div>
    {/if}

    <!-- Filter Bar -->
    <div class="flex flex-col sm:flex-row gap-4 items-center justify-between bg-base-100 p-4 rounded-xl border border-base-200">
      <div class="flex gap-4 w-full sm:w-auto flex-1">
        <div class="relative w-full sm:w-64" bind:this={providerDropdownRef}>
          <div class="flex items-center gap-1">
            <input
              type="text"
              class="input input-bordered w-full"
              placeholder={selectedProvider || $_('plugins.modelMappingCatalog.allProviders')}
              bind:value={providerFilter}
              on:focusin={() => showProviderDropdown = true}
              on:keydown={handleProviderKeydown}
            />
            {#if selectedProvider}
              <button class="btn btn-ghost btn-xs btn-circle" on:click={clearProvider} title="Clear">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
            {/if}
          </div>
          {#if showProviderDropdown && filteredProviders.length > 0}
            <ul class="absolute z-50 left-0 right-0 mt-1 bg-base-100 border border-base-200 rounded-box shadow-lg max-h-60 overflow-y-auto">
              <li>
                <button
                  class="w-full text-left px-4 py-2 hover:bg-base-200 text-sm {!selectedProvider ? 'font-semibold bg-base-200/50' : ''}"
                  on:click={() => selectProvider('')}
                >
                  {$_('plugins.modelMappingCatalog.allProviders')}
                </button>
              </li>
              {#each filteredProviders as provider}
                <li>
                  <button
                    class="w-full text-left px-4 py-2 hover:bg-base-200 text-sm {selectedProvider === provider ? 'font-semibold bg-base-200/50' : ''}"
                    on:click={() => selectProvider(provider)}
                  >
                    {provider}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
        
        <div class="relative w-full">
          <input 
            type="text" 
            placeholder={$_('plugins.modelMappingCatalog.searchModels')} 
            class="input input-bordered w-full pl-10"
            bind:value={searchQuery}
          />
          <svg class="w-5 h-5 absolute left-3 top-3 text-base-content/50" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
        </div>
      </div>
      <div class="text-sm text-base-content/70 whitespace-nowrap">
        {$_('plugins.modelMappingCatalog.showingModels').replace('{count}', String(filteredModels.length)).replace('{total}', String(status.models.length))}
      </div>
    </div>

    <!-- Models Table -->
    <div class="card bg-base-100 border border-base-200 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="table w-full">
          <thead>
            <tr class="bg-base-200/50">
              <th class="w-1/4">{$_('plugins.modelMappingCatalog.provider')}</th>
              <th class="w-1/3">{$_('plugins.modelMappingCatalog.modelId')}</th>
              <th class="w-auto">{$_('plugins.modelMappingCatalog.modelName')}</th>
            </tr>
          </thead>
          <tbody>
            {#if paginatedModels.length === 0}
              <tr>
                <td colspan="3" class="text-center py-12 text-base-content/50">
                  {$_('plugins.modelMappingCatalog.noModelsFound')}
                </td>
              </tr>
            {:else}
              {#each paginatedModels as model}
                <tr class="hover">
                  <td>
                    {#if model.provider}
                      <span class="badge badge-outline">{model.provider}</span>
                    {:else}
                      <span class="text-base-content/40">-</span>
                    {/if}
                  </td>
                  <td>
                    <code class="text-xs bg-base-200 px-1.5 py-0.5 rounded break-all">{model.value}</code>
                  </td>
                  <td>
                    <div class="font-medium">{model.label}</div>
                    {#if model.description}
                      <div class="text-xs text-base-content/60 mt-1">{model.description}</div>
                    {/if}
                  </td>
                </tr>
              {/each}
            {/if}
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      {#if totalPages > 1}
        <div class="card-body p-4 border-t border-base-200 flex flex-row justify-between items-center bg-base-100">
          <div class="text-sm text-base-content/60">
            Page {currentPage} of {totalPages}
          </div>
          <div class="join">
            <button 
              class="join-item btn btn-sm" 
              disabled={currentPage === 1}
              on:click={() => currentPage--}
            >
              «
            </button>
            <button class="join-item btn btn-sm disabled">
              {currentPage}
            </button>
            <button 
              class="join-item btn btn-sm" 
              disabled={currentPage === totalPages}
              on:click={() => currentPage++}
            >
              »
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
