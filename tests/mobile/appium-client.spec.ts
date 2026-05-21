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

import { AppiumClient } from '../../packages/playwright-mobile/src/appiumClient';
import { startMockAppium } from './mockAppium';

test('createSession sends W3C capability envelope and stores returned id', async () => {
  const server = await startMockAppium();
  try {
    const client = new AppiumClient(server.url);
    const id = await client.createSession({
      'platformName': 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'Pixel 6',
    });
    expect(id).toBe('mock-session-1');
    expect(client.sessionId).toBe('mock-session-1');

    const createReq = server.requests.find(r => r.method === 'POST' && r.path === '/session')!;
    expect(createReq.body.capabilities.alwaysMatch.platformName).toBe('Android');
    expect(createReq.body.capabilities.firstMatch).toEqual([{}]);
  } finally {
    await server.close();
  }
});

test('createSession throws when server omits sessionId', async () => {
  const server = await startMockAppium();
  try {
    server.setResponder(req => req.path === '/session' ? { body: { value: {} } } : undefined);
    const client = new AppiumClient(server.url);
    await expect(client.createSession({ 'platformName': 'Android', 'appium:automationName': 'UiAutomator2' }))
        .rejects.toThrow(/did not return a sessionId/);
  } finally {
    await server.close();
  }
});

test('findElement normalises both W3C key and legacy ELEMENT', async () => {
  const server = await startMockAppium();
  try {
    const client = new AppiumClient(server.url);
    await client.createSession({ 'platformName': 'Android', 'appium:automationName': 'UiAutomator2' });

    // W3C-key response
    server.setNextElementId('login-btn');
    const a = await client.findElement('accessibility id', 'login');
    expect(a.ELEMENT).toBe('login-btn');

    // Legacy ELEMENT response
    server.setResponder(req => {
      if (req.method === 'POST' && /\/element$/.test(req.path))
        return { body: { value: { ELEMENT: 'legacy-btn' } } };
      return undefined;
    });
    const b = await client.findElement('accessibility id', 'login');
    expect(b.ELEMENT).toBe('legacy-btn');
  } finally {
    await server.close();
  }
});

test('error responses surface server message', async () => {
  const server = await startMockAppium();
  try {
    server.setResponder(req => {
      if (req.path === '/session')
        return { body: { value: { sessionId: 's' } } };
      if (/\/element$/.test(req.path))
        return { status: 404, body: { value: { error: 'no such element', message: 'unable to locate element' } } };
      return undefined;
    });
    const client = new AppiumClient(server.url);
    await client.createSession({ 'platformName': 'Android', 'appium:automationName': 'UiAutomator2' });
    await expect(client.findElement('accessibility id', 'nope')).rejects.toThrow(/unable to locate element/);
  } finally {
    await server.close();
  }
});

test('requireSession guards calls before createSession', async () => {
  const server = await startMockAppium();
  try {
    const client = new AppiumClient(server.url);
    await expect(client.findElement('accessibility id', 'x')).rejects.toThrow(/No active Appium session/);
  } finally {
    await server.close();
  }
});

test('sendKeys uses W3C { text } shape, not legacy { value: [] }', async () => {
  const server = await startMockAppium();
  try {
    const client = new AppiumClient(server.url);
    await client.createSession({ 'platformName': 'Android', 'appium:automationName': 'UiAutomator2' });
    server.setNextElementId('field-1');
    const el = await client.findElement('accessibility id', 'email');
    await client.sendKeys(el, 'hello@example.com');
    const sendReq = server.requests.find(r => r.method === 'POST' && /\/value$/.test(r.path))!;
    expect(sendReq.body).toEqual({ text: 'hello@example.com' });
  } finally {
    await server.close();
  }
});

test('screenshot decodes base64 to Buffer', async () => {
  const server = await startMockAppium();
  try {
    const client = new AppiumClient(server.url);
    await client.createSession({ 'platformName': 'iOS', 'appium:automationName': 'XCUITest' });
    const buf = await client.screenshot();
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.toString('utf-8')).toBe('PNG-bytes');
  } finally {
    await server.close();
  }
});

test('contexts + setContext round-trip', async () => {
  const server = await startMockAppium();
  try {
    const client = new AppiumClient(server.url);
    await client.createSession({ 'platformName': 'Android', 'appium:automationName': 'UiAutomator2' });
    expect(await client.getContexts()).toEqual(['NATIVE_APP', 'WEBVIEW_chrome']);
    await client.setContext('WEBVIEW_chrome');
    const setReq = server.requests.find(r => r.method === 'POST' && /\/context$/.test(r.path))!;
    expect(setReq.body).toEqual({ name: 'WEBVIEW_chrome' });
  } finally {
    await server.close();
  }
});
