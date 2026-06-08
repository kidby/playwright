import { iosCapabilities } from '@playwright/mobile';
import { test, expect } from '../fixtures';
import { OpenSettingsRow } from '../tasks/OpenSettingsRow';
import { SettingsState } from '../questions/SettingsState';

test.use({
  capabilities: iosCapabilities({
    bundleId: 'com.apple.Preferences',
    deviceName: 'iPhone 17',
    platformVersion: '26.5',
  }),
});

test('iOS Screenplay: open a Settings row', async ({ actor }) => {
  await actor.attemptsTo(OpenSettingsRow.labeled('Wi-Fi'));
  expect(await actor.asks(SettingsState.hasRow('Wi-Fi'))).toBe(true);
});
