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

import { Appium, AppiumDevice } from '../../packages/playwright-core/src/server/appium';
import { createRootSdkObject, SdkObject } from '../../packages/playwright-core/src/server/instrumentation';

class MockAppium extends Appium {
  connect(progress: any, params: any): Promise<AppiumDevice> {
    throw new Error('Method not implemented.');
  }
}

class MockAppiumDevice extends AppiumDevice {
  constructor(parent: SdkObject) {
    super(parent, {
      sessionId: 'test-session-id',
      capabilities: { platformName: 'Android', 'appium:automationName': 'UiAutomator2' },
      getLogs: async () => []
    } as any);
  }
  appLocator(chain: any[], options?: any): Promise<any> {
    throw new Error('Method not implemented.');
  }
  screenshot(progress: any, params: any): Promise<Buffer> {
    throw new Error('Method not implemented.');
  }
  request(progress: any, params: any): Promise<{ result?: any }> {
    throw new Error('Method not implemented.');
  }
  close(progress: any): Promise<void> {
    throw new Error('Method not implemented.');
  }
}

test.describe('AppiumDispatcher Concurrency and Stress Tests', () => {
  test('AppiumDeviceDispatcher request forwarding under concurrent load does not cross-talk', async () => {
    const CONCURRENT_COUNT = 150;
    const root = createRootSdkObject();
    const mockAppium = new MockAppium(root);
    const mockDevice = new MockAppiumDevice(root);

    // Mock request handler with random delay and echo capability
    mockDevice.request = async (progress, params) => {
      const delay = Math.random() * 20;
      await new Promise(resolve => setTimeout(resolve, delay));
      return {
        result: {
          echoedParams: params,
          handledAt: Date.now()
        }
      };
    };

    const connection = new DispatcherConnection();
    const rootDispatcher = new RootDispatcher(connection);
    const appiumDispatcher = new AppiumDispatcher(rootDispatcher, mockAppium);
    const deviceDispatcher = new AppiumDeviceDispatcher(appiumDispatcher, mockDevice);

    const promises = Array.from({ length: CONCURRENT_COUNT }).map((_, index) => {
      const params = {
        method: 'POST',
        path: `/session/test-session-id/element`,
        body: { index, uuid: `uuid-${index}-${Math.random()}` }
      };
      
      return deviceDispatcher.request(params, {} as any).then(res => {
        expect(res.result).toBeDefined();
        expect(res.result.echoedParams).toEqual(params);
        expect(res.result.echoedParams.body.index).toBe(index);
      });
    });

    await Promise.all(promises);
  });

  test('AppiumDeviceDispatcher console message dispatching concurrently under load', async () => {
    const CONCURRENT_COUNT = 200;
    const root = createRootSdkObject();
    const mockAppium = new MockAppium(root);
    const mockDevice = new MockAppiumDevice(root);

    const connection = new DispatcherConnection();
    const rootDispatcher = new RootDispatcher(connection);
    const appiumDispatcher = new AppiumDispatcher(rootDispatcher, mockAppium);
    const _deviceDispatcher = new AppiumDeviceDispatcher(appiumDispatcher, mockDevice);

    const dispatchedMessages: any[] = [];
    connection.onmessage = (msg: any) => {
      if (msg.method === 'console') {
        dispatchedMessages.push(msg.params);
      }
    };

    // Emit concurrent console messages
    const promises = Array.from({ length: CONCURRENT_COUNT }).map((_, index) => {
      const consoleMsg = {
        type: 'log',
        text: `Log number ${index}`,
        timestamp: Date.now() + index,
        location: { url: '', lineNumber: 0, columnNumber: 0 },
        args: []
      };

      // Emit after small random timeout
      return new Promise<void>(resolve => {
        setTimeout(() => {
          mockDevice.emit('console', consoleMsg);
          resolve();
        }, Math.random() * 20);
      });
    });

    await Promise.all(promises);

    // Verify all console messages were successfully dispatched through connection
    expect(dispatchedMessages.length).toBe(CONCURRENT_COUNT);
    
    // Check that we got all messages without loss or state corruption
    const texts = dispatchedMessages.map(m => m.text);
    for (let index = 0; index < CONCURRENT_COUNT; index++) {
      expect(texts).toContain(`Log number ${index}`);
    }
  });
});
