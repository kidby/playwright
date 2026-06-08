/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test, expect } from '@playwright/test';

import {
  androidCapabilities,
  iosCapabilities,
  mergeDeviceIntoCapabilities,
} from '../../packages/playwright-mobile/src/capabilities.js';

test('UIA2: rotation by workerIndex maps udid + auto-allocates systemPort/mjpegServerPort', () => {
  const base = androidCapabilities({ appPackage: 'com.android.settings' });
  const a = mergeDeviceIntoCapabilities(base, { udid: 'emulator-5554' }, 0);
  const b = mergeDeviceIntoCapabilities(base, { udid: 'emulator-5556' }, 1);

  expect(a['appium:udid']).toBe('emulator-5554');
  expect(a['appium:systemPort']).toBe(8200);
  expect(a['appium:mjpegServerPort']).toBe(7810);

  expect(b['appium:udid']).toBe('emulator-5556');
  expect(b['appium:systemPort']).toBe(8201);
  expect(b['appium:mjpegServerPort']).toBe(7811);

  expect(base['appium:udid']).toBeUndefined();
  expect(base['appium:systemPort']).toBeUndefined();
});

test('XCUITest: rotation auto-allocates wdaLocalPort and leaves UIA2 ports alone', () => {
  const base = iosCapabilities({ bundleId: 'com.apple.Preferences' });
  const merged = mergeDeviceIntoCapabilities(base, { udid: 'sim-A' }, 2);

  expect(merged['appium:udid']).toBe('sim-A');
  expect(merged['appium:wdaLocalPort']).toBe(8102);
  expect(merged['appium:systemPort']).toBeUndefined();
  expect(merged['appium:mjpegServerPort']).toBeUndefined();
});

test('explicit descriptor port wins over auto-allocation', () => {
  const base = androidCapabilities({ appPackage: 'x' });
  const merged = mergeDeviceIntoCapabilities(base, { udid: 'A', systemPort: 9999 }, 0);
  expect(merged['appium:systemPort']).toBe(9999);
  // mjpegServerPort still auto-allocated since it wasn't pinned.
  expect(merged['appium:mjpegServerPort']).toBe(7810);
});

test('descriptor capabilities catch-all overrides everything', () => {
  const base = androidCapabilities({ appPackage: 'x' });
  const merged = mergeDeviceIntoCapabilities(
      base,
      { udid: 'A', capabilities: { 'appium:udid': 'OVERRIDE', 'custom:flag': true } },
      0,
  );
  expect(merged['appium:udid']).toBe('OVERRIDE');
  expect(merged['custom:flag']).toBe(true);
});

test('descriptor udid overrides a udid already on base caps (rotation must win)', () => {
  const base = androidCapabilities({ appPackage: 'x', udid: 'baseline-udid' });
  const merged = mergeDeviceIntoCapabilities(base, { udid: 'worker-udid' }, 0);
  expect(merged['appium:udid']).toBe('worker-udid');
});

test('deviceName + platformVersion descriptor fields map to appium: keys', () => {
  const base = androidCapabilities({ appPackage: 'x' });
  const merged = mergeDeviceIntoCapabilities(
      base,
      { deviceName: 'Pixel 7', platformVersion: '14' },
      0,
  );
  expect(merged['appium:deviceName']).toBe('Pixel 7');
  expect(merged['appium:platformVersion']).toBe('14');
});

test('empty descriptor still triggers UIA2 port auto-allocation', () => {
  const base = androidCapabilities({ appPackage: 'x' });
  const merged = mergeDeviceIntoCapabilities(base, {}, 3);
  expect(merged['appium:systemPort']).toBe(8203);
  expect(merged['appium:mjpegServerPort']).toBe(7813);
  expect(merged['appium:udid']).toBeUndefined();
});

test('non-UIA2/XCUITest automationName: no port allocation', () => {
  const base = { platformName: 'Android', 'appium:automationName': 'Espresso' } as Record<string, unknown>;
  const merged = mergeDeviceIntoCapabilities(base, { udid: 'A' }, 0);
  expect(merged['appium:udid']).toBe('A');
  expect(merged['appium:systemPort']).toBeUndefined();
  expect(merged['appium:wdaLocalPort']).toBeUndefined();
});
