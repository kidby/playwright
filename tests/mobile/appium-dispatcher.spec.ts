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
import { DispatcherConnection, RootDispatcher } from '../../packages/playwright-core/src/server/dispatchers/dispatcher';
import { AppiumDispatcher, AppiumDeviceDispatcher } from '../../packages/playwright-core/src/server/dispatchers/appiumDispatcher';
import { AppLocatorDispatcher } from '../../packages/playwright-core/src/server/dispatchers/appLocatorDispatcher';
import { Appium, AppiumDevice } from '../../packages/playwright-core/src/server/appium';
import { AppLocator } from '../../packages/playwright-core/src/server/appLocator';
import { createRootSdkObject, SdkObject } from '../../packages/playwright-core/src/server/instrumentation';

// Mock subclasses to allow spying and overriding method behaviors
class MockAppium extends Appium {
  override connect(progress: any, params: any): Promise<AppiumDevice> {
    throw new Error('Method not implemented.');
  }
}

class MockAppiumDevice extends AppiumDevice {
  constructor(parent: SdkObject) {
    // Pass a fake AppiumClient to parent constructor
    super(parent, {} as any);
  }
  override appLocator(chain: any[], options?: any): Promise<any> {
    throw new Error('Method not implemented.');
  }
  override screenshot(progress: any, params: any): Promise<Buffer> {
    throw new Error('Method not implemented.');
  }
  override request(progress: any, params: any): Promise<{ result?: any }> {
    throw new Error('Method not implemented.');
  }
  override close(progress: any): Promise<void> {
    throw new Error('Method not implemented.');
  }
}

test.describe('AppiumDispatcher and AppiumDeviceDispatcher Unit Tests', () => {
  test('AppiumDispatcher.connect creates AppiumDeviceDispatcher and forwards params', async () => {
    const root = createRootSdkObject();
    const mockAppium = new MockAppium(root);
    const mockDevice = new MockAppiumDevice(root);
    
    let receivedProgress: any = null;
    let receivedParams: any = null;
    
    mockAppium.connect = async (progress, params) => {
      receivedProgress = progress;
      receivedParams = params;
      return mockDevice;
    };

    const connection = new DispatcherConnection();
    const rootDispatcher = new RootDispatcher(connection);
    const appiumDispatcher = new AppiumDispatcher(rootDispatcher, mockAppium);

    const dummyProgress = { url: 'dummy' } as any;
    const connectParams = { serverUrl: 'http://127.0.0.1:4723', capabilities: {} };
    
    const result = await appiumDispatcher.connect(connectParams, dummyProgress);

    expect(receivedParams).toBe(connectParams);
    expect(receivedProgress).toBe(dummyProgress);
    expect(result.device).toBeInstanceOf(AppiumDeviceDispatcher);
    expect((result.device as any)._object).toBe(mockDevice);
  });

  test('AppiumDispatcher.connect propagates connection errors', async () => {
    const root = createRootSdkObject();
    const mockAppium = new MockAppium(root);
    
    mockAppium.connect = async () => {
      throw new Error('Appium server connection timed out');
    };

    const connection = new DispatcherConnection();
    const rootDispatcher = new RootDispatcher(connection);
    const appiumDispatcher = new AppiumDispatcher(rootDispatcher, mockAppium);

    await expect(appiumDispatcher.connect({ serverUrl: 'http://127.0.0.1:4723', capabilities: {} }, {} as any))
        .rejects.toThrow('Appium server connection timed out');
  });

  test('AppiumDeviceDispatcher.appLocator creates AppLocatorDispatcher', async () => {
    const root = createRootSdkObject();
    const mockAppium = new MockAppium(root);
    const mockDevice = new MockAppiumDevice(root);
    const mockLocator = new AppLocator(mockDevice, [{ using: 'id', value: 'submit_btn' }]);
    
    let receivedChain: any = null;
    let receivedOptions: any = null;

    mockDevice.appLocator = async (chain, options) => {
      receivedChain = chain;
      receivedOptions = options;
      return mockLocator;
    };

    const connection = new DispatcherConnection();
    const rootDispatcher = new RootDispatcher(connection);
    const appiumDispatcher = new AppiumDispatcher(rootDispatcher, mockAppium);
    const deviceDispatcher = new AppiumDeviceDispatcher(appiumDispatcher, mockDevice);

    const params = { chain: [{ using: 'id', value: 'submit_btn' }], options: { timeout: 5000 } };
    const result = await deviceDispatcher.appLocator(params, {} as any);

    expect(receivedChain).toBe(params.chain);
    expect(receivedOptions).toBe(params.options);
    expect(result.locator).toBeInstanceOf(AppLocatorDispatcher);
    expect((result.locator as any)._object).toBe(mockLocator);
  });

  test('AppiumDeviceDispatcher.screenshot returns binary data', async () => {
    const root = createRootSdkObject();
    const mockAppium = new MockAppium(root);
    const mockDevice = new MockAppiumDevice(root);
    const fakeScreenshotBuffer = Buffer.from('fake-png-data');
    
    let receivedProgress: any = null;
    let receivedParams: any = null;

    mockDevice.screenshot = async (progress, params) => {
      receivedProgress = progress;
      receivedParams = params;
      return fakeScreenshotBuffer;
    };

    const connection = new DispatcherConnection();
    const rootDispatcher = new RootDispatcher(connection);
    const appiumDispatcher = new AppiumDispatcher(rootDispatcher, mockAppium);
    const deviceDispatcher = new AppiumDeviceDispatcher(appiumDispatcher, mockDevice);

    const dummyProgress = {} as any;
    const params = { timeout: 5000 };
    const result = await deviceDispatcher.screenshot(params, dummyProgress);

    expect(receivedProgress).toBe(dummyProgress);
    expect(receivedParams).toBe(params);
    expect(result.binary).toBe(fakeScreenshotBuffer);
  });

  test('AppiumDeviceDispatcher.screenshot propagates failures', async () => {
    const root = createRootSdkObject();
    const mockAppium = new MockAppium(root);
    const mockDevice = new MockAppiumDevice(root);

    mockDevice.screenshot = async () => {
      throw new Error('Screenshot acquisition failed');
    };

    const connection = new DispatcherConnection();
    const rootDispatcher = new RootDispatcher(connection);
    const appiumDispatcher = new AppiumDispatcher(rootDispatcher, mockAppium);
    const deviceDispatcher = new AppiumDeviceDispatcher(appiumDispatcher, mockDevice);

    await expect(deviceDispatcher.screenshot({ timeout: 5000 }, {} as any))
        .rejects.toThrow('Screenshot acquisition failed');
  });

  test('AppiumDeviceDispatcher.request forwards to client and returns result', async () => {
    const root = createRootSdkObject();
    const mockAppium = new MockAppium(root);
    const mockDevice = new MockAppiumDevice(root);
    const fakeResult = { status: 'success', value: true };
    
    let receivedProgress: any = null;
    let receivedParams: any = null;

    mockDevice.request = async (progress, params) => {
      receivedProgress = progress;
      receivedParams = params;
      return { result: fakeResult };
    };

    const connection = new DispatcherConnection();
    const rootDispatcher = new RootDispatcher(connection);
    const appiumDispatcher = new AppiumDispatcher(rootDispatcher, mockAppium);
    const deviceDispatcher = new AppiumDeviceDispatcher(appiumDispatcher, mockDevice);

    const dummyProgress = {} as any;
    const params = { method: 'POST', path: '/session/123/url', body: { url: 'http://example.com' } };
    const result = await deviceDispatcher.request(params, dummyProgress);

    expect(receivedProgress).toBe(dummyProgress);
    expect(receivedParams).toBe(params);
    expect(result.result).toBe(fakeResult);
  });

  test('AppiumDeviceDispatcher.close stops the device session and stops log polling', async () => {
    const root = createRootSdkObject();
    const mockAppium = new MockAppium(root);
    const mockDevice = new MockAppiumDevice(root);
    
    let receivedProgress: any = null;
    let closeCalled = false;

    mockDevice.close = async (progress) => {
      receivedProgress = progress;
      closeCalled = true;
    };

    const connection = new DispatcherConnection();
    const rootDispatcher = new RootDispatcher(connection);
    const appiumDispatcher = new AppiumDispatcher(rootDispatcher, mockAppium);
    const deviceDispatcher = new AppiumDeviceDispatcher(appiumDispatcher, mockDevice);

    const dummyProgress = {} as any;
    await deviceDispatcher.close({}, dummyProgress);

    expect(receivedProgress).toBe(dummyProgress);
    expect(closeCalled).toBe(true);
  });

  test('AppiumDeviceDispatcher forwards console events via _dispatchEvent', async () => {
    const root = createRootSdkObject();
    const mockAppium = new MockAppium(root);
    const mockDevice = new MockAppiumDevice(root);

    const connection = new DispatcherConnection();
    const rootDispatcher = new RootDispatcher(connection);
    const appiumDispatcher = new AppiumDispatcher(rootDispatcher, mockAppium);
    const deviceDispatcher = new AppiumDeviceDispatcher(appiumDispatcher, mockDevice);

    const dispatchedMessages: any[] = [];
    connection.onmessage = (msg: any) => {
      dispatchedMessages.push(msg);
    };

    const consoleMessage = {
      type: 'info',
      text: 'Log message from UiAutomator',
      timestamp: Date.now(),
      location: { url: '', lineNumber: 0, columnNumber: 0 },
      args: []
    };

    // Emit event on underlying device and check if connection received dispatcher event
    mockDevice.emit('console', consoleMessage);

    expect(dispatchedMessages.length).toBe(1);
    expect(dispatchedMessages[0]).toEqual({
      guid: deviceDispatcher._guid,
      method: 'console',
      params: consoleMessage
    });
  });
});
