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

test('iOS: lists webview contexts from mobile: getContexts', async () => {
  mock.setResponder(req => {
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: getContexts') {
      return { body: { value: [
        { id: 'WEBVIEW_1.0', title: 'Login', url: 'https://example.com/login', bundleId: 'com.example.app' },
        { id: 'NATIVE_APP' },
      ] } };
    }
  });
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  const contexts = await device.webViewContexts();
  expect(contexts).toEqual([
    { id: 'WEBVIEW_1.0', title: 'Login', url: 'https://example.com/login', packageOrBundleId: 'com.example.app' },
    { id: 'NATIVE_APP' },
  ]);
  await device.stop();
});

test('Android: multi-page webview produces one descriptor per page', async () => {
  mock.setResponder(req => {
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: getContexts') {
      return { body: { value: [
        'NATIVE_APP',
        {
          webviewName: 'WEBVIEW_com.foo.bar',
          info: { packageName: 'com.foo.bar' },
          pages: [
            { id: 'page-1', title: 'Tab A', url: 'https://example.com/a', attached: true, visible: true },
            { id: 'page-2', title: 'Tab B', url: 'https://example.com/b', attached: true, visible: false },
          ],
        },
      ] } };
    }
  });
  const device = await NativeDevice.start(mock.url, androidCapabilities({ appPackage: 'com.foo.bar' }));
  const contexts = await device.webViewContexts();
  expect(contexts).toEqual([
    { id: 'NATIVE_APP' },
    { id: 'WEBVIEW_com.foo.bar/page-1', title: 'Tab A', url: 'https://example.com/a', packageOrBundleId: 'com.foo.bar', attached: true, visible: true },
    { id: 'WEBVIEW_com.foo.bar/page-2', title: 'Tab B', url: 'https://example.com/b', packageOrBundleId: 'com.foo.bar', attached: true, visible: false },
  ]);
  await device.stop();
});

test('waitForWebViewContext returns once a matching context appears', async () => {
  let attempts = 0;
  mock.setResponder(req => {
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: getContexts') {
      attempts++;
      if (attempts < 3)
        return { body: { value: [{ id: 'NATIVE_APP' }] } };
      return { body: { value: [
        { id: 'WEBVIEW_1', title: 'Sign in', url: 'https://example.com/auth' },
      ] } };
    }
  });
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  const match = await device.waitForWebViewContext({ title: 'Sign in', pollMs: 50, timeoutMs: 5_000 });
  expect(match.id).toBe('WEBVIEW_1');
  expect(attempts).toBe(3);
  await device.stop();
});

test('waitForWebViewContext throws after timeout when nothing matches', async () => {
  mock.setResponder(req => {
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: getContexts')
      return { body: { value: [{ id: 'NATIVE_APP' }] } };
  });
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  const error: Error = await device.waitForWebViewContext({ title: /Never/, pollMs: 25, timeoutMs: 100 }).then(() => new Error('expected failure'), e => e as Error);
  expect(error.message).toContain('no context matched');
  expect(error.message).toContain('Never');
  await device.stop();
});

test('switchToWebViewContext calls setContext with the matched id', async () => {
  mock.setResponder(req => {
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: getContexts') {
      return { body: { value: [
        { id: 'WEBVIEW_1', title: 'Checkout', url: 'https://shop.example/cart' },
      ] } };
    }
  });
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  await device.switchToWebViewContext({ url: /\/cart/ });
  const setContextCall = mock.requests.find(r => r.method === 'POST' && r.path.endsWith('/context'));
  expect(setContextCall?.body).toEqual({ name: 'WEBVIEW_1' });
  await device.stop();
});

test('attached=false or visible=false pages are skipped', async () => {
  mock.setResponder(req => {
    if (req.method === 'POST' && req.path.endsWith('/execute/sync') && req.body?.script === 'mobile: getContexts') {
      return { body: { value: [
        {
          webviewName: 'WEBVIEW_com.app',
          info: { packageName: 'com.app' },
          pages: [
            { id: 'p1', title: 'Background', attached: false, visible: false },
            { id: 'p2', title: 'Foreground', attached: true, visible: true },
          ],
        },
      ] } };
    }
  });
  const device = await NativeDevice.start(mock.url, androidCapabilities({ appPackage: 'com.app' }));
  const error: Error = await device.waitForWebViewContext({ title: 'Background', pollMs: 25, timeoutMs: 100 }).then(() => new Error('expected failure'), e => e as Error);
  expect(error.message).toContain('no context matched');
  const ok = await device.waitForWebViewContext({ title: 'Foreground', pollMs: 25, timeoutMs: 500 });
  expect(ok.id).toBe('WEBVIEW_com.app/p2');
  await device.stop();
});
