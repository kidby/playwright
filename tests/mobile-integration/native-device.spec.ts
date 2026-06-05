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

import { mobileTest, expect } from '../../packages/playwright-mobile/src/index.js';

import { APPIUM_URL, bootedAndroidUdid, bootedIosUdid, shouldSkipAndroid, shouldSkipIos } from './fixtures/availability.js';
import { androidSettings, iosSettings } from './fixtures/capabilities.js';

// NativeDevice surface: screenshot, snapshot, viewport, contexts. These
// validate the fork's mobile-side primitives against a real driver.

function pngMagic(buf: Buffer): boolean {
  return buf.length >= 8
    && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a;
}

mobileTest.describe('NativeDevice @android-app', () => {
  mobileTest.beforeAll(async () => {
    const reason = await shouldSkipAndroid();
    if (reason)
      mobileTest.skip(true, reason);
  });

  mobileTest.use({
    appiumServerUrl: APPIUM_URL,
    capabilities: androidSettings(bootedAndroidUdid() ?? ''),
  });

  mobileTest('android: device.screenshot() returns a real PNG', async ({ device }) => {
    const png = await device.screenshot();
    expect(png.length).toBeGreaterThan(1024);
    expect(pngMagic(png)).toBe(true);
  });

  mobileTest('android: device.snapshot() returns a YAML accessibility tree', async ({ device }) => {
    const yaml = await device.snapshot();
    expect(yaml.length).toBeGreaterThan(40);
    // Snapshot is YAML-ish text with role + name lines; not strict YAML.
    expect(yaml).toMatch(/-\s+\w+/);
  });

  mobileTest('android: device.contexts() lists NATIVE_APP', async ({ device }) => {
    const ctxs = await device.contexts();
    expect(ctxs).toContain('NATIVE_APP');
  });
});

mobileTest.describe('NativeDevice @ios-app', () => {
  mobileTest.beforeAll(async () => {
    const reason = await shouldSkipIos();
    if (reason)
      mobileTest.skip(true, reason);
  });

  mobileTest.use({
    appiumServerUrl: APPIUM_URL,
    capabilities: iosSettings(bootedIosUdid() ?? ''),
  });

  mobileTest('ios: device.screenshot() returns a real PNG', async ({ device }) => {
    const png = await device.screenshot();
    expect(png.length).toBeGreaterThan(1024);
    expect(pngMagic(png)).toBe(true);
  });

  mobileTest('ios: device.snapshot() returns a YAML accessibility tree', async ({ device }) => {
    const yaml = await device.snapshot();
    expect(yaml.length).toBeGreaterThan(40);
    expect(yaml).toMatch(/-\s+\w+/);
  });

  mobileTest('ios: device.contexts() lists NATIVE_APP', async ({ device }) => {
    const ctxs = await device.contexts();
    expect(ctxs).toContain('NATIVE_APP');
  });
});
