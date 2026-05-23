<!--
  MetricBar — Compact horizontal progress bar with leading label and
  trailing value. Used for things like load, utilisation, capacity.
  Colour automatically shifts (emerald → amber → red) when the value
  crosses warn/danger thresholds; pass an explicit `tone` to override.
-->
<script lang="ts">
  /** Leading label, e.g. "LOAD". */
  export let label: string = 'LOAD';

  /** Current value (0–`max`). */
  export let value: number = 0;

  /** Maximum value (defaults to 100, treating the bar as a percentage). */
  export let max: number = 100;

  /** Optional trailing value override; defaults to `${percent}%`. */
  export let valueLabel: string = '';

  /**
   * Visual tone. `auto` picks emerald/amber/red based on thresholds.
   * Pass `accent` for the primary orange (used to highlight focus rows).
   */
  export let tone: 'auto' | 'ok' | 'warn' | 'danger' | 'accent' | 'neutral' = 'auto';

  /** Threshold above which the auto tone switches to amber. */
  export let warnAt: number = 70;

  /** Threshold above which the auto tone switches to red. */
  export let dangerAt: number = 90;

  let extraClass = '';
  export { extraClass as class };

  $: percent = Math.max(0, Math.min(100, (value / max) * 100));
  $: text = valueLabel || `${percent.toFixed(0)}%`;

  $: resolvedTone =
    tone !== 'auto'
      ? tone
      : percent >= dangerAt
        ? 'danger'
        : percent >= warnAt
          ? 'warn'
          : 'ok';

  const fillCls = {
    ok: 'bg-zinc-200',
    warn: 'bg-amber-400',
    danger: 'bg-red-500',
    accent: 'bg-nexus-500',
    neutral: 'bg-zinc-500',
  } as const;

  const textCls = {
    ok: 'text-zinc-300',
    warn: 'text-amber-300',
    danger: 'text-red-300',
    accent: 'text-nexus-300',
    neutral: 'text-zinc-400',
  } as const;
</script>

<div class="space-y-1 {extraClass}">
  <div class="flex items-center justify-between">
    <span class="nx-label-sm">{label}</span>
    <span class="font-mono text-[10px] uppercase tracking-command {textCls[resolvedTone]}">{text}</span>
  </div>
  <div class="relative h-1.5 bg-carbon-700">
    <div class="absolute inset-y-0 left-0 {fillCls[resolvedTone]}" style:width="{percent}%"></div>
  </div>
</div>
