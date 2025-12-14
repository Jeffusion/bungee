<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from '../lib/i18n';
  import { PluginsAPI, type Plugin } from '../lib/api/plugins';
  import { toast } from '../lib/stores/toast';
  import { pluginList, pluginsLoading, refreshPlugins, updatePluginState } from '../lib/stores/plugins';

  let processing = false;

  async function togglePlugin(plugin: Plugin) {
    processing = true;
    try {
      if (plugin.enabled) {
        await PluginsAPI.disable(plugin.name);
      } else {
        await PluginsAPI.enable(plugin.name);
      }

      // I18n for toast messages
      const newStatus = !plugin.enabled;
      const pluginDisplayName = $_(plugin.metadata?.name) || plugin.name;
      const statusText = newStatus ? $_('plugins.enabled') : $_('plugins.disabled');
      toast.show(`${pluginDisplayName}: ${statusText}`, 'success');

      // 1. Optimistic Update (Immediate UI response)
      updatePluginState(plugin.name, newStatus);

      // 2. Delayed background refresh to sync with backend restart/reload
      setTimeout(() => {
        refreshPlugins(true); // Silent refresh
      }, 1500);

    } catch (e: any) {
      toast.show($_('common.error') + ': ' + e.message, 'error');
      // Revert/Sync on error
      await refreshPlugins();
    } finally {
      processing = false;
    }
  }

  onMount(() => {
    refreshPlugins();
  });
</script>

<div class="p-6">
  <div class="flex justify-between items-center mb-6">
    <div>
      <h1 class="text-3xl font-bold">{$_('plugins.title')}</h1>
      <p class="text-sm text-gray-500 mt-1">{$_('plugins.subtitle')}</p>
    </div>
    <button class="btn btn-primary btn-sm" on:click={refreshPlugins} disabled={$pluginsLoading}>
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      {$_('common.refresh')}
    </button>
  </div>

  {#if $pluginsLoading}
    <div class="flex justify-center items-center h-64">
      <span class="loading loading-spinner loading-lg"></span>
    </div>
  {:else if $pluginList.length === 0}
    <div class="text-center py-12">
      <div class="text-6xl mb-4">🧩</div>
      <h3 class="text-xl font-semibold mb-2">{$_('plugins.noPlugins')}</h3>
      <p class="text-gray-500">{$_('plugins.noPluginsDesc')}</p>
    </div>
  {:else}
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {#each $pluginList as plugin}
        <div class="card bg-base-100 shadow-xl border border-base-200">
          <div class="card-body">
            <div class="flex justify-between items-start">
              <div class="flex items-center gap-3">
                <div class="avatar placeholder">
                  <div class="bg-neutral-focus text-neutral-content rounded-full w-12 h-12 flex items-center justify-center">
                    {#if plugin.metadata?.icon && plugin.metadata.icon.startsWith('<svg')}
                      {@html plugin.metadata.icon}
                    {:else if plugin.metadata?.icon}
                      <span class="material-icons">{plugin.metadata.icon}</span>
                    {:else}
                      <span class="text-xl">{plugin.name ? plugin.name[0].toUpperCase() : '?'}</span>
                    {/if}
                  </div>
                </div>
                <div>
                  <h2 class="card-title text-lg">
                    {$_(plugin.metadata?.name) || plugin.name}
                  </h2>
                  <div class="flex items-center gap-2">
                    <span class="badge badge-sm badge-ghost">v{plugin.version || '0.0.0'}</span>
                    {#if plugin.enabled}
                      <span class="badge badge-sm badge-success">{$_('plugins.enabled')}</span>
                    {:else}
                      <span class="badge badge-sm badge-ghost">{$_('plugins.disabled')}</span>
                    {/if}
                  </div>
                </div>
              </div>
            </div>

            <p class="text-sm text-gray-500 mt-2 min-h-[40px]">
              {$_(plugin.description) || $_('plugins.noDescription')}
            </p>

            <div class="card-actions justify-between mt-4 items-center">
              <div class="form-control">
                <label class="label cursor-pointer gap-2">
                  <span class="label-text text-xs">{$_('plugins.enable')}</span>
                  <input
                    type="checkbox"
                    class="toggle toggle-sm toggle-primary"
                    checked={plugin.enabled}
                    on:change={() => togglePlugin(plugin)}
                    disabled={processing}
                  />
                </label>
              </div>

              <div class="flex gap-2">
                {#if (plugin.metadata?.contributes?.settings || plugin.metadata?.ui?.settings) && plugin.enabled}
                  {@const settingsPath = plugin.metadata?.contributes?.settings || plugin.metadata?.ui?.settings}
                  <a href={`/__ui/#/plugins/${plugin.name}${settingsPath}`} class="btn btn-sm btn-outline">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {$_('plugins.settings')}
                  </a>
                {/if}
              </div>
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
