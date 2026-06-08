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

import { mobileTest, expect, androidCapabilities } from '../../packages/playwright-mobile/src/index.js';

import { APPIUM_URL, allBootedAndroidUdids, shouldSkipAndroid } from './fixtures/availability.js';

// Validates that `appium.devices` rotates UDIDs across workers and lets the
// suite run with workers > 1. Requires two booted Android emulators.
//
// Run with:
//   MOBILE_E2E=1 ./node_modules/playwright/cli.js test \\
//     --config=tests/mobile-integration/playwright.config.ts \\
//     --project="Android App" --workers=2 -g 'device pool'

const POOL = allBootedAndroidUdids().slice(0, 2).map(udid => ({ udid }));

mobileTest.describe('device pool @android-app', () => {
  mobileTest.beforeAll(async () => {
    const reason = await shouldSkipAndroid();
    if (reason)
      mobileTest.skip(true, reason);
    if (POOL.length < 2)
      mobileTest.skip(true, `device-pool needs >= 2 booted emulators; have ${POOL.length}`);
  });

  mobileTest.use({
    appium: {
      serverUrl: APPIUM_URL,
      autoStart: true,
      reuseExistingServer: true,
      timeout: 60_000,
      devices: POOL,
    },
    capabilities: androidCapabilities({
      appPackage: 'com.android.settings',
      appActivity: '.Settings',
    }),
  });

  // Two specs: when run with --workers=2, each lands on a different worker
  // and (by rotation) a different UDID. We don't directly assert UDIDs —
  // the real proof is that BOTH specs pass concurrently. Pre-fix, the
  // second session against the same UDID would fail with a 500.
  for (const i of [0, 1]) {
    mobileTest(`pooled session ${i} starts cleanly`, async ({ device }) => {
      const src = await device.pageSource();
      expect(src.length).toBeGreaterThan(0);
    });
  }
});
