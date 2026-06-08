import { androidCapabilities } from '@playwright/mobile';
import { test } from '../fixtures';

test.use({
  capabilities: androidCapabilities({
    appPackage: 'com.android.settings',
    appActivity: '.Settings',
    deviceName: 'Android Emulator',
  }),
});

test('Settings list renders on Android', async ({ settingsPage }) => {
  await settingsPage.expectVisible();
});
