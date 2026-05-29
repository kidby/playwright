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

import { NativeDevice, iosCapabilities } from '../../packages/playwright-mobile/src/index.js';
import { startMockAppium } from './mockAppium.js';

import type { MockAppium } from './mockAppium.js';

let mock: MockAppium;
test.beforeEach(async () => { mock = await startMockAppium(); });
test.afterEach(async () => { await mock.close(); });

function alertCalls(mock: MockAppium) {
  return mock.requests.filter(r =>
    r.method === 'POST'
    && r.path.endsWith('/execute/sync')
    && r.body?.script === 'mobile: alert',
  );
}

test('accepts alert on first try when present', async () => {
  mock.setResponder(req => {
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: alert')
      return { body: { value: null } };
  });
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  await device.handleAlert({ action: 'accept' });
  const calls = alertCalls(mock);
  expect(calls.length).toBe(1);
  expect(calls[0].body.args).toEqual([{ action: 'accept', buttonLabel: undefined }]);
  await device.stop();
});

test('passes buttonName through as buttonLabel', async () => {
  mock.setResponder(req => {
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: alert')
      return { body: { value: null } };
  });
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  await device.handleAlert({ action: 'accept', buttonName: 'Allow' });
  expect(alertCalls(mock)[0].body.args).toEqual([{ action: 'accept', buttonLabel: 'Allow' }]);
  await device.stop();
});

test('retries on failure and succeeds when alert eventually appears', async () => {
  let attempts = 0;
  mock.setResponder(req => {
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: alert') {
      attempts++;
      if (attempts < 3)
        return { status: 500, body: { value: { error: 'no such alert', message: 'no alert open' } } };
      return { body: { value: null } };
    }
  });
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  await device.handleAlert({ action: 'dismiss', retries: 5, pollMs: 25 });
  expect(attempts).toBe(3);
  await device.stop();
});

test('returns silently after exhausting retries (no alert appeared)', async () => {
  let attempts = 0;
  mock.setResponder(req => {
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: alert') {
      attempts++;
      return { status: 500, body: { value: { error: 'no such alert' } } };
    }
  });
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  await device.handleAlert({ action: 'accept', retries: 2, pollMs: 10 });
  expect(attempts).toBe(3);
  await device.stop();
});
