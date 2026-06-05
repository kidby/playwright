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

// Smoke: open + close a session, read core device info. The simplest
// validation that the mobileTest fixture + AppiumClient handshake works
// end-to-end against a real driver.

mobileTest.describe('session lifecycle @android-app', () => {
  mobileTest.beforeAll(async () => {
    const reason = await shouldSkipAndroid();
    if (reason)
      mobileTest.skip(true, reason);
  });

  mobileTest.use({
    appiumServerUrl: APPIUM_URL,
    capabilities: androidSettings(bootedAndroidUdid() ?? ''),
  });

  mobileTest('android: session starts and stops cleanly', async ({ device }) => {
    expect(device.client.sessionId).toBeTruthy();
    expect(device.client.platform).toBe('Android');
    const vp = await device.viewport();
    expect(vp.width).toBeGreaterThan(0);
    expect(vp.height).toBeGreaterThan(0);
  });

  mobileTest('android: page source is non-empty XML', async ({ device }) => {
    const xml = await device.pageSource();
    expect(xml.length).toBeGreaterThan(100);
    expect(xml).toMatch(/<hierarchy|<android\.|<node\b/);
  });
});

mobileTest.describe('session lifecycle @ios-app', () => {
  mobileTest.beforeAll(async () => {
    const reason = await shouldSkipIos();
    if (reason)
      mobileTest.skip(true, reason);
  });

  mobileTest.use({
    appiumServerUrl: APPIUM_URL,
    capabilities: iosSettings(bootedIosUdid() ?? ''),
  });

  mobileTest('ios: session starts and stops cleanly', async ({ device }) => {
    expect(device.client.sessionId).toBeTruthy();
    expect(device.client.platform).toBe('iOS');
    const vp = await device.viewport();
    expect(vp.width).toBeGreaterThan(0);
    expect(vp.height).toBeGreaterThan(0);
  });

  mobileTest('ios: page source is non-empty XML', async ({ device }) => {
    const xml = await device.pageSource();
    expect(xml.length).toBeGreaterThan(100);
    expect(xml).toMatch(/<XCUIElementType|<AppiumAUT\b/);
  });
});
