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

// Verifies the mobile `expect.extend` matchers — auto-waiting assertions
// over the existing one-shot AppLocator methods. All tests drive the mock
// Appium server so they run without a device.

import { test } from '@playwright/test';
// Importing from the mobile package triggers `expect.extend(mobileMatchers)`.
import { NativeDevice, androidCapabilities, expect, iosCapabilities } from '../../packages/playwright-mobile/src/index.js';

import { startMockAppium } from './mockAppium.js';

import type { MockAppium } from './mockAppium.js';

let mock: MockAppium;
test.beforeEach(async () => { mock = await startMockAppium(); });
test.afterEach(async () => { await mock.close(); });

async function newDevice(platform: 'iOS' | 'Android' = 'iOS') {
  const caps = platform === 'iOS'
    ? iosCapabilities({ bundleId: 'com.example.app' })
    : androidCapabilities({ appPackage: 'com.example', appActivity: '.Main' });
  const device = await NativeDevice.start(mock.url, caps);
  device.defaultActionTimeoutMs = 1_000;
  return device;
}

test('toBeVisible passes immediately when displayed', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/displayed$/.test(req.path))
      return { body: { value: true } };
  });
  const device = await newDevice();
  await expect(device.app.byAccessibilityId('ok')).toBeVisible({ timeout: 500 });
  await device.stop();
});

test('toBeVisible polls until the element becomes visible', async () => {
  let displayedChecks = 0;
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/displayed$/.test(req.path)) {
      displayedChecks++;
      return { body: { value: displayedChecks >= 3 } };
    }
  });
  const device = await newDevice();
  await expect(device.app.byAccessibilityId('ok')).toBeVisible({ timeout: 2_000 });
  expect(displayedChecks).toBeGreaterThanOrEqual(3);
  await device.stop();
});

test('toBeVisible fails with timeout when the element never appears', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/displayed$/.test(req.path))
      return { body: { value: false } };
  });
  const device = await newDevice();
  const err = await expect(device.app.byAccessibilityId('missing'))
      .toBeVisible({ timeout: 150 })
      .then(() => null, e => e as Error);
  expect(err).not.toBeNull();
  expect(err!.message).toMatch(/Expected accessibility id=missing to be visible/);
  expect(err!.message).toMatch(/Timed out 150ms/);
  await device.stop();
});

test('toBeHidden passes when the element is not displayed', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/displayed$/.test(req.path))
      return { body: { value: false } };
  });
  const device = await newDevice();
  await expect(device.app.byAccessibilityId('gone')).toBeHidden({ timeout: 500 });
  await device.stop();
});

test('not.toBeVisible inverts the assertion', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/displayed$/.test(req.path))
      return { body: { value: false } };
  });
  const device = await newDevice();
  await expect(device.app.byAccessibilityId('gone')).not.toBeVisible({ timeout: 500 });
  await device.stop();
});

test('toBeEnabled polls the enabled state', async () => {
  let checks = 0;
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/enabled$/.test(req.path)) {
      checks++;
      return { body: { value: checks >= 2 } };
    }
  });
  const device = await newDevice();
  await expect(device.app.byAccessibilityId('button')).toBeEnabled({ timeout: 1_000 });
  expect(checks).toBeGreaterThanOrEqual(2);
  await device.stop();
});

test('toHaveText matches a string exactly', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/text$/.test(req.path))
      return { body: { value: 'Submit' } };
  });
  const device = await newDevice();
  await expect(device.app.byAccessibilityId('submit')).toHaveText('Submit', { timeout: 500 });
  await device.stop();
});

test('toHaveText matches a RegExp', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/text$/.test(req.path))
      return { body: { value: 'Item 7 of 12' } };
  });
  const device = await newDevice();
  await expect(device.app.byAccessibilityId('row')).toHaveText(/Item \d+ of \d+/, { timeout: 500 });
  await device.stop();
});

test('toHaveText fails with the observed value in the message', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/text$/.test(req.path))
      return { body: { value: 'Cancel' } };
  });
  const device = await newDevice();
  const err = await expect(device.app.byAccessibilityId('btn'))
      .toHaveText('Submit', { timeout: 100 })
      .then(() => null, e => e as Error);
  expect(err).not.toBeNull();
  expect(err!.message).toMatch(/to have text "Submit"/);
  expect(err!.message).toMatch(/Last observed: "Cancel"/);
  await device.stop();
});

test('toContainText accepts a substring', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/text$/.test(req.path))
      return { body: { value: 'Welcome back, user' } };
  });
  const device = await newDevice();
  await expect(device.app.byAccessibilityId('greeting')).toContainText('Welcome', { timeout: 500 });
  await device.stop();
});

test('toHaveAttribute reads the named attribute', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/attribute\/name$/.test(req.path))
      return { body: { value: 'submitBtn' } };
  });
  const device = await newDevice();
  await expect(device.app.byAccessibilityId('btn')).toHaveAttribute('name', 'submitBtn', { timeout: 500 });
  await device.stop();
});

test('toHaveValue reads the `value` attribute', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/attribute\/value$/.test(req.path))
      return { body: { value: 'pre-filled' } };
  });
  const device = await newDevice();
  await expect(device.app.byAccessibilityId('field')).toHaveValue('pre-filled', { timeout: 500 });
  await device.stop();
});

test('toHaveCount polls the count of matches', async () => {
  let elementsCalls = 0;
  mock.setResponder(req => {
    if (req.method === 'POST' && /\/elements$/.test(req.path)) {
      elementsCalls++;
      const count = elementsCalls >= 2 ? 3 : 1;
      return { body: { value: Array.from({ length: count }, (_, i) => ({ 'element-6066-11e4-a52e-4f735466cecf': `el-${i}` })) } };
    }
  });
  const device = await newDevice();
  await expect(device.app.byAccessibilityId('row')).toHaveCount(3, { timeout: 1_000 });
  expect(elementsCalls).toBeGreaterThanOrEqual(2);
  await device.stop();
});

test('toBeChecked reads `checked` on Android', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/attribute\/checked$/.test(req.path))
      return { body: { value: 'true' } };
  });
  const device = await newDevice('Android');
  await expect(device.app.byAccessibilityId('toggle')).toBeChecked({ timeout: 500 });
  await device.stop();
});

test('toBeChecked reads `value` on iOS', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/attribute\/value$/.test(req.path))
      return { body: { value: '1' } };
  });
  const device = await newDevice('iOS');
  await expect(device.app.byAccessibilityId('toggle')).toBeChecked({ timeout: 500 });
  await device.stop();
});

test('toBeFocused reads `focused` on Android / `hasFocus` on iOS', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/attribute\/focused$/.test(req.path))
      return { body: { value: 'true' } };
    if (req.method === 'GET' && /\/attribute\/hasFocus$/.test(req.path))
      return { body: { value: 'true' } };
  });
  const android = await newDevice('Android');
  await expect(android.app.byAccessibilityId('input')).toBeFocused({ timeout: 500 });
  await android.stop();

  const ios = await newDevice('iOS');
  await expect(ios.app.byAccessibilityId('input')).toBeFocused({ timeout: 500 });
  await ios.stop();
});

test('matchers work through filter() and first()', async () => {
  let textCalls = 0;
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/text$/.test(req.path)) {
      textCalls++;
      return { body: { value: 'Match' } };
    }
    if (req.method === 'GET' && /\/displayed$/.test(req.path))
      return { body: { value: true } };
  });
  const device = await newDevice();
  await expect(device.app.byAccessibilityId('row').first()).toHaveText('Match', { timeout: 500 });
  expect(textCalls).toBeGreaterThan(0);
  await device.stop();
});

test('expect.configure({ timeout }) overrides the locator default', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/displayed$/.test(req.path))
      return { body: { value: false } };
  });
  const device = await newDevice();
  device.defaultActionTimeoutMs = 5_000;
  const tightExpect = expect.configure({ timeout: 100 });
  const err = await tightExpect(device.app.byAccessibilityId('gone'))
      .toBeVisible()
      .then(() => null, e => e as Error);
  expect(err).not.toBeNull();
  expect(err!.message).toMatch(/Timed out 100ms/);
  await device.stop();
});

test('matcher rejects non-AppLocator receivers with a clear error', async () => {
  const err = await expect('not a locator' as any)
      .toBeVisible({ timeout: 50 })
      .then(() => null, e => e as Error);
  expect(err).not.toBeNull();
  expect(err!.message).toMatch(/expected an AppLocator/);
});

test('web Locator duck-typed input falls through to web semantics', async () => {
  let visibleCalls = 0;
  const fakeWebLocator = {
    waitFor: async () => {},
    isVisible: async () => { visibleCalls++; return true; },
    isHidden: async () => false,
    isEnabled: async () => true,
    isDisabled: async () => false,
    isChecked: async () => true,
    textContent: async () => 'hello world',
    getAttribute: async (name: string) => name === 'data-test' ? 'value-x' : null,
    inputValue: async () => 'typed-in',
    count: async () => 3,
    evaluate: async () => true,
  };

  await expect(fakeWebLocator as any).toBeVisible({ timeout: 200 });
  expect(visibleCalls).toBeGreaterThan(0);
  await expect(fakeWebLocator as any).not.toBeHidden({ timeout: 200 });
  await expect(fakeWebLocator as any).toBeEnabled({ timeout: 200 });
  await expect(fakeWebLocator as any).not.toBeDisabled({ timeout: 200 });
  await expect(fakeWebLocator as any).toBeChecked({ timeout: 200 });
  await expect(fakeWebLocator as any).toBeFocused({ timeout: 200 });
  await expect(fakeWebLocator as any).toHaveText('hello world', { timeout: 200 });
  await expect(fakeWebLocator as any).toContainText('hello', { timeout: 200 });
  await expect(fakeWebLocator as any).toHaveAttribute('data-test', 'value-x', { timeout: 200 });
  await expect(fakeWebLocator as any).toHaveValue('typed-in', { timeout: 200 });
  await expect(fakeWebLocator as any).toHaveCount(3, { timeout: 200 });
});

test('web Locator polling waits and surfaces timeout details', async () => {
  let value = 'before';
  const fakeWebLocator = {
    waitFor: async () => {},
    textContent: async () => value,
    isVisible: async () => false,
    isHidden: async () => true,
    isEnabled: async () => false,
    isDisabled: async () => true,
    isChecked: async () => false,
    getAttribute: async () => null,
    inputValue: async () => '',
    count: async () => 0,
    evaluate: async () => false,
  };
  setTimeout(() => { value = 'after'; }, 50);
  await expect(fakeWebLocator as any).toContainText('after', { timeout: 400 });

  const err = await expect(fakeWebLocator as any)
      .toContainText('never', { timeout: 100 })
      .then(() => null, (e: Error) => e);
  expect(err).not.toBeNull();
  expect(err!.message).toMatch(/within 100ms/);
});

test('toHaveScreenshot for non-mobile target throws an actionable error', async () => {
  const fakePage = { waitFor: async () => {}, isVisible: async () => true } as any;
  const err = await expect(fakePage)
      .toHaveScreenshot()
      .then(() => null, (e: Error) => e);
  expect(err).not.toBeNull();
  expect(err!.message).toMatch(/import `expect` from `@playwright\/test`/);
});
