<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { _ } from '../i18n';
  import type { Upstream } from '../api/routes';
  import { getEndpointPreview } from '../utils/route-service-view-model';

  const dispatch = createEventDispatcher<{
    overflowClick: void;
  }>();

  export let endpoints: Upstream[] = [];
  export let limit = 3;
  export let className = '';

  $: preview = getEndpointPreview(endpoints, limit);

  function getUpstreamStatus(upstream: Upstream): 'healthy' | 'unhealthy' | 'half_open' | 'disabled' {
    if (upstream.is_disabled) {
      return 'disabled';
    }
    if (!upstream.status || upstream.status === 'HEALTHY') {
      return 'healthy';
    }
    return upstream.status === 'HALF_OPEN' ? 'half_open' : 'unhealthy';
  }

  function handleOverflowClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    dispatch('overflowClick');
  }
</script>

<div class={`flex flex-col gap-1.5 ${className}`} data-testid="endpoint-quick-preview">
  {#each preview.items as upstream}
    <div 
      class="flex items-center justify-between gap-2 text-xs py-0.5 px-1 rounded hover:bg-base-200/50 transition-colors"
      class:opacity-50={upstream.is_disabled}
      data-testid="endpoint-preview-item"
    >
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <div
          class="w-2 h-2 rounded-full flex-shrink-0"
          class:bg-success={getUpstreamStatus(upstream) === 'healthy'}
          class:bg-error={getUpstreamStatus(upstream) === 'unhealthy'}
          class:bg-warning={getUpstreamStatus(upstream) === 'half_open'}
          class:bg-gray-400={getUpstreamStatus(upstream) === 'disabled'}
          title={upstream.is_disabled ? $_('upstream.disabled') : upstream.status === 'HALF_OPEN' ? $_('upstreamsModal.statusHalfOpen') : upstream.status === 'UNHEALTHY' ? $_('upstreamsModal.statusUnhealthy') : $_('upstreamsModal.statusHealthy')}
        ></div>
        <code class="truncate font-mono text-base-content/80" title={upstream.target}>
          {upstream.target}
        </code>
      </div>
      
      <div class="flex items-center gap-2 flex-shrink-0 text-base-content/60">
        {#if upstream.weight !== undefined}
          <span title={$_('upstream.weight')}>w:{upstream.weight}</span>
        {/if}
        {#if upstream.priority !== undefined}
          <span title={$_('upstream.priority')}>p:{upstream.priority}</span>
        {/if}
      </div>
    </div>
  {/each}

  {#if preview.overflowCount > 0}
    <button
      type="button"
      class="btn btn-xs btn-ghost btn-outline border-base-content/20 hover:border-primary hover:bg-primary/10 hover:text-primary text-xs w-full mt-1"
      on:click={handleOverflowClick}
      data-testid="endpoint-overflow"
    >
      {$_('endpointPreview.overflow', { values: { count: preview.overflowCount } })}
    </button>
  {/if}
</div>
