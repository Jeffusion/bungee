<script lang="ts">
  import { onMount } from 'svelte';
  import { location, replace } from 'svelte-spa-router';
  import { _ } from '../lib/i18n';
  import { PluginsAPI, type Plugin } from '../lib/api/plugins';
  import ModelMappingCatalogManager from '../lib/components/ModelMappingCatalogManager.svelte';
  import PluginHost from '../lib/components/PluginHost.svelte';
  import { toast } from '../lib/stores/toast';
  import { getPluginText } from '../lib/utils/plugin-i18n';

  export let params: { name: string; path?: string } = { name: '' };

  let plugin: Plugin | null = null;
  let loading = true;
  let activeTabPath = '';

  $: {
    const fullPath = $location;
    const prefix = `/plugins/${params.name}`;
    let internalPath = fullPath.replace(prefix, '');
    if (internalPath.startsWith('/')) internalPath = internalPath.substring(1);

    activeTabPath = '/' + internalPath;

    if (plugin && (!internalPath || internalPath === '') && !loading) {
       redirectToDefaultTab();
    }
  }

  async function loadPlugin() {
    loading = true;
    try {
      const plugins = await PluginsAPI.list();
      plugin = plugins.find(p => p.name === params.name) || null;

      if (!plugin) {
        toast.show(`Plugin ${params.name} not found`, 'error');
      } else {
        const prefix = `/plugins/${params.name}`;
        const internalPath = $location.replace(prefix, '');
        if (!internalPath || internalPath === '/') {
           redirectToDefaultTab();
        }
      }
    } catch (e: any) {
      toast.show('Failed to load plugin details: ' + e.message, 'error');
    } finally {
      loading = false;
    }
  }

  function redirectToDefaultTab() {
     if (!plugin) return;

     if (plugin.metadata?.contributes?.settings || plugin.metadata?.ui?.settings) {
        const settingsPath = plugin.metadata?.contributes?.settings || plugin.metadata?.ui?.settings;
        replace(`/plugins/${plugin.name}${settingsPath}`);
        return;
     }

     // Only redirect to settings
  }

  onMount(() => {
    loadPlugin();
  });
</script>

<div class="p-6">
  {#if loading}
    <div class="flex justify-center items-center h-64">
      <span class="loading loading-spinner loading-lg"></span>
    </div>
  {:else if !plugin}
    <div class="text-center py-12">
      <h3 class="text-xl font-semibold mb-2">{$_('plugins.notFound')}</h3>
      <a href="/__ui/#/plugins" class="btn btn-primary btn-sm">{$_('plugins.backToPlugins')}</a>
    </div>
  {:else}
    <!-- Header -->
    <div class="flex items-center gap-4 mb-6">
       <div class="avatar placeholder">
        <div class="bg-neutral-focus text-neutral-content rounded-full w-16 h-16 flex items-center justify-center text-2xl">
          {#if plugin.metadata?.icon && plugin.metadata.icon.startsWith('<svg')}
            {@html plugin.metadata.icon}
          {:else if plugin.metadata?.icon}
            <span class="material-icons text-3xl">{plugin.metadata.icon}</span>
          {:else}
            <span>{plugin.name[0].toUpperCase()}</span>
          {/if}
        </div>
      </div>
      <div>
        <h1 class="text-3xl font-bold flex items-center gap-3">
          {getPluginText(plugin.metadata?.name, plugin.name, $_) || plugin.name}
          <span class="badge badge-lg badge-ghost">v{plugin.version || '0.0.0'}</span>
           {#if plugin.enabled}
              <span class="badge badge-lg badge-success">{$_('plugins.enabled')}</span>
            {:else}
              <span class="badge badge-lg badge-ghost">{$_('plugins.disabled')}</span>
            {/if}
        </h1>
        <p class="text-gray-500 mt-1">{getPluginText(plugin.metadata?.description, plugin.name, $_) || $_('plugins.noDescription')}</p>
      </div>
    </div>

    <!-- Content -->
    <div class="bg-base-100 rounded-box shadow-xl border border-base-200 min-h-[500px] overflow-hidden">
       {#if plugin.name === 'model-mapping' && activeTabPath === '/catalog'}
         <ModelMappingCatalogManager />
       {:else if activeTabPath}
          <PluginHost pluginName={plugin.name} path={activeTabPath} />
        {:else}
         <div class="flex justify-center items-center h-64 text-gray-400">
           Select a tab to view content
         </div>
       {/if}
    </div>
  {/if}
</div>
