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

import { test as base } from 'playwright/test';

import { Device } from './device';

import type { AppiumCapabilities } from './appiumClient';
import type { TestFixture } from 'playwright/test';

export type MobileFixtures = {
  appiumServerUrl: string;
  capabilities: AppiumCapabilities;
  device: Device;
};

const requireCapabilitiesFixture: TestFixture<AppiumCapabilities, MobileFixtures> = async () => {
  throw new Error(
      'mobileTest: `capabilities` fixture not provided. Call test.use({ capabilities: androidCapabilities({...}) }) or set it via a project.',
  );
};

export const mobileTest = base.extend<MobileFixtures>({
  appiumServerUrl: [process.env.APPIUM_URL || 'http://127.0.0.1:4723', { option: true }],
  capabilities: [requireCapabilitiesFixture, { option: true }],
  device: async ({ appiumServerUrl, capabilities }, use) => {
    const device = await Device.start(appiumServerUrl, capabilities);
    try {
      await use(device);
    } finally {
      await device.stop().catch(() => undefined);
    }
  },
});

export { expect } from 'playwright/test';
