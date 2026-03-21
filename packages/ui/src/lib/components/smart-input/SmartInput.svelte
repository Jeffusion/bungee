<script lang="ts" context="module">
  import { writable } from 'svelte/store';

  export const activeSmartInputIdStore = writable<string | null>(null);
</script>

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { onMount } from 'svelte';
  import type { Unsubscriber } from 'svelte/store';
  import { fade, fly } from 'svelte/transition';
  import { debounce } from 'lodash-es';
  import { _ } from 'svelte-i18n';
  import { v4 as uuidv4 } from 'uuid';

  export let value: string | number = '';
  export let size: 'xs' | 'sm' | 'md' | 'lg' = 'md';
  export let type: string = 'text';
  export let placeholder: string = '';
  export let disabled: boolean = false;
  export let required: boolean = false;
  export let readonly: boolean = false;
  export let label: string = '';
  export let validate: ((value: any) => string | null) | undefined = undefined;
  export let suggestions: Array<{ value: string; label?: string; description?: string }> = [];
  export let showSuggestions: boolean = false;
  export let inputClass: string = '';
  export let id: string = uuidv4();

  const dispatch = createEventDispatcher();
  const MAX_SUGGESTIONS = 200;
  
  let rootEl: HTMLDivElement | null = null;
  let error: string | null = null;
  let activeSuggestionIndex: number = -1;
  let filteredSuggestions: Array<{ value: string; label?: string; description?: string }> = [];
  let pointerDownInside = false;
  let activeSmartInputId: string | null = null;

  // Debounced validation
  const debouncedValidate = debounce((val: any) => {
    if (validate) {
      error = validate(val);
      dispatch('validate', error ? [error] : []);
    }
  }, 300);

  $: if (suggestions) {
    updateFilteredSuggestions(value);
  }

  $: {
    debouncedValidate(value);
  }

  function updateFilteredSuggestions(val: string | number) {
    if (!suggestions || suggestions.length === 0) {
      filteredSuggestions = [];
      return;
    }
    
    const strVal = String(val).toLowerCase();
    filteredSuggestions = suggestions.filter(s => 
      String(s.value).toLowerCase().includes(strVal) || 
      (s.label && s.label.toLowerCase().includes(strVal))
    ).slice(0, MAX_SUGGESTIONS);
  }

  function handleInput(event: Event) {
    const target = event.target as HTMLInputElement;
    value = target.value;
    updateFilteredSuggestions(value);
    const shouldOpen = !showSuggestions;
    showSuggestions = true;
    if (shouldOpen) {
      activeSmartInputIdStore.set(id);
    }
    activeSuggestionIndex = -1;
    dispatch('change', value);
  }

  function handleFocus() {
    const shouldOpen = !showSuggestions;
    showSuggestions = true;
    if (shouldOpen) {
      activeSmartInputIdStore.set(id);
    }
    updateFilteredSuggestions(value);
    dispatch('focus');
  }

  function handleBlur(event: FocusEvent) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && rootEl?.contains(nextTarget)) {
      return;
    }

    setTimeout(() => {
      if (pointerDownInside) {
        return;
      }
      showSuggestions = false;
      if (activeSmartInputId === id) {
        activeSmartInputIdStore.set(null);
      }
      pointerDownInside = false;
      if (validate) {
        error = validate(value);
        dispatch('validate', error ? [error] : []);
      }
      dispatch('blur');
    }, 100);
  }

  function selectSuggestion(suggestion: { value: string; label?: string }) {
    value = suggestion.value;
    showSuggestions = false;
    if (activeSmartInputId === id) {
      activeSmartInputIdStore.set(null);
    }
    error = null; // Clear error on valid selection
    dispatch('change', value);
    dispatch('select', suggestion);
    if (validate) {
      error = validate(value); // Re-validate
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!showSuggestions || filteredSuggestions.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeSuggestionIndex = (activeSuggestionIndex + 1) % filteredSuggestions.length;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeSuggestionIndex = (activeSuggestionIndex - 1 + filteredSuggestions.length) % filteredSuggestions.length;
    } else if (event.key === 'Enter') {
      if (activeSuggestionIndex >= 0 && activeSuggestionIndex < filteredSuggestions.length) {
        event.preventDefault();
        selectSuggestion(filteredSuggestions[activeSuggestionIndex]);
      }
    } else if (event.key === 'Escape') {
      showSuggestions = false;
      if (activeSmartInputId === id) {
        activeSmartInputIdStore.set(null);
      }
    }
  }

  onMount(() => {
    let unsubscribeActiveId: Unsubscriber | null = null;

    unsubscribeActiveId = activeSmartInputIdStore.subscribe((nextId) => {
      activeSmartInputId = nextId;
      if (showSuggestions && nextId && nextId !== id) {
        showSuggestions = false;
      }
    });

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      pointerDownInside = target instanceof Node && !!rootEl?.contains(target);
    };

    const handlePointerUp = () => {
      setTimeout(() => {
        pointerDownInside = false;
      }, 0);
    };

    const clearPointerState = () => {
      pointerDownInside = false;
    };

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        pointerDownInside = false;
      }
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', clearPointerState, true);
    window.addEventListener('blur', clearPointerState, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', clearPointerState, true);
      window.removeEventListener('blur', clearPointerState, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      unsubscribeActiveId?.();
      if (activeSmartInputId === id) {
        activeSmartInputIdStore.set(null);
      }
    };
  });

  // Ensure scroll into view for active suggestion
  $: if (activeSuggestionIndex >= 0 && typeof document !== 'undefined') {
    const activeEl = document.getElementById(`suggestion-${activeSuggestionIndex}`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }
</script>

<div class="form-control w-full relative" bind:this={rootEl}>
  {#if label}
    <label class="label" for={id}>
      <span class="label-text">{label}</span>
    </label>
  {/if}
  
  <div class="relative w-full">
    <input
      {id}
      {type}
      {value}
      {placeholder}
      {disabled}
      {required}
      {readonly}
      on:input={handleInput}
      on:focus={handleFocus}
      on:blur={handleBlur}
      on:keydown={handleKeydown}
      {...$$restProps}
      aria-expanded={showSuggestions && filteredSuggestions.length > 0}
      aria-haspopup="listbox"
      aria-controls={`${id}-suggestions`}
      class="input input-bordered w-full {inputClass} 
        {size === 'xs' ? 'input-xs' : ''} 
        {size === 'sm' ? 'input-sm' : ''} 
        {size === 'md' ? 'input-md' : ''} 
        {size === 'lg' ? 'input-lg' : ''}
        {error ? 'input-error' : ''}"
      autocomplete="off"
    />

    {#if showSuggestions && filteredSuggestions.length > 0}
      <ul 
        id={`${id}-suggestions`}
        role="listbox"
        class="absolute left-0 z-50 mt-1 w-full rounded-box border border-base-300 bg-base-100 p-2 shadow max-h-60 overflow-y-auto overflow-x-hidden overscroll-contain"
        transition:fly={{ y: -5, duration: 150 }}
      >
        {#each filteredSuggestions as suggestion, index}
          <li class="w-full">
            <button 
              type="button"
              id="suggestion-{index}"
              class="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-base-200"
              class:bg-base-200={index === activeSuggestionIndex}
              on:click={() => selectSuggestion(suggestion)}
            >
              <div class="flex flex-col items-start w-full min-w-0">
                <span class="font-medium whitespace-normal break-words w-full">{suggestion.label || suggestion.value}</span>
                {#if suggestion.description}
                  <span class="text-xs opacity-70 whitespace-normal break-words w-full">{suggestion.description}</span>
                {/if}
              </div>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  {#if error}
    <div class="label" transition:fade>
      <span class="label-text-alt text-error">{error}</span>
    </div>
  {/if}
</div>
