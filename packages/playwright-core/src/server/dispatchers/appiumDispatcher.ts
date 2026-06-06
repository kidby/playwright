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

import { Dispatcher } from './dispatcher';
import { AppLocatorDispatcher } from './appLocatorDispatcher';
import type { Appium, AppiumDevice } from '../appium';
import type * as channels from '@protocol/channels';
import type { Progress } from '@protocol/progress';

export class AppiumDispatcher extends Dispatcher<Appium, channels.AppiumChannel, Dispatcher<any, any, any>> implements channels.AppiumChannel {
  _type_Appium = true;

  constructor(scope: Dispatcher<any, any, any>, appium: Appium) {
    super(scope, appium, 'Appium', {});
  }

  async connect(params: channels.AppiumConnectParams, progress: Progress): Promise<channels.AppiumConnectResult> {
    const device = await this._object.connect(progress, params);
    return { device: new AppiumDeviceDispatcher(this, device) };
  }
}

export class AppiumDeviceDispatcher extends Dispatcher<AppiumDevice, channels.AppiumDeviceChannel, AppiumDispatcher> implements channels.AppiumDeviceChannel {
  _type_AppiumDevice = true;

  constructor(scope: AppiumDispatcher, device: AppiumDevice) {
    super(scope, device, 'AppiumDevice', {
      sessionId: device.client.sessionId,
      capabilities: device.client.capabilities,
    });
    this.addObjectListener('console', (message: channels.ConsoleMessage) => {
      this._dispatchEvent('console', message);
    });
  }

  async appLocator(params: channels.AppiumDeviceAppLocatorParams, progress: Progress): Promise<channels.AppiumDeviceAppLocatorResult> {
    const locator = await this._object.appLocator(params.chain, params.options);
    return { locator: new AppLocatorDispatcher(this, locator) };
  }

  async screenshot(params: channels.AppiumDeviceScreenshotParams, progress: Progress): Promise<channels.AppiumDeviceScreenshotResult> {
    const binary = await this._object.screenshot(progress, params);
    return { binary };
  }

  async request(params: channels.AppiumDeviceRequestParams, progress: Progress): Promise<channels.AppiumDeviceRequestResult> {
    const { result } = await this._object.request(progress, params);
    return { result };
  }

  async close(params: channels.AppiumDeviceCloseParams, progress: Progress): Promise<void> {
    await this._object.close(progress);
  }
}
