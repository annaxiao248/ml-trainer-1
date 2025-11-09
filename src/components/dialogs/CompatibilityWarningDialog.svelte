<!--
  (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 
  SPDX-License-Identifier: MIT
 -->

<script lang="ts">
  import { t } from '../../i18n';
  import StandardDialog from './StandardDialog.svelte';
  import StandardButton from '../StandardButton.svelte';
  import { isCompatibilityWarningDialogOpen } from '../../script/stores/uiStore';
  import { detectPlatform, isCapacitorAvailable } from '../../script/utils/platformDetection';

  const onClose = () => {
    $isCompatibilityWarningDialogOpen = false;
  };

  const platform = detectPlatform();
  const isIOS = platform === 'ios';
  const isIOSInSafari = isIOS && !isCapacitorAvailable();
</script>

<StandardDialog
  isOpen={$isCompatibilityWarningDialogOpen}
  {onClose}
  class="w-175 space-y-5">
  <svelte:fragment slot="heading">
    {$t('popup.compatibility.header')}
  </svelte:fragment>
  <svelte:fragment slot="body">
    <div class="space-y-5">
      <div class="space-y-2">
        {#if isIOSInSafari}
          <p>{$t('popup.compatibility.ios.explain')}</p>
          <p>{$t('popup.compatibility.ios.advice')}</p>
        {:else}
          <p>{$t('popup.compatibility.explain')}</p>
          <p>{$t('popup.compatibility.advice')}</p>
        {/if}
      </div>
      <div class="flex justify-end">
        <StandardButton onClick={onClose} type="primary"
          >{$t('actions.close')}</StandardButton>
      </div>
    </div>
  </svelte:fragment>
</StandardDialog>
