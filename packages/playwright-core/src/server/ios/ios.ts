/**
 * Copyright Microsoft Corporation. All rights reserved.
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

import debug from '@utils/debugLog';
import { SdkObject } from '../instrumentation.js';
import { ManualPromise } from '@isomorphic/manualPromise';
import { AppiumClient } from './appiumClient.js';
import { listBootedSimulators } from './simctl.js';

import type { LocatorStrategy, AppiumCapabilities } from './appiumClient.js';
import type { Progress } from '../progress.js';
import type * as channels from '@protocol/channels';

const DEFAULT_SERVER_URL = 'http://127.0.0.1:4723';
const DEFAULT_TIMEOUT_MS = 30_000;
const WEBVIEW_POLL_INTERVAL_MS = 1_000;

const debugIos = debug('pw:ios');

export class Ios extends SdkObject {
  private _devices = new Map<string, IosDevice>();

  constructor(parent: SdkObject) {
    super(parent, 'ios');
  }

  async devices(progress: Progress, options: channels.IosDevicesOptions): Promise<IosDevice[]> {
    const serverUrl = options.serverUrl ?? DEFAULT_SERVER_URL;
    const userCaps = options.capabilities as AppiumCapabilities | undefined;
    const requestedUdids = options.udids;

    const targets = await progress.race(resolveTargets(requestedUdids, userCaps));
    const newUdids = new Set<string>();
    for (const target of targets) {
      newUdids.add(target.udid);
      if (this._devices.has(target.udid))
        continue;
      const device = await progress.race(IosDevice.create(this, serverUrl, target));
      this._devices.set(target.udid, device);
    }
    for (const udid of [...this._devices.keys()]) {
      if (!newUdids.has(udid))
        this._devices.delete(udid);
    }
    return [...this._devices.values()];
  }

  _deviceClosed(device: IosDevice) {
    this._devices.delete(device.udid);
  }
}

type SessionTarget = {
  udid: string;
  name: string;
  osVersion: string;
  isSimulator: boolean;
  capabilities: AppiumCapabilities;
};

async function resolveTargets(udids: string[] | undefined, userCaps: AppiumCapabilities | undefined): Promise<SessionTarget[]> {
  if (udids?.length) {
    return udids.map(udid => ({
      udid,
      name: userCaps?.['appium:deviceName'] as string ?? udid,
      osVersion: userCaps?.['appium:platformVersion'] as string ?? '',
      isSimulator: false,
      capabilities: ensureIosCapabilities({ ...userCaps, 'appium:udid': udid } as AppiumCapabilities),
    }));
  }
  const sims = await listBootedSimulators();
  if (sims.length === 0 && userCaps) {
    return [{
      udid: (userCaps['appium:udid'] as string) ?? 'unknown',
      name: (userCaps['appium:deviceName'] as string) ?? 'iOS device',
      osVersion: (userCaps['appium:platformVersion'] as string) ?? '',
      isSimulator: false,
      capabilities: ensureIosCapabilities(userCaps),
    }];
  }
  return sims.map(sim => ({
    udid: sim.udid,
    name: sim.name,
    osVersion: sim.osVersion,
    isSimulator: true,
    capabilities: ensureIosCapabilities({
      'appium:deviceName': sim.name,
      'appium:platformVersion': sim.osVersion,
      'appium:udid': sim.udid,
      ...userCaps,
    } as AppiumCapabilities),
  }));
}

function ensureIosCapabilities(caps: AppiumCapabilities): AppiumCapabilities {
  return {
    ...caps,
    platformName: caps.platformName ?? 'iOS',
    'appium:automationName': caps['appium:automationName'] ?? 'XCUITest',
  };
}

export class IosDevice extends SdkObject {
  readonly udid: string;
  readonly name: string;
  readonly osVersion: string;
  readonly isSimulator: boolean;
  readonly _client: AppiumClient;
  private readonly _ios: Ios;
  private readonly _webViews = new Map<string, channels.IosWebView>();
  private _closed = false;
  private _pollTimer: NodeJS.Timeout | undefined;

  static async create(ios: Ios, serverUrl: string, target: SessionTarget): Promise<IosDevice> {
    const client = new AppiumClient(serverUrl);
    await client.createSession(target.capabilities);
    const device = new IosDevice(ios, client, target);
    device._startWebViewPolling();
    return device;
  }

  private constructor(ios: Ios, client: AppiumClient, target: SessionTarget) {
    super(ios, 'iosDevice');
    this._ios = ios;
    this._client = client;
    this.udid = target.udid;
    this.name = target.name;
    this.osVersion = target.osVersion;
    this.isSimulator = target.isSimulator;
  }

  async tap(progress: Progress, params: channels.IosDeviceTapParams): Promise<void> {
    const { iosSelector, timeout } = params;
    const handle = await progress.race(this._waitForElement(iosSelector, timeout ?? DEFAULT_TIMEOUT_MS));
    await progress.race(this._client.click(handle));
  }

  async fill(progress: Progress, params: channels.IosDeviceFillParams): Promise<void> {
    const { iosSelector, text, timeout } = params;
    const handle = await progress.race(this._waitForElement(iosSelector, timeout ?? DEFAULT_TIMEOUT_MS));
    await progress.race(this._client.clear(handle));
    await progress.race(this._client.sendKeys(handle, text));
  }

  async screenshot(progress: Progress): Promise<Buffer> {
    return await progress.race(this._client.screenshot());
  }

  async webViews(progress: Progress): Promise<channels.IosWebView[]> {
    await progress.race(this._refreshWebViews());
    return [...this._webViews.values()];
  }

  async executeScript(progress: Progress, params: channels.IosDeviceExecuteScriptParams): Promise<unknown> {
    const args = Array.isArray(params.args) ? params.args : params.args === undefined ? [] : [params.args];
    return await progress.race(this._client.executeScript(params.script, args));
  }

  async close(): Promise<void> {
    if (this._closed)
      return;
    this._closed = true;
    if (this._pollTimer)
      clearInterval(this._pollTimer);
    this._pollTimer = undefined;
    try {
      await this._client.deleteSession();
    } catch (e) {
      debugIos(`deleteSession failed: ${(e as Error).message}`);
    }
    this._ios._deviceClosed(this);
    this.emit(IosDevice.Events.Close);
  }

  static Events = {
    Close: 'close',
    WebViewAdded: 'webViewAdded',
    WebViewRemoved: 'webViewRemoved',
  };

  private _startWebViewPolling() {
    const poll = async () => {
      if (this._closed)
        return;
      try {
        await this._refreshWebViews();
      } catch (e) {
        debugIos(`webView poll failed: ${(e as Error).message}`);
      }
    };
    this._pollTimer = setInterval(() => { void poll(); }, WEBVIEW_POLL_INTERVAL_MS);
    if (typeof this._pollTimer.unref === 'function')
      this._pollTimer.unref();
  }

  private async _refreshWebViews(): Promise<void> {
    const contexts = await this._client.getContexts();
    const observed = new Map<string, channels.IosWebView>();
    for (const contextName of contexts) {
      if (!contextName.startsWith('WEBVIEW_'))
        continue;
      const bundleId = contextName.replace(/^WEBVIEW_/, '').split('.')[0] || contextName;
      observed.set(bundleId, { bundleId, contextName, title: undefined, url: undefined });
    }
    for (const [bundleId, view] of observed) {
      if (!this._webViews.has(bundleId)) {
        this._webViews.set(bundleId, view);
        this.emit(IosDevice.Events.WebViewAdded, view);
      }
    }
    for (const bundleId of [...this._webViews.keys()]) {
      if (!observed.has(bundleId)) {
        this._webViews.delete(bundleId);
        this.emit(IosDevice.Events.WebViewRemoved, bundleId);
      }
    }
  }

  private async _waitForElement(selector: channels.IosSelector, timeoutMs: number): Promise<{ ELEMENT: string }> {
    const deadline = Date.now() + timeoutMs;
    const { using, value } = selectorToStrategy(selector);
    const settled = new ManualPromise<{ ELEMENT: string }>();
    const tryFind = async (): Promise<void> => {
      try {
        const handle = await this._client.findElement(using, value);
        settled.resolve(handle);
      } catch {
        if (Date.now() >= deadline) {
          settled.reject(new Error(`Timed out (${timeoutMs}ms) waiting for ${JSON.stringify(selector)}`));
          return;
        }
        setTimeout(() => { void tryFind(); }, 250);
      }
    };
    void tryFind();
    return settled;
  }
}

function selectorToStrategy(selector: channels.IosSelector): { using: LocatorStrategy; value: string } {
  if (selector.accessibilityId !== undefined)
    return { using: 'accessibility id', value: selector.accessibilityId };
  if (selector.iosPredicate !== undefined)
    return { using: '-ios predicate string', value: selector.iosPredicate };
  if (selector.iosClassChain !== undefined)
    return { using: '-ios class chain', value: selector.iosClassChain };
  if (selector.xpath !== undefined)
    return { using: 'xpath', value: selector.xpath };
  if (selector.className !== undefined)
    return { using: 'class name', value: selector.className };
  throw new Error(`IosSelector must set exactly one of: accessibilityId, iosPredicate, iosClassChain, xpath, className.`);
}
