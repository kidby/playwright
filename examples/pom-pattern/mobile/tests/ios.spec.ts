import { iosCapabilities } from '@playwright/mobile';
import { test } from '../fixtures';

test.use({
  capabilities: iosCapabilities({
    bundleId: 'com.apple.Preferences',
    deviceName: 'iPhone 17',
    platformVersion: '26.5',
  }),
});

test('Settings list renders on iOS', async ({ settingsPage }) => {
  await settingsPage.expectVisible();
});
