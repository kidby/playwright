import { mobileTest } from '@playwright/mobile';
import { SettingsPage } from './pages/SettingsPage';

export const test = mobileTest.extend<{ settingsPage: SettingsPage }>({
  settingsPage: async ({ device }, use) => {
    await use(new SettingsPage(device));
  },
});

export { expect } from '@playwright/mobile';
