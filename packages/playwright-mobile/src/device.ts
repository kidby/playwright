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
import { convertPageSourceToSnapshot } from './snapshot';
import { NATIVE_APP_CONTEXT, listWebViewContexts, switchToWebViewContext, waitForWebViewContext } from './webview';

import type { AppiumCapabilities, LocatorStrategy } from './appiumClient';
import type { GestureApi, SwipeDirection } from './gestures';
import type { WebViewContextDescriptor, WebViewSelector } from './webview';

export type AndroidKey = 'BACK' | 'HOME' | 'ENTER' | 'TAB' | 'DELETE' | 'SEARCH';

export type AlertAction = 'accept' | 'dismiss';

export type HandleAlertOptions = {
  action: AlertAction;
  buttonName?: string;
  retries?: number;
  pollMs?: number;
};

const ANDROID_KEYCODES: Record<AndroidKey, number> = {
  BACK: 4,
  HOME: 3,
  ENTER: 66,
  TAB: 61,
  DELETE: 112,
  SEARCH: 84,
};

const DEFAULT_ALERT_RETRIES = 10;
const DEFAULT_ALERT_POLL_MS = 500;
const DEFAULT_WAIT_TIMEOUT_MS = 20_000;
const DEFAULT_WAIT_POLL_MS = 250;
const DEFAULT_TAP_UNTIL_VISIBLE_MAX = 10;

export type WaitOptions = {
  timeoutMs?: number;
  pollMs?: number;
};

export type TapUntilVisibleOptions = {
  scrollTarget?: AppLocator;
  maxTaps?: number;
  direction?: SwipeDirection;
  timeoutMs?: number;
  pollMs?: number;
};

export class Device {
  readonly client: AppiumClient;
  readonly gestures: GestureApi;
  readonly app: AppLocator;
  defaultActionTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS;

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
    return this.client.capabilities?.platformName;
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
    await this.client.setContext(name ?? NATIVE_APP_CONTEXT);
  }

  async contexts(): Promise<string[]> {
    return await this.client.getContexts();
  }

  async currentContext(): Promise<string> {
    return await this.client.getCurrentContext();
  }

  async webViewContexts(): Promise<WebViewContextDescriptor[]> {
    return await listWebViewContexts(this.client);
  }

  async waitForWebViewContext(sel: WebViewSelector): Promise<WebViewContextDescriptor> {
    return await waitForWebViewContext(this.client, sel);
  }

  async switchToWebViewContext(sel: WebViewSelector): Promise<WebViewContextDescriptor> {
    return await switchToWebViewContext(this.client, sel);
  }

  async pressAndroidKey(key: AndroidKey) {
    if (!this.isAndroid)
      throw new Error(`pressAndroidKey is Android-only (current platform: ${this.platform ?? 'unknown'})`);
    await this.client.executeScript('mobile: pressKey', [{ keycode: ANDROID_KEYCODES[key] }]);
  }

  async pressBack() { await this.pressAndroidKey('BACK'); }
  async pressEnter() { await this.pressAndroidKey('ENTER'); }
  async pressDelete() { await this.pressAndroidKey('DELETE'); }
  async pressTab() { await this.pressAndroidKey('TAB'); }

  async hideKeyboard() {
    try {
      await this.client.executeScript('mobile: hideKeyboard', []);
    } catch {
      // Keyboard may not be visible — swallow.
    }
  }

  async handleAlert(opts: HandleAlertOptions): Promise<void> {
    const retries = opts.retries ?? DEFAULT_ALERT_RETRIES;
    const pollMs = opts.pollMs ?? DEFAULT_ALERT_POLL_MS;
    const args = [{ action: opts.action, buttonLabel: opts.buttonName }];
    for (let i = 0; i <= retries; i++) {
      try {
        await this.client.executeScript('mobile: alert', args);
        return;
      } catch {
        if (i === retries)
          return;
        await sleep(pollMs);
      }
    }
  }

  async shell(command: string, args: string[] = []): Promise<string> {
    if (!this.isAndroid)
      throw new Error(`shell is Android-only (current platform: ${this.platform ?? 'unknown'})`);
    const out = await this.client.executeScript<unknown>('mobile: shell', [{ command, args }]);
    return typeof out === 'string' ? out : '';
  }

  async activateApp(packageOrBundleId: string) {
    await this.client.executeScript('mobile: activateApp', [{ bundleId: packageOrBundleId, appId: packageOrBundleId }]);
  }

  async terminateApp(packageOrBundleId: string) {
    await this.client.executeScript('mobile: terminateApp', [{ bundleId: packageOrBundleId, appId: packageOrBundleId }]);
  }

  async pushFile(remotePath: string, content: Buffer | string) {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf-8').toString('base64') : content.toString('base64');
    await this.client.executeScript('mobile: pushFile', [{ remotePath, payload: data }]);
  }

  async pullFile(remotePath: string): Promise<Buffer> {
    const out = await this.client.executeScript<unknown>('mobile: pullFile', [{ remotePath }]);
    if (typeof out !== 'string')
      throw new Error(`pullFile: expected base64 string, got ${typeof out}`);
    return Buffer.from(out, 'base64');
  }

  async filesCount(directory: string, grepPattern?: string): Promise<number> {
    const listing = await this.shell('ls', [directory]);
    const lines = listing.split('\n').map(l => l.trim()).filter(Boolean);
    if (!grepPattern)
      return lines.length;
    return lines.filter(l => l.includes(grepPattern)).length;
  }

  async pageSource(): Promise<string> {
    return await this.client.getPageSource();
  }

  async snapshot(): Promise<string> {
    const source = await this.pageSource();
    const platform = this.platform ?? 'Android';
    return convertPageSourceToSnapshot(source, platform);
  }

  async setValue(locator: AppLocator, value: string, opts: { clearBefore?: boolean } = {}): Promise<void> {
    const handle = await locator.resolve();
    await this.client.click(handle);
    if (opts.clearBefore !== false) {
      try {
        await this.client.clear(handle);
      } catch {
        if (this.isAndroid)
          await this.client.executeScript('mobile: longClickGesture', [{ elementId: handle.ELEMENT }]).catch(() => undefined);
      }
    }
    await this.client.sendKeys(handle, value);
  }

  async waitForVisible(target: AppLocator, opts: WaitOptions = {}): Promise<void> {
    const timeout = opts.timeoutMs ?? this.defaultActionTimeoutMs;
    const poll = opts.pollMs ?? DEFAULT_WAIT_POLL_MS;
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await target.isDisplayed())
        return;
      await sleep(poll);
    }
    throw new Error(`waitForVisible: target not visible within ${timeout}ms (chain: ${describeChain(target)})`);
  }

  async tapUntilVisible(target: AppLocator, opts: TapUntilVisibleOptions = {}): Promise<void> {
    const maxTaps = opts.maxTaps ?? DEFAULT_TAP_UNTIL_VISIBLE_MAX;
    const poll = opts.pollMs ?? DEFAULT_WAIT_POLL_MS;
    const direction: SwipeDirection = opts.direction ?? 'up';
    const deadline = opts.timeoutMs !== undefined ? Date.now() + opts.timeoutMs : undefined;
    for (let i = 0; i < maxTaps; i++) {
      if (await target.isDisplayed())
        return;
      if (deadline !== undefined && Date.now() >= deadline)
        break;
      if (opts.scrollTarget)
        await this.gestures.swipe({ target: opts.scrollTarget, direction });
      else
        await this.gestures.swipe({ direction });
      await sleep(poll);
    }
    if (await target.isDisplayed())
      return;
    const reason = deadline !== undefined && Date.now() >= deadline
      ? `timeoutMs=${opts.timeoutMs}`
      : `maxTaps=${maxTaps}`;
    throw new Error(`tapUntilVisible: target not visible (${reason}, chain: ${describeChain(target)})`);
  }

  async findElementRaw(using: LocatorStrategy, value: string) {
    return await this.client.findElement(using, value);
  }
}

function describeChain(loc: AppLocator): string {
  return loc.chain().map(p => `${p.using}=${p.value}`).join(' >> ');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
