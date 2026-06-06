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

import { NativeDevice, captureFailureArtifacts, iosCapabilities } from '../../packages/playwright-mobile/src/index.js';
import { startMockAppium } from './mockAppium.js';

import type { AttachableTestInfo } from '../../packages/playwright-mobile/src/index.js';
import type { MockAppium } from './mockAppium.js';

type AttachCall = { name: string; contentType: string; size: number };

function stubTestInfo(): { info: AttachableTestInfo; calls: AttachCall[] } {
  const calls: AttachCall[] = [];
  const info: AttachableTestInfo = {
    status: 'failed',
    attach: async (name, opts) => {
      const size = typeof opts.body === 'string' ? opts.body.length : opts.body.length;
      calls.push({ name, contentType: opts.contentType, size });
    },
  };
  return { info, calls };
}

let mock: MockAppium;
test.beforeEach(async () => { mock = await startMockAppium(); });
test.afterEach(async () => { await mock.close(); });

test('captureFailureArtifacts attaches mobile-snapshot + mobile-screenshot', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && req.path.endsWith('/source'))
      return { body: { value: '<?xml version="1.0"?><AppiumAUT><XCUIElementTypeButton name="OK"/></AppiumAUT>' } };
  });
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example' }));
  const { info, calls } = stubTestInfo();
  await captureFailureArtifacts(device, info);
  expect(calls.map(c => c.name).sort()).toEqual(['error-context', 'mobile-screenshot', 'mobile-snapshot']);
  const yaml = calls.find(c => c.name === 'mobile-snapshot');
  expect(yaml?.contentType).toBe('application/x-yaml');
  expect(yaml?.size).toBeGreaterThan(0);
  const png = calls.find(c => c.name === 'mobile-screenshot');
  expect(png?.contentType).toBe('image/png');
  expect(png?.size).toBeGreaterThan(0);
  await device.stop();
});

test('captureFailureArtifacts still attaches screenshot when snapshot throws', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && req.path.endsWith('/source'))
      return { status: 500, body: { value: { error: 'no such window' } } };
  });
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example' }));
  const { info, calls } = stubTestInfo();
  await captureFailureArtifacts(device, info);
  expect(calls.map(c => c.name)).toEqual(['mobile-screenshot']);
  await device.stop();
});

test('captureFailureArtifacts attaches snapshot when screenshot throws', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && req.path.endsWith('/source'))
      return { body: { value: '<AppiumAUT><XCUIElementTypeButton name="X"/></AppiumAUT>' } };
    if (req.method === 'GET' && req.path.endsWith('/screenshot'))
      return { status: 500, body: { value: { error: 'screenshot failed' } } };
  });
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example' }));
  const { info, calls } = stubTestInfo();
  await captureFailureArtifacts(device, info);
  // error-context is also attached from page source.
  expect(calls.map(c => c.name).filter(n => n !== 'error-context')).toEqual(['mobile-snapshot']);
  await device.stop();
});

test('captureFailureArtifacts swallows total failure (no session)', async () => {
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example' }));
  await device.stop();
  const { info, calls } = stubTestInfo();
  await expect(captureFailureArtifacts(device, info)).resolves.toBeUndefined();
  expect(calls).toEqual([]);
});
