<script lang="ts">
  import type { Route } from '../../api/routes';
  import { _ } from '../../i18n';

  export let route: Route;

  type ResponseRule = NonNullable<Route['response_rules']>[number];

  const directStatusCodes = [200, 404, 500, 503];
  const redirectStatusCodes = [301, 302, 307, 308];
  const contentTypes = ['text/plain', 'application/json', 'text/html'];
  const matchTypes: Array<NonNullable<ResponseRule['match_type']>> = ['exact', 'prefix', 'regex'];

  let activeIndex = 0;
  let newHeaderKey = '';
  let newHeaderValue = '';
  let activeRoute = route;

  function resolvePreviewPath(rule: ResponseRule): string {
    const rawPath = rule.path?.trim() || '/';
    const normalizedRulePath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const routePath = route.path === '/' ? '' : route.path.replace(/\/$/, '');

    if (rule.match_type === 'regex') {
      return `${routePath || '/'} ${$_('routeEditor.regexPattern')} ${rawPath}`;
    }

    if (routePath && normalizedRulePath.startsWith(`${routePath}/`)) {
      return normalizedRulePath;
    }

    return `${routePath}${normalizedRulePath}` || '/';
  }

  function ensureRules() {
    route.response_rules ??= [];

    if (route.response_rules.length === 0 && route.direct_response?.enabled) {
      route.response_rules = [{
        enabled: true,
        path: '/',
        match_type: 'prefix',
        type: 'direct_response',
        status: route.direct_response.status,
        body: route.direct_response.body,
        content_type: route.direct_response.content_type,
        headers: route.direct_response.headers,
      }];
    }

    if (route.response_rules.length === 0 && route.redirect?.enabled) {
      route.response_rules = [{
        enabled: true,
        path: '/',
        match_type: 'prefix',
        type: 'redirect',
        status: route.redirect.status,
        url: route.redirect.url,
        preserve_path: route.redirect.preserve_path,
      }];
    }

    route.direct_response = undefined;
    route.redirect = undefined;
  }

  ensureRules();

  $: if (route !== activeRoute) {
    activeRoute = route;
    activeIndex = 0;
    ensureRules();
  }

  $: rules = route.response_rules ?? [];
  $: activeRule = rules[activeIndex];
  $: previewPath = activeRule ? resolvePreviewPath(activeRule) : '';

  function addRule(type: ResponseRule['type'] = 'direct_response') {
    const rule: ResponseRule = type === 'redirect'
      ? { enabled: true, path: '/', match_type: 'exact', type, status: 302, url: '' }
      : { enabled: true, path: '/', match_type: 'exact', type, status: 200, body: '', content_type: 'text/plain', headers: {} };

    route.response_rules = [...(route.response_rules ?? []), rule];
    activeIndex = route.response_rules.length - 1;
  }

  function removeRule(index: number) {
    route.response_rules = (route.response_rules ?? []).filter((_, candidateIndex) => candidateIndex !== index);
    activeIndex = Math.max(0, Math.min(activeIndex, route.response_rules.length - 1));
  }

  function duplicateRule(index: number) {
    const source = route.response_rules?.[index];
    if (!source) return;
    route.response_rules = [...(route.response_rules ?? []), { ...source, headers: { ...(source.headers ?? {}) } }];
    activeIndex = route.response_rules.length - 1;
  }

  function addHeader(rule: ResponseRule) {
    if (!newHeaderKey.trim()) return;
    rule.headers = {
      ...(rule.headers || {}),
      [newHeaderKey.trim()]: newHeaderValue
    };
    newHeaderKey = '';
    newHeaderValue = '';
  }

  function removeHeader(rule: ResponseRule, key: string) {
    if (rule.headers) {
      const newHeaders = { ...rule.headers };
      delete newHeaders[key];
      rule.headers = newHeaders;
    }
  }
</script>

<div class="space-y-6">
  <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
    <div>
      <h3 class="text-lg font-semibold">{$_('routeEditor.directResponse')}</h3>
      <p class="text-sm text-zinc-500 mt-1">{$_('routeEditor.responseRulesHelp')}</p>
    </div>
    <div class="dropdown dropdown-end">
      <button type="button" tabindex="0" class="btn btn-sm btn-primary gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
        {$_('routeEditor.addResponseRule')}
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
      </button>
      <div class="dropdown-content z-[30] mt-2 w-96 rounded-box border border-carbon-600 bg-base-100 p-2 shadow-xl">
        <div class="px-2 pb-2 pt-1 text-xs font-semibold uppercase tracking-wide text-base-content/50">{$_('routeEditor.chooseResponseRuleType')}</div>
        <button type="button" class="group flex w-full items-start gap-3 rounded-box p-3 text-left transition-colors hover:bg-primary/10" on:click={() => addRule('direct_response')}>
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-box bg-success/15 text-success group-hover:bg-success group-hover:text-success-content">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </span>
          <span class="min-w-0">
            <span class="block font-semibold">{$_('routeEditor.directResponseMode')}</span>
            <span class="mt-1 block text-sm text-base-content/60">{$_('routeEditor.directResponseRuleDescription')}</span>
          </span>
        </button>
        <button type="button" class="group mt-1 flex w-full items-start gap-3 rounded-box p-3 text-left transition-colors hover:bg-primary/10" on:click={() => addRule('redirect')}>
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-box bg-secondary/15 text-secondary group-hover:bg-secondary group-hover:text-secondary-content">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h6m0 0v6m0-6L10 16m-5 1V7a2 2 0 012-2h5" /></svg>
          </span>
          <span class="min-w-0">
            <span class="block font-semibold">{$_('routeEditor.redirectMode')}</span>
            <span class="mt-1 block text-sm text-base-content/60">{$_('routeEditor.redirectRuleDescription')}</span>
          </span>
        </button>
      </div>
    </div>
  </div>

  {#if rules.length === 0}
    <div class="rounded-box border border-dashed border-carbon-600 bg-base-100/60 p-8 text-center">
      <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>
      </div>
      <div class="font-semibold">{$_('routeEditor.noResponseRulesTitle')}</div>
      <p class="mx-auto mt-2 max-w-xl text-sm text-base-content/60">{$_('routeEditor.noResponseRules')}</p>
      <div class="dropdown dropdown-center mt-5">
        <button type="button" tabindex="0" class="btn btn-sm btn-primary gap-2">
          {$_('routeEditor.addResponseRule')}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
        </button>
        <div class="dropdown-content z-[30] mt-2 w-96 rounded-box border border-carbon-600 bg-base-100 p-2 text-left shadow-xl">
          <button type="button" class="group flex w-full items-start gap-3 rounded-box p-3 transition-colors hover:bg-primary/10" on:click={() => addRule('direct_response')}>
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-box bg-success/15 text-success group-hover:bg-success group-hover:text-success-content">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
            </span>
            <span><span class="block font-semibold">{$_('routeEditor.directResponseMode')}</span><span class="mt-1 block text-sm text-base-content/60">{$_('routeEditor.directResponseRuleDescription')}</span></span>
          </button>
          <button type="button" class="group mt-1 flex w-full items-start gap-3 rounded-box p-3 transition-colors hover:bg-primary/10" on:click={() => addRule('redirect')}>
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-box bg-secondary/15 text-secondary group-hover:bg-secondary group-hover:text-secondary-content">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h6m0 0v6m0-6L10 16m-5 1V7a2 2 0 012-2h5" /></svg>
            </span>
            <span><span class="block font-semibold">{$_('routeEditor.redirectMode')}</span><span class="mt-1 block text-sm text-base-content/60">{$_('routeEditor.redirectRuleDescription')}</span></span>
          </button>
        </div>
      </div>
    </div>
  {:else}
    <div class="grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-4">
      <div class="space-y-2">
        {#each rules as rule, index}
          <button
            type="button"
            class="group relative w-full overflow-hidden rounded-box border p-3 pl-4 text-left transition-all duration-150 hover:border-primary/60 hover:bg-primary/5"
            class:border-primary={activeIndex === index}
            class:bg-base-100={activeIndex === index}
            class:shadow-sm={activeIndex === index}
            class:border-carbon-600={activeIndex !== index}
            class:bg-carbon-800={activeIndex !== index}
            on:click={() => activeIndex = index}
          >
            <span
              class="absolute bottom-3 left-0 top-3 w-1 rounded-r-full transition-colors"
              class:bg-primary={activeIndex === index}
              class:bg-transparent={activeIndex !== index}
            ></span>
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <span class="block truncate text-base font-semibold text-base-content">{rule.path || $_('routeEditor.responseRulePathPlaceholder')}</span>
                <span class="mt-1 block text-xs text-base-content/55">
                  {$_(`routeEditor.matchType_${rule.match_type ?? 'exact'}`)} · {rule.enabled ? $_('auth.enabled') : $_('routeEditor.upstreamDisabled')}
                </span>
              </div>
              <span
                class="badge badge-sm shrink-0 border"
                class:badge-success={rule.type === 'direct_response' && activeIndex !== index}
                class:badge-secondary={rule.type === 'redirect' && activeIndex !== index}
                class:border-primary={activeIndex === index}
                class:bg-primary={activeIndex === index}
                class:text-primary-content={activeIndex === index}
              >
                {rule.type === 'direct_response' ? $_('routeEditor.directResponseMode') : $_('routeEditor.redirectMode')}
              </span>
            </div>
          </button>
        {/each}
      </div>

      {#if activeRule}
        <div class="card bg-base-100 border border-carbon-600 shadow-sm">
          <div class="card-body p-4 space-y-5">
            <div class="flex items-start justify-between gap-4 border-b border-carbon-600 pb-4">
              <div class="min-w-0 space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                  <h4 class="truncate text-lg font-semibold">{activeRule.path || $_('routeEditor.responseRulePathPlaceholder')}</h4>
                  <span
                    class="nx-feature-tag"
                    class:badge-success={activeRule.type === 'direct_response'}
                    class:badge-secondary={activeRule.type === 'redirect'}
                  >
                    {activeRule.type === 'direct_response' ? $_('routeEditor.directResponseMode') : $_('routeEditor.redirectMode')}
                  </span>
                </div>
                <label class="label cursor-pointer justify-start gap-3 p-0">
                  <input type="checkbox" class="toggle toggle-primary toggle-sm" bind:checked={activeRule.enabled} />
                  <span class="label-text text-sm font-semibold">{$_('routeEditor.enableResponseRule')}</span>
                </label>
              </div>
              <div class="flex gap-2">
                <button type="button" class="btn btn-xs btn-outline btn-square" on:click={() => duplicateRule(activeIndex)} aria-label={$_('routeEditor.duplicateRule')} title={$_('routeEditor.duplicateRule')}>
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                </button>
                <button type="button" class="btn btn-xs btn-error btn-square text-error-content" on:click={() => removeRule(activeIndex)} aria-label={$_('common.delete')} title={$_('common.delete')}>
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m2 0H7m3-3h4a1 1 0 011 1v2H9V5a1 1 0 011-1z" /></svg>
                </button>
              </div>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div class="form-control w-full">
                <label class="label" for="response-rule-path"><span class="label-text font-semibold">{$_('routeEditor.responseRulePath')}</span></label>
                <input id="response-rule-path" type="text" class="nx-input w-full" bind:value={activeRule.path} placeholder={$_('routeEditor.responseRulePathPlaceholder')} />
                <div class="label"><span class="label-text-alt">{$_('routeEditor.responseRulePathHelp')}</span></div>
              </div>
              <div class="form-control w-full">
                <label class="label" for="response-rule-match-type"><span class="label-text font-semibold">{$_('routeEditor.matchType')}</span></label>
                <select id="response-rule-match-type" class="nx-input pr-7 w-full" bind:value={activeRule.match_type}>
                  {#each matchTypes as matchType}
                    <option value={matchType}>{$_(`routeEditor.matchType_${matchType}`)}</option>
                  {/each}
                </select>
              </div>
            </div>

            <div class="rounded-box border border-carbon-600 bg-carbon-950/60/60 px-3 py-2 text-sm text-base-content/70">
              <span class="font-semibold text-base-content">{$_('routeEditor.effectiveMatchPath')}:</span>
              <code class="ml-2 rounded bg-carbon-700 px-2 py-0.5 font-mono text-base-content">{previewPath}</code>
            </div>

            {#if activeRule.type === 'direct_response'}
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="form-control w-full">
                  <label class="label" for="response-rule-direct-status"><span class="label-text font-semibold">{$_('routeEditor.statusCode')}</span></label>
                  <select id="response-rule-direct-status" class="nx-input pr-7 w-full" bind:value={activeRule.status}>
                    {#each directStatusCodes as code}
                      <option value={code}>{code}</option>
                    {/each}
                  </select>
                </div>
                <div class="form-control w-full">
                  <label class="label" for="response-rule-content-type"><span class="label-text font-semibold">{$_('routeEditor.contentType')}</span></label>
                  <select id="response-rule-content-type" class="nx-input pr-7 w-full" bind:value={activeRule.content_type}>
                    {#each contentTypes as type}
                      <option value={type}>{type}</option>
                    {/each}
                  </select>
                </div>
              </div>

              <div class="form-control w-full">
                <label class="label" for="response-rule-body"><span class="label-text font-semibold">{$_('routeEditor.responseBody')}</span></label>
                <textarea id="response-rule-body" class="nx-input py-2 resize-y h-32 font-mono text-sm" bind:value={activeRule.body} placeholder={$_('body.placeholder')}></textarea>
              </div>

              <div class="form-control w-full">
                <div class="label"><span class="label-text font-semibold">{$_('routeEditor.customHeaders')}</span></div>
                <div class="space-y-2">
                  {#each Object.entries(activeRule.headers || {}) as [key, value]}
                    <div class="flex gap-2 items-center">
                      <div class="badge badge-neutral gap-2 py-3 px-4 flex-1 justify-between">
                        <span class="font-mono">{key}: {value}</span>
                        <button type="button" class="inline-flex items-center justify-center h-5 w-5 text-zinc-500 hover:text-red-300 transition-colors" on:click={() => removeHeader(activeRule, key)} aria-label={$_('common.delete')} title={$_('common.delete')}>
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                      </div>
                    </div>
                  {/each}
                  <div class="join w-full">
                    <input type="text" class="nx-input join-item w-1/3" placeholder="Key" bind:value={newHeaderKey} />
                    <input type="text" class="nx-input join-item flex-1" placeholder="Value" bind:value={newHeaderValue} on:keydown={(e) => e.key === 'Enter' && addHeader(activeRule)} />
                    <button type="button" class="btn btn-sm join-item" on:click={() => addHeader(activeRule)}>{$_('common.add')}</button>
                  </div>
                </div>
              </div>
            {:else}
              <div class="form-control w-full">
                <label class="label" for="response-rule-redirect-url"><span class="label-text font-semibold">{$_('routeEditor.redirectUrl')}</span></label>
                <input id="response-rule-redirect-url" type="text" class="nx-input w-full" bind:value={activeRule.url} placeholder="https://example.com/new-path" />
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="form-control w-full">
                  <label class="label" for="response-rule-redirect-status"><span class="label-text font-semibold">{$_('routeEditor.statusCode')}</span></label>
                  <select id="response-rule-redirect-status" class="nx-input pr-7 w-full" bind:value={activeRule.status}>
                    {#each redirectStatusCodes as code}
                      <option value={code}>{code}</option>
                    {/each}
                  </select>
                </div>
                <div class="form-control rounded-box border border-carbon-600 bg-carbon-950/60/50 px-3 py-2">
                  <label class="label cursor-pointer justify-between gap-4 p-0">
                    <span>
                      <span class="block font-semibold">{$_('routeEditor.preservePath')}</span>
                      <span class="block text-xs text-base-content/60">{$_('routeEditor.preservePathHelp')}</span>
                    </span>
                    <input type="checkbox" class="toggle toggle-primary toggle-sm" bind:checked={activeRule.preserve_path} />
                  </label>
                </div>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
