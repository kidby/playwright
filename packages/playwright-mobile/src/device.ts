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

import { AppiumClient   } from './appiumClient';
import { AppLocator } from './appLocator';
import { gestures  } from './gestures';
import type { AppiumCapabilities, LocatorStrategy } from './appiumClient';
import type { GestureApi } from './gestures';

export class Device {
  readonly client: AppiumClient;
  readonly gestures: GestureApi;
  readonly app: AppLocator;

  private constructor(client: AppiumClient) {
    this.client = client;
    this.app = new AppLocator(client, []);
    this.gestures = gestures(client);
  }

  static async start(serverUrl: string, capabilities: AppiumCapabilities): Promise<Device> {
    const client = new AppiumClient(serverUrl);
    await client.createSession(capabilities);
    return new Device(client);
  }

  static attach(serverUrl: string, sessionId: string): Device {
    const client = new AppiumClient(serverUrl);
    client.attachSession(sessionId);
    return new Device(client);
  }

  get platform(): 'iOS' | 'Android' | undefined {
    return this.client.capabilities?.platformName as 'iOS' | 'Android' | undefined;
  }

  get isAndroid() { return this.platform === 'Android'; }
  get isIos() { return this.platform === 'iOS'; }

  async stop() {
    await this.client.deleteSession();
  }

  async screenshot(): Promise<Buffer> {
    return await this.client.screenshot();
  }

  async switchToContext(name: string | undefined) {
    await this.client.setContext(name ?? 'NATIVE_APP');
  }

  async contexts(): Promise<string[]> {
    return await this.client.getContexts();
  }

  async currentContext(): Promise<string> {
    return await this.client.getCurrentContext();
  }

  async findElementRaw(using: LocatorStrategy, value: string) {
    return await this.client.findElement(using, value);
  }
}
