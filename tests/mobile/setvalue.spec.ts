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

import { Device, iosCapabilities, androidCapabilities } from '../../packages/playwright-mobile/src/index.js';
import { startMockAppium } from './mockAppium.js';

import type { MockAppium, RecordedRequest } from './mockAppium.js';

let mock: MockAppium;
test.beforeEach(async () => { mock = await startMockAppium(); });
test.afterEach(async () => { await mock.close(); });

function elementCalls(reqs: RecordedRequest[], suffix: string): RecordedRequest[] {
  return reqs.filter(r => r.method === 'POST' && r.path.endsWith(`/element/${suffix}`));
}

test('default setValue: click → clear → sendKeys', async () => {
  const device = await Device.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  await device.setValue(device.app.byAccessibilityId('email'), 'foo@bar.com');
  const clicks = elementCalls(mock.requests, 'el-1/click');
  const clears = elementCalls(mock.requests, 'el-1/clear');
  const sendKeys = elementCalls(mock.requests, 'el-1/value');
  expect(clicks.length).toBe(1);
  expect(clears.length).toBe(1);
  expect(sendKeys.length).toBe(1);
  expect(sendKeys[0].body).toEqual({ text: 'foo@bar.com' });
  await device.stop();
});

test('clearBefore: false skips the clear call', async () => {
  const device = await Device.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  await device.setValue(device.app.byAccessibilityId('search'), 'query', { clearBefore: false });
  const clears = elementCalls(mock.requests, 'el-1/clear');
  const sendKeys = elementCalls(mock.requests, 'el-1/value');
  expect(clears.length).toBe(0);
  expect(sendKeys.length).toBe(1);
  expect(sendKeys[0].body).toEqual({ text: 'query' });
  await device.stop();
});

test('Android: falls back to mobile: longClickGesture when /clear errors', async () => {
  let clearAttempted = false;
  let longClickCalls = 0;
  mock.setResponder(req => {
    if (req.method === 'POST' && /\/element\/[^/]+\/clear$/.test(req.path)) {
      clearAttempted = true;
      return { status: 500, body: { value: { error: 'clear failed' } } };
    }
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: longClickGesture') {
      longClickCalls++;
      return { body: { value: null } };
    }
  });
  const device = await Device.start(mock.url, androidCapabilities({ appPackage: 'com.example' }));
  await device.setValue(device.app.byAccessibilityId('field'), 'replacement');
  expect(clearAttempted).toBe(true);
  expect(longClickCalls).toBe(1);
  const sendKeys = elementCalls(mock.requests, 'el-1/value');
  expect(sendKeys.length).toBe(1);
  await device.stop();
});
