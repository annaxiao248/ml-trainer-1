<!--
  (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors

  SPDX-License-Identifier: MIT
 -->

<script lang="ts">
  import StandardButton from '../../StandardButton.svelte';
  import ExternalLinkIcon from 'virtual:icons/ri/external-link-line';
  import { t } from '../../../i18n';
  import microbitConnectedImage from '../../../imgs/stylised-microbit-connected.svg';
  import DialogHeading from '../../DialogHeading.svelte';

  export let onNextClick: () => void;
  export let onBackClick: () => void;

  //TODO: Replace with real support link.
  const href = 'https://support.microbit.org/support/home';
</script>

<div class="w-175">
  <DialogHeading>
    {$t('connectMB.connectBattery.heading')}
  </DialogHeading>
  <div class="space-y-5">
    <p>
      {$t('connectMB.connectBattery.subtitle')}
      <a
        class="inline mr-auto gap-x-1 items-center text-link outline-none focus-visible:ring-4 focus-visible:ring-offset-1 focus-visible:ring-ring"
        {href}
        target="_blank"
        rel="noopener">
        {$t('connectMB.connectBattery.link')}
        <ExternalLinkIcon class="inline transform -translate-y-0.25" />
      </a>
    </p>
    <img src={microbitConnectedImage} alt="" class="w-68 h-229px m-auto" />
  </div>
</div>
<div class="flex justify-end gap-x-5 pt-5">
  <StandardButton onClick={onBackClick}>{$t('connectMB.backButton')}</StandardButton>
  <StandardButton type="primary" onClick={onNextClick}
    >{$t('connectMB.nextButton')}</StandardButton>
</div>
