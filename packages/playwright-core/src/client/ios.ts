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

import fs from 'fs';

import { ChannelOwner } from './channelOwner.js';

import type * as channels from '@protocol/channels';

export type IosSelector = channels.IosSelector;
export type IosDevicesOptions = {
  serverUrl?: string;
  capabilities?: Record<string, unknown>;
  udids?: string[];
};
export type IosWebView = channels.IosWebView;

export class Ios extends ChannelOwner<channels.IosChannel> {
  static from(ios: channels.IosChannel): Ios {
    return (ios as any)._object;
  }

  async devices(options: IosDevicesOptions = {}): Promise<IosDevice[]> {
    const { devices } = await this._channel.devices({
      serverUrl: options.serverUrl,
      capabilities: options.capabilities,
      udids: options.udids,
    });
    return devices.map(d => IosDevice.from(d));
  }
}

export class IosDevice extends ChannelOwner<channels.IosDeviceChannel> {
  static from(device: channels.IosDeviceChannel): IosDevice {
    return (device as any)._object;
  }

  constructor(parent: ChannelOwner, type: string, guid: string, initializer: channels.IosDeviceInitializer) {
    super(parent, type, guid, initializer);
    this._channel.on('webViewAdded', ({ webView }) => this.emit('webView', webView));
    this._channel.on('webViewRemoved', ({ bundleId }) => this.emit('webViewRemoved', bundleId));
    this._channel.on('close', () => this.emit('close'));
  }

  udid(): string { return this._initializer.udid; }
  name(): string { return this._initializer.name; }
  osVersion(): string { return this._initializer.osVersion; }
  isSimulator(): boolean { return this._initializer.isSimulator; }

  async tap(selector: IosSelector, options: { timeout?: number } = {}): Promise<void> {
    await this._channel.tap({ iosSelector: selector, timeout: options.timeout ?? 30_000 });
  }

  async fill(selector: IosSelector, text: string, options: { timeout?: number } = {}): Promise<void> {
    await this._channel.fill({ iosSelector: selector, text, timeout: options.timeout ?? 30_000 });
  }

  async screenshot(options: { path?: string } = {}): Promise<Buffer> {
    const { binary } = await this._channel.screenshot({});
    if (options.path)
      await fs.promises.writeFile(options.path, binary);
    return binary;
  }

  async webViews(): Promise<IosWebView[]> {
    const { webViews } = await this._channel.webViews({});
    return webViews;
  }

  async executeScript<T = unknown>(script: string, args?: unknown): Promise<T> {
    const { result } = await this._channel.executeScript({ script, args });
    return result as T;
  }

  async close(): Promise<void> {
    await this._channel.close({});
  }
}
