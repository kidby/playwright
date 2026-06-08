import { androidCapabilities } from '@playwright/mobile';
import { test, expect } from '../fixtures';
import { OpenSettingsRow } from '../tasks/OpenSettingsRow';
import { SettingsState } from '../questions/SettingsState';

test.use({
  capabilities: androidCapabilities({
    appPackage: 'com.android.settings',
    appActivity: '.Settings',
    deviceName: 'Android Emulator',
  }),
});

test('Android Screenplay: open a Settings row', async ({ actor }) => {
  await actor.attemptsTo(OpenSettingsRow.labeled('Network & internet'));
  expect(await actor.asks(SettingsState.hasRow('Internet'))).toBe(true);
});
