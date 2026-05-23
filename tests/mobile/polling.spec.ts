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

import type { MockAppium } from './mockAppium.js';

let mock: MockAppium;
test.beforeEach(async () => { mock = await startMockAppium(); });
test.afterEach(async () => { await mock.close(); });

test('waitForVisible returns once the target is displayed', async () => {
  let checks = 0;
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/displayed$/.test(req.path)) {
      checks++;
      return { body: { value: checks >= 3 } };
    }
  });
  const device = await Device.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  await device.waitForVisible(device.app.byAccessibilityId('submit'), { timeoutMs: 5_000, pollMs: 25 });
  expect(checks).toBe(3);
  await device.stop();
});

test('waitForVisible throws after timeout when target stays hidden', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/displayed$/.test(req.path))
      return { body: { value: false } };
  });
  const device = await Device.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  const error: Error = await device.waitForVisible(device.app.byAccessibilityId('missing'), { timeoutMs: 100, pollMs: 25 }).then(() => new Error('expected failure'), e => e as Error);
  expect(error.message).toContain('not visible within 100ms');
  expect(error.message).toContain('accessibility id=missing');
  await device.stop();
});

test('tapUntilVisible swipes the scroll target until the goal becomes visible', async () => {
  let displayedChecks = 0;
  let swipeCalls = 0;
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/displayed$/.test(req.path)) {
      displayedChecks++;
      return { body: { value: displayedChecks >= 3 } };
    }
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: swipe') {
      swipeCalls++;
      return { body: { value: null } };
    }
  });
  const device = await Device.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  await device.tapUntilVisible(device.app.byAccessibilityId('goal'), {
    scrollTarget: device.app.byAccessibilityId('list'),
    maxTaps: 5,
    pollMs: 10,
  });
  expect(displayedChecks).toBe(3);
  expect(swipeCalls).toBe(2);
  await device.stop();
});

test('tapUntilVisible throws after exhausting maxTaps without visibility', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/displayed$/.test(req.path))
      return { body: { value: false } };
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: swipe')
      return { body: { value: null } };
  });
  const device = await Device.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  const error: Error = await device.tapUntilVisible(device.app.byAccessibilityId('never'), {
    scrollTarget: device.app.byAccessibilityId('list'),
    maxTaps: 3,
    pollMs: 5,
  }).then(() => new Error('expected failure'), e => e as Error);
  expect(error.message).toContain('not visible (maxTaps=3');
  await device.stop();
});

test('tapUntilVisible honors timeoutMs as a separate cap from maxTaps', async () => {
  let swipes = 0;
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/displayed$/.test(req.path))
      return { body: { value: false } };
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: swipe') {
      swipes++;
      return { body: { value: null } };
    }
  });
  const device = await Device.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  const error: Error = await device.tapUntilVisible(device.app.byAccessibilityId('never'), {
    scrollTarget: device.app.byAccessibilityId('list'),
    maxTaps: 1000,
    timeoutMs: 60,
    pollMs: 30,
  }).then(() => new Error('expected failure'), e => e as Error);
  expect(error.message).toContain('timeoutMs=60');
  expect(swipes).toBeLessThan(10);
  await device.stop();
});

test('Android tapUntilVisible uses mobile: swipeGesture', async () => {
  let swipeGestureCalls = 0;
  let displayedChecks = 0;
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/displayed$/.test(req.path)) {
      displayedChecks++;
      return { body: { value: displayedChecks >= 2 } };
    }
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: getElementScreenPosition')
      return { body: { value: { x: 0, y: 0, width: 200, height: 600 } } };
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: swipeGesture') {
      swipeGestureCalls++;
      return { body: { value: null } };
    }
  });
  const device = await Device.start(mock.url, androidCapabilities({ appPackage: 'com.example' }));
  await device.tapUntilVisible(device.app.byAccessibilityId('goal'), {
    scrollTarget: device.app.byAccessibilityId('list'),
    maxTaps: 5,
    pollMs: 10,
  });
  expect(swipeGestureCalls).toBe(1);
  await device.stop();
});
