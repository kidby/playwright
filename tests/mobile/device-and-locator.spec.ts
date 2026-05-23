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

import { Device } from '../../packages/playwright-mobile/src/device.js';
import { startMockAppium } from './mockAppium.js';

test('Device.start ↔ stop opens and closes a session', async () => {
  const server = await startMockAppium();
  try {
    const device = await Device.start(server.url, {
      'platformName': 'Android', 'appium:automationName': 'UiAutomator2', 'appium:deviceName': 'Pixel 6',
    });
    expect(device.client.sessionId).toBe('mock-session-1');
    expect(device.isAndroid).toBe(true);
    expect(device.isIos).toBe(false);

    await device.stop();
    expect(device.client.sessionId).toBeUndefined();
    const deleteReq = server.requests.find(r => r.method === 'DELETE' && /^\/session\/mock-session-1$/.test(r.path));
    expect(deleteReq).toBeTruthy();
  } finally {
    await server.close();
  }
});

test('AppLocator click sends right strategy + value', async () => {
  const server = await startMockAppium();
  try {
    const device = await Device.start(server.url, { 'platformName': 'Android', 'appium:automationName': 'UiAutomator2' });
    await device.app.byAccessibilityId('login').click();

    const findReq = server.requests.find(r => r.method === 'POST' && r.path === '/session/mock-session-1/element')!;
    expect(findReq.body).toEqual({ using: 'accessibility id', value: 'login' });

    const clickReq = server.requests.find(r => r.method === 'POST' && /\/click$/.test(r.path))!;
    expect(clickReq.body).toEqual({});
  } finally {
    await server.close();
  }
});

test('AppLocator chain resolves via /element/.../element', async () => {
  const server = await startMockAppium();
  try {
    const device = await Device.start(server.url, { 'platformName': 'iOS', 'appium:automationName': 'XCUITest' });
    server.setNextElementId('parent-1');
    await device.app
        .byIosClassChain('**/XCUIElementTypeCell[1]')
        .byAccessibilityId('subtitle')
        .text();

    const parentReq = server.requests.find(r => r.method === 'POST' && r.path === '/session/mock-session-1/element')!;
    expect(parentReq.body).toEqual({ using: '-ios class chain', value: '**/XCUIElementTypeCell[1]' });

    const childReq = server.requests.find(r => r.path === '/session/mock-session-1/element/parent-1/element')!;
    expect(childReq.body).toEqual({ using: 'accessibility id', value: 'subtitle' });
  } finally {
    await server.close();
  }
});

test('AppLocator.fill clears then sends keys', async () => {
  const server = await startMockAppium();
  try {
    const device = await Device.start(server.url, { 'platformName': 'Android', 'appium:automationName': 'UiAutomator2' });
    await device.app.byId('com.example:id/email').fill('a@b.c');
    const ops = server.requests
        .filter(r => /\/(clear|value|element)$/.test(r.path))
        .map(r => `${r.method} ${r.path.split('/').pop()}`);
    // Element resolved once, then clear, then sendKeys (value).
    expect(ops).toEqual(['POST element', 'POST clear', 'POST value']);
  } finally {
    await server.close();
  }
});

test('AppLocator.isDisplayed returns false when element resolution throws', async () => {
  const server = await startMockAppium();
  try {
    server.setResponder(req => {
      if (req.path === '/session')
        return { body: { value: { sessionId: 'mock-session-1' } } };
      if (req.method === 'POST' && /\/element$/.test(req.path))
        return { status: 404, body: { value: { error: 'no such element' } } };
      return undefined;
    });
    const device = await Device.start(server.url, { 'platformName': 'Android', 'appium:automationName': 'UiAutomator2' });
    expect(await device.app.byAccessibilityId('missing').isDisplayed()).toBe(false);
  } finally {
    await server.close();
  }
});

test('Device.switchToContext sends spec name (or NATIVE_APP for undefined)', async () => {
  const server = await startMockAppium();
  try {
    const device = await Device.start(server.url, { 'platformName': 'Android', 'appium:automationName': 'UiAutomator2' });
    await device.switchToContext('WEBVIEW_chrome');
    await device.switchToContext(undefined);
    const ctxReqs = server.requests.filter(r => r.method === 'POST' && /\/context$/.test(r.path));
    expect(ctxReqs.map(r => r.body.name)).toEqual(['WEBVIEW_chrome', 'NATIVE_APP']);
  } finally {
    await server.close();
  }
});
