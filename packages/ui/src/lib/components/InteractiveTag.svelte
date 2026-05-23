<script lang="ts">
  export let href: string | undefined = undefined;
  export let title: string | undefined = undefined;
  export let className = '';

  const baseClass = 'badge badge-sm badge-outline cursor-pointer no-underline border-base-content/30 text-base-content transition-colors duration-150 hover:border-primary hover:bg-primary hover:text-primary-content focus-visible:border-primary focus-visible:bg-primary focus-visible:text-primary-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
</script>

{#if href}
  <a {href} {title} class={`${baseClass} ${className}`} on:click {...$$restProps}>
    <slot />
  </a>
{:else}
  <span 
    {title} 
    class={`${baseClass} ${className}`} 
    on:click 
    {...$$restProps} 
    role="button" 
    tabindex="0"
    on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && e.currentTarget.click()}
  >
    <slot />
  </span>
{/if}
