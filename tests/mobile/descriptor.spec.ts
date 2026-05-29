/**
 * Copyright (c) Microsoft Corporation.
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

// Covers the Playwright `devices['…']` descriptor integration: descriptor
// is stored on the NativeDevice, viewport/deviceScaleFactor read from it
// when present, fall back to live Appium values when absent, and
// `toHaveScreenshot` baseline naming includes the @Nx scale-factor suffix.

import fs from 'fs';

import { devices, test } from '@playwright/test';
import { PNG } from 'pngjs';

import { NativeDevice, expect, iosCapabilities } from '../../packages/playwright-mobile/src/index.js';

import { startMockAppium } from './mockAppium.js';

import type { MockAppium } from './mockAppium.js';

function pngBytes(): string {
  const png = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 200;
    png.data[i + 1] = 200;
    png.data[i + 2] = 200;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png).toString('base64');
}

let mock: MockAppium;
test.beforeEach(async () => { mock = await startMockAppium(); });
test.afterEach(async () => { await mock.close(); });

test('descriptor is stored on the device and exposed by getter', async () => {
  const iphone15 = devices['iPhone 15'];
  const device = await NativeDevice.start(
      mock.url,
      iosCapabilities({ bundleId: 'com.example.app' }),
      { descriptor: iphone15 },
  );
  expect(device.descriptor).toBe(iphone15);
  expect(device.descriptor!.viewport.width).toBe(393);
  expect(device.deviceScaleFactor).toBe(3);
  await device.stop();
});

test('viewport() returns descriptor values when present', async () => {
  const device = await NativeDevice.start(
      mock.url,
      iosCapabilities({ bundleId: 'com.example.app' }),
      { descriptor: devices['iPhone 15'] },
  );
  const vp = await device.viewport();
  expect(vp).toEqual({ width: 393, height: 659 });
  await device.stop();
});

test('viewport() falls back to client.getWindowRect when no descriptor', async () => {
  // Mock returns 390x844 for /window/rect by default.
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  const vp = await device.viewport();
  expect(vp).toEqual({ width: 390, height: 844 });
  expect(device.deviceScaleFactor).toBeUndefined();
  await device.stop();
});

test('deviceScaleFactor reads appium:pixelRatio capability when no descriptor', async () => {
  const device = await NativeDevice.start(mock.url, {
    ...iosCapabilities({ bundleId: 'com.example.app' }),
    'appium:pixelRatio': 2,
  });
  expect(device.deviceScaleFactor).toBe(2);
  await device.stop();
});

test('toHaveScreenshot baseline name includes @3x when descriptor present', async ({}, testInfo) => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/screenshot$/.test(req.path))
      return { body: { value: pngBytes() } };
  });
  const device = await NativeDevice.start(
      mock.url,
      iosCapabilities({ bundleId: 'com.example.app', deviceName: 'iPhone 15 Sim' }),
      { descriptor: devices['iPhone 15'] },
  );
  device.defaultActionTimeoutMs = 2_000;
  testInfo.config.updateSnapshots = 'missing';
  await expect(device).toHaveScreenshot({ stabilizationFrames: 1, pollMs: 10, timeout: 2_000 });

  const files = fs.existsSync(testInfo.snapshotDir) ? fs.readdirSync(testInfo.snapshotDir) : [];
  const matching = files.find(f => /@3x/.test(f) && f.endsWith('.png'));
  expect(matching, `looking for @3x baseline in ${testInfo.snapshotDir}, got ${files.join(',')}`).toBeTruthy();
  await device.stop();
});

test('toHaveScreenshot baseline name omits @Nx when descriptor absent', async ({}, testInfo) => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/screenshot$/.test(req.path))
      return { body: { value: pngBytes() } };
  });
  const device = await NativeDevice.start(
      mock.url,
      iosCapabilities({ bundleId: 'com.example.app', deviceName: 'plain' }),
  );
  device.defaultActionTimeoutMs = 2_000;
  testInfo.config.updateSnapshots = 'missing';
  await expect(device).toHaveScreenshot({ stabilizationFrames: 1, pollMs: 10, timeout: 2_000 });

  const files = fs.existsSync(testInfo.snapshotDir) ? fs.readdirSync(testInfo.snapshotDir) : [];
  // Other tests in this file share the snapshot dir — filter to baselines
  // belonging to *this* test by title.
  const own = files.filter(f => f.includes('omits-@Nx') && f.endsWith('.png'));
  expect(own.length, 'expected at least one own baseline').toBeGreaterThan(0);
  for (const f of own)
    expect(f).not.toMatch(/-@\d+x\.png$/);
  await device.stop();
});
