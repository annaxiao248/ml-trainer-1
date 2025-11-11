<!--
  (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors

  SPDX-License-Identifier: MIT
-->

<script lang="ts">
  import StandardButton from '../../StandardButton.svelte';
  import { t } from '../../../i18n';
  import DialogHeading from '../../DialogHeading.svelte';

  export let devices: Array<{ deviceId: string; name?: string; rssi?: number }> = [];
  export let onBackClick: () => void;
  export let onDeviceSelect: (device: { deviceId: string; name?: string; rssi?: number }) => void;
  export let isScanning: boolean = false;
</script>

<div class="w-175">
  <DialogHeading>
    {$t('connectMB.capacitorPopup')}
  </DialogHeading>
  <div class="mb-5">
    <p class="text-lg mb-4">
      {#if isScanning}
        {$t('connectMB.capacitorPopup.scanning')}
      {:else if devices.length === 0}
        {$t('connectMB.capacitorPopup.noDevices')}
      {:else}
        {$t('connectMB.capacitorPopup.selectDevice')}
      {/if}
    </p>

    {#if isScanning}
      <div class="flex justify-center items-center py-8">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span class="ml-3">{$t('connectMB.capacitorPopup.searching')}</span>
      </div>
    {:else if devices.length > 0}
      <div class="max-h-60 overflow-y-auto border rounded-lg p-2">
        {#each devices as device (device.deviceId)}
          <button
            class="w-full text-left p-3 mb-2 rounded border hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            on:click={() => onDeviceSelect(device)}
            type="button"
          >
            <div class="font-medium">
              {device.name || 'Unknown Device'}
            </div>
            {#if device.rssi}
              <div class="text-sm text-gray-600">
                Signal: {device.rssi} dBm
              </div>
            {/if}
            <div class="text-xs text-gray-500 mt-1">
              ID: {device.deviceId}
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="flex justify-end gap-x-5">
    <StandardButton onClick={onBackClick}>{$t('connectMB.backButton')}</StandardButton>
  </div>
</div>