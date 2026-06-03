/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { test, expect } from '@playwright/test';

import { AppiumClient } from '../../packages/playwright-core/src/server/ios/appiumClient.js';
import { startMockAppium } from './mockAppium.js';

test('iOS AppiumClient: createSession sends XCUITest capabilities', async () => {
  const mock = await startMockAppium();
  try {
    const client = new AppiumClient(mock.url);
    const sessionId = await client.createSession({
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:deviceName': 'iPhone 15',
      'appium:platformVersion': '17.5',
    });
    expect(sessionId).toBe('mock-session-1');

    const createRequest = mock.requests.find(r => r.method === 'POST' && r.path === '/session');
    expect(createRequest?.body?.capabilities?.alwaysMatch?.platformName).toBe('iOS');
    expect(createRequest?.body?.capabilities?.alwaysMatch?.['appium:automationName']).toBe('XCUITest');

    await client.deleteSession();
    const deleteRequest = mock.requests.find(r => r.method === 'DELETE' && /^\/session\//.test(r.path));
    expect(deleteRequest).toBeTruthy();
  } finally {
    await mock.close();
  }
});

test('iOS AppiumClient: findElement → click via accessibility id', async () => {
  const mock = await startMockAppium();
  try {
    const client = new AppiumClient(mock.url);
    await client.createSession({ platformName: 'iOS', 'appium:automationName': 'XCUITest' });

    const handle = await client.findElement('accessibility id', 'login-button');
    expect(handle.ELEMENT).toBeTruthy();

    await client.click(handle);
    const clickRequest = mock.requests.find(r => r.method === 'POST' && /\/click$/.test(r.path));
    expect(clickRequest).toBeTruthy();
  } finally {
    await mock.close();
  }
});

test('iOS AppiumClient: ios predicate string strategy', async () => {
  const mock = await startMockAppium();
  try {
    const client = new AppiumClient(mock.url);
    await client.createSession({ platformName: 'iOS', 'appium:automationName': 'XCUITest' });
    await client.findElement('-ios predicate string', 'name == "Email"');

    const findRequest = mock.requests.find(r => r.method === 'POST' && /\/element$/.test(r.path));
    expect(findRequest?.body).toEqual({ using: '-ios predicate string', value: 'name == "Email"' });
  } finally {
    await mock.close();
  }
});

test('iOS AppiumClient: ios class chain strategy', async () => {
  const mock = await startMockAppium();
  try {
    const client = new AppiumClient(mock.url);
    await client.createSession({ platformName: 'iOS', 'appium:automationName': 'XCUITest' });
    await client.findElement('-ios class chain', '**/XCUIElementTypeButton');

    const findRequest = mock.requests.find(r => r.method === 'POST' && /\/element$/.test(r.path));
    expect(findRequest?.body).toEqual({ using: '-ios class chain', value: '**/XCUIElementTypeButton' });
  } finally {
    await mock.close();
  }
});

test('iOS AppiumClient: screenshot decodes base64 to Buffer', async () => {
  const mock = await startMockAppium();
  try {
    const client = new AppiumClient(mock.url);
    await client.createSession({ platformName: 'iOS', 'appium:automationName': 'XCUITest' });
    const png = await client.screenshot();
    expect(Buffer.isBuffer(png)).toBe(true);
    expect(png.toString()).toBe('PNG-bytes');
  } finally {
    await mock.close();
  }
});

test('iOS AppiumClient: executeScript forwards mobile: commands', async () => {
  const mock = await startMockAppium();
  try {
    const client = new AppiumClient(mock.url);
    await client.createSession({ platformName: 'iOS', 'appium:automationName': 'XCUITest' });
    await client.executeScript('mobile: setLocale', [{ language: 'en', locale: 'en_US' }]);

    const execRequest = mock.requests.find(r => r.method === 'POST' && /\/execute\/sync$/.test(r.path));
    expect(execRequest?.body).toEqual({ script: 'mobile: setLocale', args: [{ language: 'en', locale: 'en_US' }] });
  } finally {
    await mock.close();
  }
});

test('iOS AppiumClient: getContexts surfaces WEBVIEW_* entries', async () => {
  const mock = await startMockAppium();
  try {
    const client = new AppiumClient(mock.url);
    await client.createSession({ platformName: 'iOS', 'appium:automationName': 'XCUITest' });
    const contexts = await client.getContexts();
    expect(contexts).toContain('NATIVE_APP');
    expect(contexts).toContain('WEBVIEW_chrome');
  } finally {
    await mock.close();
  }
});
