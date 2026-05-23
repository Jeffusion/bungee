<script lang="ts">
  import { onMount } from 'svelte';
  import { _ } from '../lib/i18n';
  import { getConfig, updateConfig, validateConfig } from '../lib/api/config';
  import { reloadSystem, restartSystem } from '../lib/api/system';
  import { toast } from '../lib/stores/toast';
  import type { AppConfig } from '../lib/types';
  import AuthEditor from '../lib/components/AuthEditor.svelte';
  import LoggingEditor from '../lib/components/LoggingEditor.svelte';
  import ConfirmDialog from '../lib/components/ConfirmDialog.svelte';
  import {
    PanelCard,
    SegmentedControl,
    SystemAlertBar,
    IconButton,
  } from '../lib/components/industrial';

  let config: AppConfig | null = null;
  let editingConfig: AppConfig | null = null;
  let error: string | null = null;
  let loading = true;
  let reloading = false;
  let restarting = false;
  let saving = false;
  let editMode: 'form' | 'json' = 'form';
  let jsonText = '';
  let jsonError: string | null = null;
  let showRestartModal = false;

  async function loadConfig() {
    try {
      config = await getConfig();
      editingConfig = JSON.parse(JSON.stringify(config));
      jsonText = JSON.stringify(config, null, 2);
      error = null;
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  function handleJsonChange() {
    jsonError = null;
    try {
      editingConfig = JSON.parse(jsonText);
    } catch (e: any) {
      jsonError = e.message;
    }
  }

  async function handleSave() {
    if (!editingConfig) return;
    saving = true;
    try {
      const validation = await validateConfig(editingConfig);
      if (!validation.valid) {
        toast.show($_('configuration.validationFailed', { values: { error: validation.error } }), 'error');
        return;
      }
      const result = await updateConfig(editingConfig);
      if (result.success) {
        toast.show($_('configuration.saved'), 'success');
        config = JSON.parse(JSON.stringify(editingConfig));
      } else {
        toast.show($_('configuration.saveFailed', { values: { error: result.message } }), 'error');
      }
    } catch (e: any) {
      toast.show($_('configuration.saveFailed', { values: { error: e.message } }), 'error');
    } finally {
      saving = false;
    }
  }

  function handleExport() {
    if (!config) return;
    const dataStr = JSON.stringify(config, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const filename = `bungee-config-${new Date().toISOString().split('T')[0]}.json`;
    const a = document.createElement('a');
    a.setAttribute('href', dataUri);
    a.setAttribute('download', filename);
    a.click();
    toast.show($_('configuration.exported'), 'success');
  }

  function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        editingConfig = imported;
        jsonText = JSON.stringify(imported, null, 2);
        toast.show($_('configuration.imported'), 'success');
      } catch (err: any) {
        toast.show($_('configuration.importFailed', { values: { error: err.message } }), 'error');
      }
    };
    input.click();
  }

  async function handleReload() {
    reloading = true;
    try {
      const result = await reloadSystem();
      if (result.success) {
        toast.show($_('configuration.reloaded'), 'success');
        await loadConfig();
      } else {
        toast.show($_('configuration.reloadFailed', { values: { error: result.message } }), 'error');
      }
    } catch (e: any) {
      toast.show($_('configuration.reloadFailed', { values: { error: e.message } }), 'error');
    } finally {
      reloading = false;
    }
  }

  async function handleRestart() {
    showRestartModal = false;
    restarting = true;
    try {
      const result = await restartSystem();
      if (result.success) {
        toast.show($_('configuration.restartSent'), 'success');
      } else {
        if (result.error && result.error.includes('daemon mode')) {
          toast.show($_('configuration.restartDaemonOnly'), 'error', 8000);
        } else {
          toast.show($_('configuration.restartFailed', { values: { error: result.error || result.message } }), 'error');
        }
      }
    } catch (e: any) {
      toast.show($_('configuration.restartFailed', { values: { error: e.message } }), 'error');
    } finally {
      restarting = false;
    }
  }

  onMount(() => {
    loadConfig();
  });

  $: editModeOptions = [
    { value: 'form', label: $_('configuration.formEditor') },
    { value: 'json', label: $_('configuration.jsonEditor') },
  ];
</script>

<div class="px-6 py-5 space-y-5">
  <!-- ===== Header =============================================== -->
  <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
    <div class="flex items-center gap-3">
      <span class="nx-stripe" aria-hidden="true"></span>
      <div class="flex flex-col leading-tight">
        <span class="nx-label">// {$_('configuration.subtitle')}</span>
        <h1 class="nx-display text-xl text-zinc-50 tracking-[0.02em]">
          {$_('configuration.title')}
        </h1>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <IconButton title={$_('configuration.export')} on:click={handleExport} disabled={loading || !config}>
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
      </IconButton>
      <IconButton title={$_('configuration.import')} on:click={handleImport} disabled={loading}>
        <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
      </IconButton>
      <button class="nx-btn-ghost" on:click={handleReload} disabled={reloading || loading}>
        {#if reloading}
          <span class="inline-block h-3 w-3 border border-current border-t-transparent animate-spin"></span>
        {:else}
          <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2.4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        {/if}
        {$_('configuration.reload')}
      </button>
      <button class="nx-btn-warn" on:click={() => (showRestartModal = true)} disabled={restarting || loading}>
        {#if restarting}
          <span class="inline-block h-3 w-3 border border-current border-t-transparent animate-spin"></span>
        {:else}
          <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2.4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        {/if}
        {$_('configuration.restart')}
      </button>
      <button class="nx-btn-primary" on:click={handleSave} disabled={saving || loading || !!jsonError}>
        {#if saving}
          <span class="inline-block h-3 w-3 border border-current border-t-transparent animate-spin"></span>
        {:else}
          <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2.4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
          </svg>
        {/if}
        {$_('configuration.save')}
      </button>
    </div>
  </div>

  {#if loading}
    <PanelCard title={$_('configuration.title')} tag="LOADING">
      <div class="flex justify-center items-center h-40">
        <div class="flex flex-col items-center gap-3">
          <div class="relative h-10 w-10">
            <div class="absolute inset-0 border border-nexus-500/30"></div>
            <div class="absolute inset-0 border-t-2 border-nexus-500 animate-spin"></div>
          </div>
          <span class="nx-label">LOADING CONFIG</span>
        </div>
      </div>
    </PanelCard>
  {:else if error}
    <PanelCard title={$_('common.error')} tag="ERR" stripe="red">
      <p class="font-mono text-xs uppercase tracking-command text-red-300">{error}</p>
    </PanelCard>
  {:else if editingConfig}
    <!-- Editor mode selector -->
    <div class="flex items-center justify-between">
      <SegmentedControl options={editModeOptions} bind:value={editMode} ariaLabel="edit mode" />
    </div>

    {#if editMode === 'form'}
      <!-- ===== System settings ============================= -->
      <PanelCard title={$_('configuration.systemSettings')} tag="SYS">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label class="block space-y-1.5">
            <span class="nx-label">// {$_('configuration.serverPort')}</span>
            <input type="number" class="nx-input" bind:value={editingConfig.port} placeholder="8088" />
          </label>
          <label class="block space-y-1.5">
            <span class="nx-label">// {$_('configuration.workerProcesses')}</span>
            <input type="number" class="nx-input" bind:value={editingConfig.workers} min="1" placeholder="2" />
            <span class="font-mono text-[10px] uppercase tracking-command text-zinc-500">{$_('configuration.workerProcessesHelp')}</span>
          </label>
          <label class="block space-y-1.5">
            <span class="nx-label">// {$_('configuration.logLevel')}</span>
            <select class="nx-input pr-7" bind:value={editingConfig.log_level}>
              <option value="debug">Debug</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
            </select>
          </label>
          <label class="block space-y-1.5">
            <span class="nx-label">// {$_('configuration.bodyParserLimit')}</span>
            <input type="text" class="nx-input" bind:value={editingConfig.body_parser_limit} placeholder="50mb" />
            <span class="font-mono text-[10px] uppercase tracking-command text-zinc-500">{$_('configuration.bodyParserLimitHelp')}</span>
          </label>
        </div>
      </PanelCard>

      <!-- ===== Global auth ================================ -->
      <PanelCard title={$_('auth.globalAuth')} tag="AUTH" stripe={editingConfig.auth?.enabled ? 'orange' : 'zinc'}>
        <AuthEditor bind:value={editingConfig.auth} label={$_('auth.globalAuth')} />
      </PanelCard>

      <!-- ===== Logging ==================================== -->
      <PanelCard title={$_('logging.title')} tag="LOG">
        <LoggingEditor bind:value={editingConfig.logging} />
      </PanelCard>

      <!-- ===== Route management note ====================== -->
      <SystemAlertBar
        tone="info"
        title={$_('routes.title')}
        subtitle={`${$_('configuration.routesConfigured', { values: { count: editingConfig.routes.length } })} · ${$_('configuration.manageRoutes')}`}
      >
        <a slot="action" href="/__ui/#/routes" class="nx-btn-outline">
          <svg viewBox="0 0 24 24" class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2.4">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          {$_('routes.title')}
        </a>
      </SystemAlertBar>

      <SystemAlertBar
        tone="warn"
        title={$_('configuration.requiresRestart')}
        subtitle="Server / worker / log_level changes require a process restart."
      />
    {:else}
      <!-- ===== JSON editor ============================== -->
      <PanelCard title={$_('configuration.jsonConfiguration')} tag={jsonError ? 'PARSE-ERR' : 'JSON'} stripe={jsonError ? 'red' : 'orange'}>
        {#if jsonError}
          <div class="border-l-2 border-l-red-500 bg-red-500/5 px-3 py-2 mb-3">
            <p class="font-mono text-[11px] uppercase tracking-command text-red-300">
              {$_('configuration.jsonParseError', { values: { error: jsonError } })}
            </p>
          </div>
        {/if}

        <textarea
          class="nx-input py-2 resize-y h-96 leading-relaxed"
          bind:value={jsonText}
          on:input={handleJsonChange}
          placeholder={$_('configuration.jsonPlaceholder')}
          spellcheck="false"
        ></textarea>

        <p class="mt-2 font-mono text-[10px] uppercase tracking-command text-zinc-500">
          {$_('configuration.jsonHelp')}
        </p>
      </PanelCard>
    {/if}
  {/if}

  <!-- ===== Restart confirm ============================== -->
  <ConfirmDialog
    bind:open={showRestartModal}
    title={$_('configuration.confirmRestart')}
    message={`${$_('configuration.restartMessage')} · ${$_('configuration.restartWarning')}`}
    confirmText={$_('configuration.restart')}
    cancelText={$_('common.cancel')}
    confirmClass="btn-warn"
    on:confirm={handleRestart}
    on:cancel={() => (showRestartModal = false)}
  />
</div>
