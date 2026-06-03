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

import { Dispatcher } from './dispatcher.js';
import { IosDevice } from '../ios/ios.js';

import type { RootDispatcher } from './dispatcher.js';
import type { Ios } from '../ios/ios.js';
import type * as channels from '@protocol/channels';
import type { Progress } from '@protocol/progress';

export class IosDispatcher extends Dispatcher<Ios, channels.IosChannel, RootDispatcher> implements channels.IosChannel {
  _type_Ios = true;
  private readonly _denyLaunch: boolean;

  constructor(scope: RootDispatcher, ios: Ios, denyLaunch: boolean) {
    super(scope, ios, 'Ios', {});
    this._denyLaunch = denyLaunch;
  }

  async devices(params: channels.IosDevicesParams, progress: Progress): Promise<channels.IosDevicesResult> {
    if (this._denyLaunch)
      throw new Error(`Connecting to iOS devices is not allowed.`);
    const devices = await this._object.devices(progress, params);
    return {
      devices: devices.map(d => IosDeviceDispatcher.from(this, d)),
    };
  }
}

export class IosDeviceDispatcher extends Dispatcher<IosDevice, channels.IosDeviceChannel, IosDispatcher> implements channels.IosDeviceChannel {
  _type_IosDevice = true;

  static from(scope: IosDispatcher, device: IosDevice): IosDeviceDispatcher {
    const result = scope.connection.existingDispatcher<IosDeviceDispatcher>(device);
    return result || new IosDeviceDispatcher(scope, device);
  }

  constructor(scope: IosDispatcher, device: IosDevice) {
    super(scope, device, 'IosDevice', {
      udid: device.udid,
      name: device.name,
      osVersion: device.osVersion,
      platform: 'iOS',
      isSimulator: device.isSimulator,
    });
    this.addObjectListener(IosDevice.Events.WebViewAdded, (webView: channels.IosWebView) => this._dispatchEvent('webViewAdded', { webView }));
    this.addObjectListener(IosDevice.Events.WebViewRemoved, (bundleId: string) => this._dispatchEvent('webViewRemoved', { bundleId }));
    this.addObjectListener(IosDevice.Events.Close, () => this._dispatchEvent('close'));
  }

  async tap(params: channels.IosDeviceTapParams, progress: Progress): Promise<void> {
    await this._object.tap(progress, params);
  }

  async fill(params: channels.IosDeviceFillParams, progress: Progress): Promise<void> {
    await this._object.fill(progress, params);
  }

  async screenshot(params: channels.IosDeviceScreenshotParams, progress: Progress): Promise<channels.IosDeviceScreenshotResult> {
    return { binary: await this._object.screenshot(progress) };
  }

  async webViews(params: channels.IosDeviceWebViewsParams, progress: Progress): Promise<channels.IosDeviceWebViewsResult> {
    return { webViews: await this._object.webViews(progress) };
  }

  async executeScript(params: channels.IosDeviceExecuteScriptParams, progress: Progress): Promise<channels.IosDeviceExecuteScriptResult> {
    const result = await this._object.executeScript(progress, params);
    return { result };
  }

  async close(_params: channels.IosDeviceCloseParams, progress: Progress): Promise<void> {
    await progress.race(this._object.close());
  }
}
