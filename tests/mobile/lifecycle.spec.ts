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

import { NativeDevice, androidCapabilities, iosCapabilities } from '../../packages/playwright-mobile/src/index.js';
import { startMockAppium } from './mockAppium.js';

import type { MockAppium } from './mockAppium.js';

let mock: MockAppium;
test.beforeEach(async () => { mock = await startMockAppium(); });
test.afterEach(async () => { await mock.close(); });

function captureScript(mock: MockAppium, name: string): { args?: unknown } | undefined {
  for (let i = mock.requests.length - 1; i >= 0; i--) {
    const r = mock.requests[i];
    if (r.method === 'POST' && r.path.endsWith('/execute/sync') && r.body?.script === name)
      return r.body;
  }
  return undefined;
}

test('shell on Android sends mobile: shell with command + args', async () => {
  mock.setResponder(req => {
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: shell')
      return { body: { value: 'file1\nfile2\nfile3' } };
  });
  const device = await NativeDevice.start(mock.url, androidCapabilities({ appPackage: 'com.example' }));
  const out = await device.shell('ls', ['/data/local/tmp']);
  expect(out).toBe('file1\nfile2\nfile3');
  expect(captureScript(mock, 'mobile: shell')?.args).toEqual([{ command: 'ls', args: ['/data/local/tmp'] }]);
  await device.stop();
});

test('shell throws on iOS', async () => {
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  const error: Error = await device.shell('ls').then(() => new Error('expected failure'), e => e as Error);
  expect(error.message).toContain('Android-only');
  await device.stop();
});

test('activateApp / terminateApp pass the id under both bundleId and appId', async () => {
  const device = await NativeDevice.start(mock.url, androidCapabilities({ appPackage: 'com.example' }));
  await device.activateApp('com.example');
  expect(captureScript(mock, 'mobile: activateApp')?.args).toEqual([{ bundleId: 'com.example', appId: 'com.example' }]);
  await device.terminateApp('com.example');
  expect(captureScript(mock, 'mobile: terminateApp')?.args).toEqual([{ bundleId: 'com.example', appId: 'com.example' }]);
  await device.stop();
});

test('pushFile base64-encodes string content', async () => {
  const device = await NativeDevice.start(mock.url, androidCapabilities({ appPackage: 'com.example' }));
  await device.pushFile('/sdcard/hello.txt', 'hello world');
  const args = captureScript(mock, 'mobile: pushFile')?.args as Array<{ remotePath: string; payload: string }>;
  expect(args[0].remotePath).toBe('/sdcard/hello.txt');
  expect(Buffer.from(args[0].payload, 'base64').toString('utf-8')).toBe('hello world');
  await device.stop();
});

test('pushFile base64-encodes Buffer content', async () => {
  const device = await NativeDevice.start(mock.url, androidCapabilities({ appPackage: 'com.example' }));
  await device.pushFile('/sdcard/bin.dat', Buffer.from([0x01, 0x02, 0x03, 0xff]));
  const args = captureScript(mock, 'mobile: pushFile')?.args as Array<{ payload: string }>;
  expect(Buffer.from(args[0].payload, 'base64')).toEqual(Buffer.from([0x01, 0x02, 0x03, 0xff]));
  await device.stop();
});

test('pullFile decodes the returned base64 payload', async () => {
  mock.setResponder(req => {
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: pullFile')
      return { body: { value: Buffer.from('pulled bytes').toString('base64') } };
  });
  const device = await NativeDevice.start(mock.url, androidCapabilities({ appPackage: 'com.example' }));
  const buf = await device.pullFile('/sdcard/x');
  expect(buf.toString('utf-8')).toBe('pulled bytes');
  await device.stop();
});

test('filesCount runs ls and counts grep matches', async () => {
  mock.setResponder(req => {
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: shell')
      return { body: { value: 'cache.txt\ndata-001.log\ndata-002.log\nignore.png' } };
  });
  const device = await NativeDevice.start(mock.url, androidCapabilities({ appPackage: 'com.example' }));
  expect(await device.filesCount('/sdcard/foo')).toBe(4);
  expect(await device.filesCount('/sdcard/foo', 'data-')).toBe(2);
  await device.stop();
});
