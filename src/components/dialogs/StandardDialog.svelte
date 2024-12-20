<!--
  (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 
  SPDX-License-Identifier: MIT
 -->

<script lang="ts">
  import { CreateDialogProps, createDialog, createSync, melt } from '@melt-ui/svelte';
  import { fade, scale } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import CloseIcon from 'virtual:icons/ri/close-line';
  import { t } from '../../i18n';
  import IconButton from '../IconButton.svelte';
  import { onMount, onDestroy } from 'svelte';

  export let hasCloseButton = true;
  export let closeOnOutsideClick: boolean = true;
  export let closeOnEscape: boolean = true;
  export let isOpen: boolean;
  export let onClose: () => void;
  export let hideContent: boolean = false;

  let finalFocusRef: Element | null;
  let isMobile = false; // To detect if the device is mobile

  const onOpenDialog = () => {
    finalFocusRef = document.activeElement;
  };

  const onCloseDialog = () => {
    onClose();
    if (finalFocusRef) {
      (finalFocusRef as HTMLElement).focus();
    }
  };

  const onOpenChange: CreateDialogProps['onOpenChange'] = ({ curr, next }) => {
    if (curr && !next) {
      onCloseDialog();
    } else if (!curr && next) {
      onOpenDialog();
    }
    return next;
  };

  const {
    elements: { overlay, content, title, close, portalled },
    states,
  } = createDialog({
    forceVisible: true,
    preventScroll: true,
    closeOnOutsideClick,
    closeOnEscape: false,
    onOpenChange,
  });

  const keyListener = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && isOpen) {
      onCloseDialog();
    }
  };

  $: {
    if (closeOnEscape) {
      document.addEventListener('keydown', keyListener);
    } else {
      document.removeEventListener('keydown', keyListener);
    }
  }

  const { open } = states;

  const sync = createSync(states);
  $: sync.open(isOpen, v => (isOpen = v));

  let prevOpen: boolean;
  $: if (!prevOpen && isOpen) {
    onOpenDialog();
    prevOpen = isOpen;
  } else if (prevOpen && !isOpen) {
    prevOpen = isOpen;
    onCloseDialog();
  }

  onDestroy(() => document.removeEventListener('keydown', keyListener));

  // Detect mobile screen size
  const checkIfMobile = () => {
    isMobile = window.innerWidth <= 768;
  };

  // Run check on mount and listen for window resize events
  onMount(() => {
    checkIfMobile();
    window.addEventListener('resize', checkIfMobile);
    return () => {
      window.removeEventListener('resize', checkIfMobile);
    };
  });
</script>

<div class="fixed z-10" use:melt={$portalled}>
  {#if $open}
    <div
      class="fixed top-0 left-0 h-screen w-screen flex justify-center items-center bg-black/50 bg-blend-darken"
      use:melt={$overlay}
      transition:fade={{ duration: 100 }}>

      <div
        use:melt={$content}
        class="border-gray-200 border border-solid relative bg-white rounded-lg p-8 z-15"
        style="width: {isMobile ? '90%' : '500px'}; height: {isMobile ? 'auto' : 'auto'};"
        class:hidden={hideContent}
        transition:scale={{
          duration: 200,
          start: 0.9,
          easing: quintOut,
        }}>
        
        <!-- Added horizontal scroll for content overflow -->
        <div class="overflow-x-auto">
          {#if hasCloseButton}
            <div class="absolute right-2 top-2">
              <IconButton
                onClick={onCloseDialog}
                useAction={$close.action}
                ariaLabel={$t('actions.close')}>
                <CloseIcon class="text-xl m-1" />
              </IconButton>
            </div>
          {/if}

          <div class={$$restProps.class || ''}>
            <h2 use:melt={$title} class="text-xl font-bold">
              <slot name="heading" />
            </h2>
            <slot name="body" />
          </div>

          <!-- Fallback for content if no heading or body slots are provided -->
          {#if !$$slots.heading && !$$slots.body}
            <slot />
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
