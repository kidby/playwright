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

export type CloudConnectOptions = {
  /** Authentication token for the cloud service. Overrides `PLAYWRIGHT_MOBILE_TOKEN` env var. */
  token?: string;
  /** Connection timeout in milliseconds. Default: 30000 (30s). */
  timeout?: number;
  /** Extra HTTP headers to send with the WebSocket upgrade request. */
  headers?: Record<string, string>;
  /** Slow down every command by this many milliseconds. Useful for debugging. */
  slowMo?: number;
  /** Optional log callback for cloud connection lifecycle events. */
  logger?: (message: string) => void;
};

export class Appium extends ChannelOwner<channels.AppiumChannel> {
  static from(appium: channels.AppiumChannel): Appium {
    return (appium as any)._object;
  }

  async connect(serverUrl: string, capabilities: any): Promise<AppiumDevice> {
    const { device } = await this._channel.connect({ serverUrl, capabilities });
    return AppiumDevice.from(device);
  }

  /**
   * Connects to a remote Playwright Cloud device farm via WebSocket.
   *
   * The cloud orchestrator provisions a physical or virtual device matching
   * the requested capabilities, then bridges the RPC connection so all
   * subsequent `AppiumDevice` / `AppLocator` calls are transparently proxied.
   *
   * **Note on secrets**: Capabilities passed here or in `extra` should not contain
   * sensitive credentials, as they may be logged by cloud test runners.
   *
   * @example
   * ```ts
   * const device = await playwright.appium.connectToCloud(
   *   'wss://mobile.playwright.dev',
   *   { platformName: 'Android', 'appium:deviceName': 'Pixel 8' },
   *   { token: process.env.PLAYWRIGHT_MOBILE_TOKEN, timeout: 60_000 }
   * );
   * ```
   */
  async connectToCloud(
    wsEndpoint: string,
    capabilities: any,
    options: CloudConnectOptions = {},
  ): Promise<AppiumDevice> {
    const token = options.token || process.env.PLAYWRIGHT_MOBILE_TOKEN;
    const timeout = options.timeout ?? 30_000;
    const log = options.logger ?? (() => {});

    // Build auth + custom headers for the WebSocket upgrade request.
    const headers: Record<string, string> = { ...options.headers };
    if (token)
      headers['Authorization'] = `Bearer ${token}`;
    // Note: capabilities are passed securely over the WebSocket in the
    // `appium.connect` RPC call below, preventing leaks in proxy logs.

    log(`Connecting to ${wsEndpoint} (timeout=${timeout}ms)`);

    const connection = await connectToEndpoint(this._connection, {
      endpoint: wsEndpoint,
      headers,
      timeout,
      slowMo: options.slowMo,
    });

    log('WebSocket connected, initializing remote Playwright...');

    // Initialize the remote Playwright server running in the cloud.
    const remotePlaywright = await connection.initializePlaywright();

    log('Remote Playwright initialized, requesting device...');

    // Ask the remote Playwright server to connect to Appium.
    // The remote Playwright server (the Cloud Orchestrator) intercepts this,
    // dynamically provisions the physical device or Docker container matching
    // the requested capabilities, and bridges the RPC connection to it.
    const device = await (remotePlaywright as any).appium.connect('cloud-provisioned', capabilities);

    log(`Device allocated: ${device.sessionId ?? 'unknown'}`);

    // Lifecycle binding: when the device is closed, tear down the WS connection.
    device.on('close', () => {
      log('Device closed, tearing down cloud connection');
      connection.close();
    });

    // Reverse binding: if the cloud drops, emit close on the device.
    connection.on('close', () => {
      log('Cloud connection lost');
      device.emit('close');
    });

    return device;
  }
}

export type AppiumDeviceEvents = {
  close: [];
  console: [{ type: string; text: string }];
};

export class AppiumDevice extends ChannelOwner<channels.AppiumDeviceChannel> {
  private _closed = false;
  readonly sessionId: string | undefined;
  readonly capabilities: any;

  static from(device: channels.AppiumDeviceChannel): AppiumDevice {
    return (device as any)._object;
  }

  constructor(
    parent: ChannelOwner,
    type: string,
    guid: string,
    initializer: { sessionId?: string; capabilities?: any },
  ) {
    super(parent, type, guid, initializer);
    this.sessionId = initializer.sessionId;
    this.capabilities = initializer.capabilities;
    this._channel.on('console', (event: any) => {
      this.emit('console', event);
    });
  }

  appLocator(chain: any[], options?: any): AppLocator {
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
    if (this._closed)
      return;
    this._closed = true;
    try {
      await this._channel.close({});
    } finally {
      this.emit('close');
    }
  }
}

