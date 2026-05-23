<script lang="ts">
  import type { Service } from '../api/services';
  import type { StickySessionConfig } from '../api/routes';
  import { _ } from '../i18n';

  export let service: Service;

  let stickySessionEnabled = false;
  let stickySessionExpression = '';

  $: stickySessionEnabled = service.sticky_session?.enabled === true;
  $: stickySessionExpression = service.sticky_session?.key_expression ?? '';

  function setStickyEnabled(enabled: boolean): void {
    const current = service.sticky_session;
    const next: StickySessionConfig = { enabled };

    if (current?.key_expression) {
      next.key_expression = current.key_expression;
    }

    service = {
      ...service,
      sticky_session: next
    };
  }

  function setStickyKeyExpression(value: string): void {
    const current = service.sticky_session;
    const next: StickySessionConfig = {
      enabled: current?.enabled ?? true
    };

    if (value.trim().length > 0) {
      next.key_expression = value;
    }

    service = {
      ...service,
      sticky_session: next
    };
  }

  function handleStickyEnabledChange(event: Event): void {
    if (event.currentTarget instanceof HTMLInputElement) {
      setStickyEnabled(event.currentTarget.checked);
    }
  }

  function handleStickyExpressionInput(event: Event): void {
    if (event.currentTarget instanceof HTMLInputElement) {
      setStickyKeyExpression(event.currentTarget.value);
    }
  }
</script>

<div class="space-y-4">
  <div class="form-control">
    <label class="label cursor-pointer justify-start gap-4">
      <input
        type="checkbox"
        class="checkbox"
        checked={stickySessionEnabled}
        on:change={handleStickyEnabledChange}
      />
      <span class="label-text">{$_('routeEditor.enableStickySession')}</span>
    </label>
  </div>

  {#if stickySessionEnabled}
    <div class="form-control">
      <label class="label" for="sticky-session-key-expression">
        <span class="label-text">{$_('routeEditor.stickySessionKeyExpression')}</span>
      </label>
      <input
        id="sticky-session-key-expression"
        type="text"
        class="nx-input font-mono"
        value={stickySessionExpression}
        placeholder={$_('routeEditor.stickySessionKeyExpressionPlaceholder')}
        on:input={handleStickyExpressionInput}
      />
      <div class="label">
        <span class="label-text-alt text-xs text-zinc-500">{$_('routeEditor.stickySessionKeyExpressionHelp')}</span>
      </div>
    </div>
  {/if}
</div>
