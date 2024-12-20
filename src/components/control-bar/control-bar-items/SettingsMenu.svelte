<!--
  (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors

  SPDX-License-Identifier: MIT
 -->

<script lang="ts">
  import SettingsIcon from 'virtual:icons/ri/settings-2-line';
  import GlobeIcon from 'virtual:icons/ri/global-line';
  import LanguageDialog from './LanguageDialog.svelte';
  import { t } from '../../../i18n';
  import MenuItems from './MenuItems.svelte';
  import MenuItem from './MenuItem.svelte';
  import { createDropdownMenu } from '@melt-ui/svelte';
  import IconButton from '../../IconButton.svelte';

  const menu = createDropdownMenu({ forceVisible: true });
  const { trigger } = menu.elements;
  const { open } = menu.states;
  let settingsButtonRef: IconButton | null;

  let isLanguageDialogOpen = false;
  const onLanguageClick = () => {
    isLanguageDialogOpen = true;
  };
  const onLanguagDialogClose = () => {
    isLanguageDialogOpen = false;
    settingsButtonRef?.focus();
  };
</script>

<div>
  <LanguageDialog isOpen={isLanguageDialogOpen} onClose={onLanguagDialogClose} />
  <div class="relative inline-block">
    <IconButton
      bind:this={settingsButtonRef}
      ariaLabel={$t('settings.label')}
      rounded
      {...$trigger}
      useAction={trigger}
      class="inline-flex rounded-full text-xl p-2 outline-none focus-visible:ring-ringBright focus-visible:ring-4 focus-visible:ring-offset-1">
      <SettingsIcon class="text-white" />
    </IconButton>
    {#if $open}
      <MenuItems {menu}>
        <div class="py-2">
          <MenuItem {menu} on:m-click={onLanguageClick}>
            <GlobeIcon />
            {$t('languageDialog.title')}
          </MenuItem>
        </div>
      </MenuItems>
    {/if}
  </div>
</div>
