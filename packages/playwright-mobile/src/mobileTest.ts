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
  defaultActionTimeoutMs: number;
  device: Device;
};

const DEFAULT_ACTION_TIMEOUT_LOCAL_MS = 20_000;
const DEFAULT_ACTION_TIMEOUT_CI_MS = 30_000;

const requireCapabilitiesFixture: TestFixture<AppiumCapabilities, MobileFixtures> = async () => {
  throw new Error(
      'mobileTest: `capabilities` fixture not provided. Call test.use({ capabilities: androidCapabilities({...}) }) or set it via a project.',
  );
};

export type AttachableTestInfo = {
  status?: string;
  attach(name: string, opts: { body: Buffer | string; contentType: string }): Promise<void>;
};

export async function captureFailureArtifacts(device: Device, testInfo: AttachableTestInfo): Promise<void> {
  try {
    const yaml = await device.snapshot();
    if (yaml)
      await testInfo.attach('mobile-snapshot', { body: yaml, contentType: 'application/x-yaml' });
  } catch {
    // Snapshot capture is best-effort — never block the test teardown.
  }
  try {
    const png = await device.screenshot();
    if (png?.length)
      await testInfo.attach('mobile-screenshot', { body: png, contentType: 'image/png' });
  } catch {
    // Same — best-effort.
  }
}

export const mobileTest = base.extend<MobileFixtures>({
  appiumServerUrl: [process.env.APPIUM_URL || 'http://127.0.0.1:4723', { option: true }],
  capabilities: [requireCapabilitiesFixture, { option: true }],
  defaultActionTimeoutMs: [process.env.CI ? DEFAULT_ACTION_TIMEOUT_CI_MS : DEFAULT_ACTION_TIMEOUT_LOCAL_MS, { option: true }],
  device: async ({ appiumServerUrl, capabilities, defaultActionTimeoutMs }, use, testInfo) => {
    const device = await Device.start(appiumServerUrl, capabilities);
    device.defaultActionTimeoutMs = defaultActionTimeoutMs;
    try {
      await use(device);
    } finally {
      if (testInfo.status !== 'passed' && testInfo.status !== 'skipped')
        await captureFailureArtifacts(device, testInfo);
      await device.stop().catch(() => undefined);
    }
  },
});

export { expect } from 'playwright/test';
