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

// AppLocator + element-level operations against the platform Settings app.
// Settings ships on every emulator/simulator image so the suite stays
// self-contained (no APK / IPA to bundle).

mobileTest.describe('Settings app — Android @android-app', () => {
  mobileTest.beforeAll(async () => {
    const reason = await shouldSkipAndroid();
    if (reason)
      mobileTest.skip(true, reason);
  });

  mobileTest.use({
    appiumServerUrl: APPIUM_URL,
    capabilities: androidSettings(bootedAndroidUdid() ?? ''),
  });

  mobileTest('android: locator find + isVisible on a Settings TextView', async ({ device }) => {
    // Android Settings always has TextView labels; exact text varies by API
    // level so query by class.
    const locator = device.app.byClassName('android.widget.TextView');
    const count = await locator.count();
    expect(count).toBeGreaterThan(0);
    expect(await locator.isVisible()).toBe(true);
  });

  mobileTest('android: AppLocator.screenshot() returns PNG bytes', async ({ device }) => {
    const locator = device.app.byClassName('android.widget.TextView');
    const png = await locator.screenshot();
    expect(png.length).toBeGreaterThan(64);
    expect(png[0]).toBe(0x89);
  });
});

mobileTest.describe('Settings app — iOS @ios-app', () => {
  mobileTest.beforeAll(async () => {
    const reason = await shouldSkipIos();
    if (reason)
      mobileTest.skip(true, reason);
  });

  mobileTest.use({
    appiumServerUrl: APPIUM_URL,
    capabilities: iosSettings(bootedIosUdid() ?? ''),
  });

  mobileTest('ios: locator find + isVisible on a Settings cell', async ({ device }) => {
    const locator = device.app.byIosClassChain('**/XCUIElementTypeCell');
    const count = await locator.count();
    expect(count).toBeGreaterThan(0);
    expect(await locator.isVisible()).toBe(true);
  });

  mobileTest('ios: AppLocator.screenshot() returns PNG bytes', async ({ device }) => {
    const locator = device.app.byIosClassChain('**/XCUIElementTypeCell');
    const png = await locator.screenshot();
    expect(png.length).toBeGreaterThan(64);
    expect(png[0]).toBe(0x89);
  });
});
