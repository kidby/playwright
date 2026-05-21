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

import { test, expect } from '@playwright/test';

import { Device, androidCapabilities, iosCapabilities } from '../../packages/playwright-mobile/src';
import { startMockAppium } from './mockAppium';

import type { MockAppium } from './mockAppium';

let mock: MockAppium;
test.beforeEach(async () => { mock = await startMockAppium(); });
test.afterEach(async () => { await mock.close(); });

function lastScriptCall(mock: MockAppium) {
  for (let i = mock.requests.length - 1; i >= 0; i--) {
    const r = mock.requests[i];
    if (r.method === 'POST' && r.path.endsWith('/execute/sync'))
      return r;
  }
  return undefined;
}

test('pressBack sends keycode 4 on Android', async () => {
  const device = await Device.start(mock.url, androidCapabilities({ appPackage: 'com.example' }));
  await device.pressBack();
  expect(lastScriptCall(mock)?.body).toEqual({ script: 'mobile: pressKey', args: [{ keycode: 4 }] });
  await device.stop();
});

test('pressEnter / pressDelete / pressTab map to expected keycodes', async () => {
  const device = await Device.start(mock.url, androidCapabilities({ appPackage: 'com.example' }));
  await device.pressEnter();
  expect(lastScriptCall(mock)?.body.args).toEqual([{ keycode: 66 }]);
  await device.pressDelete();
  expect(lastScriptCall(mock)?.body.args).toEqual([{ keycode: 112 }]);
  await device.pressTab();
  expect(lastScriptCall(mock)?.body.args).toEqual([{ keycode: 61 }]);
  await device.stop();
});

test('pressAndroidKey HOME and SEARCH use 3 and 84', async () => {
  const device = await Device.start(mock.url, androidCapabilities({ appPackage: 'com.example' }));
  await device.pressAndroidKey('HOME');
  expect(lastScriptCall(mock)?.body.args).toEqual([{ keycode: 3 }]);
  await device.pressAndroidKey('SEARCH');
  expect(lastScriptCall(mock)?.body.args).toEqual([{ keycode: 84 }]);
  await device.stop();
});

test('pressBack throws on iOS', async () => {
  const device = await Device.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  const error = await device.pressBack().catch(e => e as Error);
  expect(error.message).toContain('Android-only');
  await device.stop();
});

test('hideKeyboard issues mobile: hideKeyboard script and swallows failures', async () => {
  let scriptHits = 0;
  mock.setResponder(req => {
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: hideKeyboard') {
      scriptHits++;
      // Simulate an Appium failure (no keyboard visible).
      return { status: 500, body: { value: { error: 'no such element', message: 'no keyboard' } } };
    }
  });
  const device = await Device.start(mock.url, androidCapabilities({ appPackage: 'com.example' }));
  await expect(device.hideKeyboard()).resolves.toBeUndefined();
  expect(scriptHits).toBe(1);
  await device.stop();
});
