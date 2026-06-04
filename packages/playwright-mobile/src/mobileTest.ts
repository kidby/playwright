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

import { expect as baseExpect, test as base } from 'playwright/test';

import { NativeDevice } from "./nativeDevice.js";
import { mobileMatchers } from './mobileMatchers.js';

import type { AppiumCapabilities } from './appiumClient.js';
import type { DeviceDescriptor } from './nativeDevice.js';
import type { AppiumConfig, PlaywrightTestOptions, TestFixture } from 'playwright/test';

export type { AppiumConfig };

type MobileFixtureArgs = MobileFixtures & Pick<PlaywrightTestOptions, 'appium'>;

// Install web-first assertion matchers on Playwright's `expect`. The `extend`
// call mutates the singleton at runtime *and* returns a `MoreMatchers`-aware
// Expect — we re-export the typed one so consumers get autocomplete.
const extendedExpect = baseExpect.extend(mobileMatchers);

export type MobileFixtures = {
  appiumServerUrl: string;
  capabilities: AppiumCapabilities;
  descriptor: DeviceDescriptor | undefined;
  defaultActionTimeoutMs: number;
  device: NativeDevice;
};

export type MobileTestArgs = MobileFixtures;
export type MobileTestOptions = {
  appiumServerUrl?: string;
  capabilities?: AppiumCapabilities;
  descriptor?: DeviceDescriptor;
  defaultActionTimeoutMs?: number;
};

const DEFAULT_ACTION_TIMEOUT_LOCAL_MS = 20_000;
const DEFAULT_ACTION_TIMEOUT_CI_MS = 30_000;

const requireCapabilitiesFixture: TestFixture<AppiumCapabilities, MobileFixtureArgs> = async ({ appium }, use) => {
  if (appium?.capabilities) {
    await use(appium.capabilities as AppiumCapabilities);
    return;
  }
  throw new Error(
      'mobileTest: `capabilities` fixture not provided. Set `appium.capabilities` in playwright.config.ts use, or call test.use({ capabilities: androidCapabilities({...}) }).',
  );
};

const resolveServerUrl: TestFixture<string, MobileFixtureArgs> = async ({ appium }, use) => {
  await use(appium?.serverUrl ?? process.env.APPIUM_URL ?? 'http://127.0.0.1:4723');
};

export type AttachableTestInfo = {
  status?: string;
  attach(name: string, opts: { body: Buffer | string; contentType: string }): Promise<void>;
};

// Fixture gating: the mobile `device` fixture runs once per test attempt
// (test-scoped). Every failing retry attempt sees its own `testInfo` with
// `status === 'failed'` and routes through captureFailureArtifacts; the
// eventually-passing attempt is the only one we skip. This means flaky
// tests that pass after retry DO get artifacts for each failed attempt.
export function shouldCaptureFailureArtifacts(status: AttachableTestInfo['status']): boolean {
  return status !== 'passed' && status !== 'skipped';
}

export async function captureFailureArtifacts(device: NativeDevice, testInfo: AttachableTestInfo): Promise<void> {
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
  appiumServerUrl: [resolveServerUrl, { option: true }],
  capabilities: [requireCapabilitiesFixture, { option: true }],
  descriptor: [undefined, { option: true }],
  defaultActionTimeoutMs: [process.env.CI ? DEFAULT_ACTION_TIMEOUT_CI_MS : DEFAULT_ACTION_TIMEOUT_LOCAL_MS, { option: true }],
  device: async ({ appiumServerUrl, capabilities, descriptor, defaultActionTimeoutMs }, use, testInfo) => {
    const device = await NativeDevice.start(appiumServerUrl, capabilities, { descriptor });
    device.defaultActionTimeoutMs = defaultActionTimeoutMs;
    try {
      await use(device);
    } finally {
      if (shouldCaptureFailureArtifacts(testInfo.status))
        await captureFailureArtifacts(device, testInfo);
      await device.stop().catch(() => undefined);
    }
  },
});

export const expect = extendedExpect;
