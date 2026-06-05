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

import { defineConfig } from '@playwright/test';

// Real-device integration tests for @playwright/mobile. These run against a
// live Appium server + booted iOS simulator or Android emulator. They are
// opt-in: skipped unless MOBILE_E2E=1 is set AND the relevant runtime is
// reachable (see fixtures/availability.ts).
//
// To run:
//   1. Boot an Android emulator OR an iOS simulator
//   2. Start Appium (`appium`) in another terminal — default port 4723
//   3. MOBILE_E2E=1 npm run mobile-integration
//
// Standard `screenshot`/`video`/`trace` options below exercise the full
// artifact-capture surface added in @playwright/mobile.

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  reporter: process.env.CI ? 'list' : 'html',
  workers: 1,  // single device per host; cannot parallelize
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
    // The fork's AppiumServerPlugin handles Appium startup. With
    // autoStart: true it probes APPIUM_URL/status first and reuses an
    // already-running instance (default reuseExistingServer behavior);
    // otherwise it spawns `appium` and waits for /status to go green.
    // Set MOBILE_E2E_NO_AUTOSTART=1 to opt out (e.g. when you want to
    // run against a custom Appium with plugins/drivers preconfigured
    // and the auto-spawn isn't the right command line).
    appium: {
      serverUrl: process.env.APPIUM_URL ?? 'http://127.0.0.1:4723',
      autoStart: process.env.MOBILE_E2E_NO_AUTOSTART !== '1',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  },
  projects: [
    {
      name: 'Android App',
      grep: /@android-app|@mobile-cross-platform/,
    },
    {
      name: 'iOS App',
      grep: /@ios-app|@mobile-cross-platform/,
    },
  ],
});
