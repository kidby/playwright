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

// Verifies the platform-aware getByText / getByLabel / getByTestId / getByType
// query construction — the resolve path hits the mock with the right
// `using`/`value` per platform.

import { test, expect } from '@playwright/test';

import { NativeDevice, androidCapabilities, iosCapabilities } from '../../packages/playwright-mobile/src/index.js';

import { startMockAppium } from './mockAppium.js';

import type { MockAppium } from './mockAppium.js';

let mock: MockAppium;
test.beforeEach(async () => { mock = await startMockAppium(); });
test.afterEach(async () => { await mock.close(); });

async function captureFirstFindBody(): Promise<{ using: string; value: string } | undefined> {
  // The mock records every request — pull the first POST that hits an
  // /element[s]? endpoint.
  const r = mock.requests.find(r => r.method === 'POST' && /\/elements?$/.test(r.path));
  return r?.body as { using: string; value: string } | undefined;
}

test('iOS getByText → -ios predicate string with CONTAINS[c]', async () => {
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example' }));
  await device.app.getByText('Submit').resolveAll().catch(() => undefined);
  const body = await captureFirstFindBody();
  expect(body).toEqual({ using: '-ios predicate string', value: 'label CONTAINS[c] "Submit"' });
  await device.stop();
});

test('iOS getByText with RegExp → MATCHES', async () => {
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example' }));
  await device.app.getByText(/Item \d+/).resolveAll().catch(() => undefined);
  const body = await captureFirstFindBody();
  expect(body).toEqual({ using: '-ios predicate string', value: 'label MATCHES "Item \\\\d+"' });
  await device.stop();
});

test('Android getByText → -android uiautomator textContains', async () => {
  const device = await NativeDevice.start(mock.url, androidCapabilities({ appPackage: 'com.example', appActivity: '.Main' }));
  await device.app.getByText('Save').resolveAll().catch(() => undefined);
  const body = await captureFirstFindBody();
  expect(body).toEqual({ using: '-android uiautomator', value: 'new UiSelector().textContains("Save")' });
  await device.stop();
});

test('Android getByText with RegExp → textMatches', async () => {
  const device = await NativeDevice.start(mock.url, androidCapabilities({ appPackage: 'com.example', appActivity: '.Main' }));
  await device.app.getByText(/^Row \d+$/).resolveAll().catch(() => undefined);
  const body = await captureFirstFindBody();
  expect(body).toEqual({ using: '-android uiautomator', value: 'new UiSelector().textMatches("^Row \\\\d+$")' });
  await device.stop();
});

test('iOS getByLabel(string) → accessibility id', async () => {
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example' }));
  await device.app.getByLabel('Email').resolveAll().catch(() => undefined);
  const body = await captureFirstFindBody();
  expect(body).toEqual({ using: 'accessibility id', value: 'Email' });
  await device.stop();
});

test('iOS getByLabel(RegExp) → predicate MATCHES', async () => {
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example' }));
  await device.app.getByLabel(/Email.*/).resolveAll().catch(() => undefined);
  const body = await captureFirstFindBody();
  expect(body).toEqual({ using: '-ios predicate string', value: 'label MATCHES "Email.*"' });
  await device.stop();
});

test('Android getByLabel → description selector', async () => {
  const device = await NativeDevice.start(mock.url, androidCapabilities({ appPackage: 'com.example', appActivity: '.Main' }));
  await device.app.getByLabel('Email').resolveAll().catch(() => undefined);
  const body = await captureFirstFindBody();
  expect(body).toEqual({ using: '-android uiautomator', value: 'new UiSelector().descriptionContains("Email")' });
  await device.stop();
});

test('getByTestId → accessibility id on both platforms', async () => {
  for (const platform of ['iOS', 'Android'] as const) {
    const caps = platform === 'iOS'
      ? iosCapabilities({ bundleId: 'com.example' })
      : androidCapabilities({ appPackage: 'com.example', appActivity: '.Main' });
    mock = await startMockAppium();
    const device = await NativeDevice.start(mock.url, caps);
    await device.app.getByTestId('save-btn').resolveAll().catch(() => undefined);
    const body = await captureFirstFindBody();
    expect(body, `platform=${platform}`).toEqual({ using: 'accessibility id', value: 'save-btn' });
    await device.stop();
    await mock.close();
  }
});

test('iOS getByType("Button") expands to XCUIElementTypeButton', async () => {
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example' }));
  await device.app.getByType('Button').resolveAll().catch(() => undefined);
  const body = await captureFirstFindBody();
  expect(body).toEqual({ using: 'class name', value: 'XCUIElementTypeButton' });
  await device.stop();
});

test('Android getByType("Button") expands to android.widget.Button', async () => {
  const device = await NativeDevice.start(mock.url, androidCapabilities({ appPackage: 'com.example', appActivity: '.Main' }));
  await device.app.getByType('Button').resolveAll().catch(() => undefined);
  const body = await captureFirstFindBody();
  expect(body).toEqual({ using: 'class name', value: 'android.widget.Button' });
  await device.stop();
});

test('getByType passes through fully-qualified class names', async () => {
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example' }));
  await device.app.getByType('XCUIElementTypeNavigationBar').resolveAll().catch(() => undefined);
  const body = await captureFirstFindBody();
  expect(body?.value).toBe('XCUIElementTypeNavigationBar');
  await device.stop();
});

test('getByText escapes double quotes in the value', async () => {
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example' }));
  await device.app.getByText('She said "hi"').resolveAll().catch(() => undefined);
  const body = await captureFirstFindBody();
  expect(body?.value).toBe('label CONTAINS[c] "She said \\"hi\\""');
  await device.stop();
});
