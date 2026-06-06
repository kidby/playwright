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

import { ChannelOwner } from './channelOwner';
import { AppLocator } from './appLocator';
import { connectToEndpoint } from './connect';
import type * as channels from '@protocol/channels';

export class Appium extends ChannelOwner<channels.AppiumChannel> {
  static from(appium: channels.AppiumChannel): Appium {
    return (appium as any)._object;
  }

  async connect(serverUrl: string, capabilities: any): Promise<AppiumDevice> {
    const { device } = await this._channel.connect({ serverUrl, capabilities });
    return AppiumDevice.from(device);
  }

  async connectToCloud(wsEndpoint: string, capabilities: any): Promise<AppiumDevice> {
    const connection = await connectToEndpoint(this._connection, {
      endpoint: wsEndpoint,
      headers: {},
      timeout: 0,
    });
    
    // Initialize the remote Playwright server running in the cloud
    const remotePlaywright = await connection.initializePlaywright();
    
    // Ask the remote Playwright server to connect to Appium.
    // The remote Playwright server (the Cloud Orchestrator) will intercept this,
    // dynamically provision the physical device or Docker container matching
    // capabilities['appium:deviceName'], and bridge the RPC connection to it.
    const device = await remotePlaywright.appium.connect('cloud-provisioned', capabilities);
    
    // Bind connection close to device close
    device.on('close', () => connection.close());
    
    return device;
  }
}

export class AppiumDevice extends ChannelOwner<channels.AppiumDeviceChannel> {
  static from(device: channels.AppiumDeviceChannel): AppiumDevice {
    return (device as any)._object;
  }

  appLocator(chain: any[], options?: any): AppLocator {
    // We create the AppLocator client side and it initializes itself over the channel.
    // Wait, the protocol says AppLocator is returned from appLocator command.
    return AppLocator.from((this._channel as any).appLocator({ chain, options }));
  }

  async request(method: string, path: string, body?: any): Promise<any> {
    const { result } = await this._channel.request({ method, path, body });
    return result;
  }

  async screenshot(options: { timeout?: number } = {}): Promise<Buffer> {
    const { binary } = await this._channel.screenshot({ timeout: options.timeout });
    return binary;
  }

  async close(): Promise<void> {
    await this._channel.close({});
  }
}
