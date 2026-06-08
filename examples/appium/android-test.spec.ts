import { mobileTest as test, expect, androidCapabilities } from '@playwright/mobile';

test.use({
  capabilities: androidCapabilities({
    appPackage: 'com.android.settings',
    appActivity: '.Settings',
    deviceName: 'Android Emulator',
  }),
});

test('Settings rows render on Android', async ({ device }) => {
  const rows = device.app.byClassName('android.widget.TextView');
  await expect(rows.first()).toBeVisible();
});
