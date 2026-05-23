<script lang="ts">
  import type { AuthConfig } from '../types';
  import { _ } from '../i18n';
  import { ExpressionInput } from './smart-input';

  export let value: AuthConfig | undefined = undefined;
  export let label: string = 'Authentication';
  export let showHelp: boolean = true;

  let enabled = false;
  let tokens: string[] = [];
  let initialized = false;

  // Reactive block for initialization and syncing
  $: {
    // Initialize from prop only once
    if (!initialized && value) {
      enabled = value.enabled || false;
      tokens = value.tokens ? [...value.tokens] : [];
      initialized = true;
    }

    // Update prop from local state reactively
    if (enabled) {
      const validTokens = tokens.filter(t => t.trim() !== '');
      if (!value) {
        value = { enabled: true, tokens: validTokens };
      } else {
        value.enabled = true;
        value.tokens = validTokens;
      }
    } else {
      if (value) {
        value.enabled = false;
        value.tokens = [];
      }
    }
  }

  function addToken() {
    tokens = [...tokens, ''];
    initialized = true; // Mark as initialized on user interaction
  }

  function removeToken(index: number) {
    tokens = tokens.filter((_, i) => i !== index);
  }
</script>

<div class="form-control w-full">
  <div class="label">
    <span class="label-text font-semibold">{label}</span>
    {#if showHelp}
      <span class="label-text-alt text-xs">
        {$_('auth.helpText')}
      </span>
    {/if}
  </div>

  <div class="space-y-4">
    <!-- Enable/Disable Checkbox -->
    <div class="form-control">
      <label class="label cursor-pointer justify-start gap-4">
        <input
          type="checkbox"
          class="checkbox"
          bind:checked={enabled}
          on:change={() => {
            if (enabled && tokens.length === 0) {
              tokens = [''];
            }
            initialized = true;
          }}
        />
        <span class="label-text">{$_('auth.enableAuth')}</span>
      </label>
    </div>

    {#if enabled}
      <!-- Tokens List -->
      <div class="collapse collapse-arrow bg-carbon-950/60 collapse-open">
        <div class="px-3 py-2 font-mono text-[11px] uppercase tracking-command text-zinc-200 border-b border-carbon-600">
          {$_('auth.tokens')} ({tokens.length})
        </div>
        <div class="p-3 space-y-2">
          <div class="text-xs text-base-content/60 bg-carbon-950/60 rounded p-3 flex gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-4 h-4 opacity-60">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <div>
              <div>{$_('auth.expressionSupport')}</div>
              <div class="mt-1">
                <code class="text-xs bg-carbon-700 px-1 rounded">{'{{ env.API_TOKEN }}'}</code>
              </div>
            </div>
          </div>

          {#each tokens as token, index}
            <div class="flex gap-2">
              <div class="flex-1">
                <ExpressionInput
                  size="sm"
                  placeholder={$_('auth.tokenPlaceholder')}
                  bind:value={tokens[index]}
                  inputClass="font-mono text-xs"
                />
              </div>
              <button
                type="button"
                class="inline-flex items-center justify-center h-9 w-9 border-2 border-red-500 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors"
                on:click={() => removeToken(index)}
              >
                ✕
              </button>
            </div>
          {/each}

          <button
            type="button"
            class="nx-btn-ghost nx-btn-sm"
            on:click={addToken}
          >
            + {$_('auth.addToken')}
          </button>
        </div>
      </div>

      <!-- Security Notice -->
      <div class="alert alert-warning shadow-sm text-xs">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-4 h-4">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
        <div>
          {$_('auth.securityNotice')}
        </div>
      </div>
    {/if}
  </div>
</div>
