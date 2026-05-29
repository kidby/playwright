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

import { AppiumClient   } from './appiumClient.js';
import { AppLocator } from './appLocator.js';
import { gestures  } from './gestures.js';
import { convertPageSourceToSnapshot } from './snapshot.js';
import { NATIVE_APP_CONTEXT, listWebViewContexts, switchToWebViewContext, waitForWebViewContext } from './webview.js';

import type { AppiumCapabilities, LocatorStrategy } from './appiumClient.js';
import type { GestureApi, SwipeDirection } from './gestures.js';
import type { WebViewContextDescriptor, WebViewSelector } from './webview.js';

// Subset of Playwright's `devices['…']` shape that the mobile session can
// meaningfully expose. We don't redefine it — we structurally accept any
// value matching the shape, so users pass `devices['iPhone 15']` directly.
export type DeviceDescriptor = {
  viewport: { width: number; height: number };
  userAgent?: string;
  deviceScaleFactor?: number;
  isMobile?: boolean;
  hasTouch?: boolean;
  defaultBrowserType?: 'chromium' | 'firefox' | 'webkit';
};

export type Viewport = { width: number; height: number };

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

export class NativeDevice {
  readonly client: AppiumClient;
  readonly gestures: GestureApi;
  readonly app: AppLocator;
  readonly descriptor: DeviceDescriptor | undefined;
  defaultActionTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS;

  private constructor(client: AppiumClient, descriptor?: DeviceDescriptor) {
    this.client = client;
    this.descriptor = descriptor;
    // Pass a getter — mutations to `defaultActionTimeoutMs` propagate live
    // to the locator timing without recreating `app`.
    this.app = new AppLocator(client, [], { actionTimeoutMs: () => this.defaultActionTimeoutMs });
    this.gestures = gestures(client);
  }

  static async start(serverUrl: string, capabilities: AppiumCapabilities, options: { descriptor?: DeviceDescriptor } = {}): Promise<NativeDevice> {
    const client = new AppiumClient(serverUrl);
    await client.createSession(capabilities);
    return new NativeDevice(client, options.descriptor);
  }

  static attach(serverUrl: string, sessionId: string, options: { descriptor?: DeviceDescriptor } = {}): NativeDevice {
    const client = new AppiumClient(serverUrl);
    client.attachSession(sessionId);
    return new NativeDevice(client, options.descriptor);
  }

  get platform(): 'iOS' | 'Android' | undefined {
    return this.client.capabilities?.platformName;
  }

  get isAndroid() { return this.platform === 'Android'; }
  get isIos() { return this.platform === 'iOS'; }

  // Pixel-density ratio used for screenshot baseline naming. Resolution
  // chain: descriptor (Playwright `devices['…']`) → Appium capability
  // (`appium:pixelRatio`) → undefined. Callers that need a value should
  // default to 1 themselves; we don't fabricate one.
  get deviceScaleFactor(): number | undefined {
    if (this.descriptor?.deviceScaleFactor !== undefined)
      return this.descriptor.deviceScaleFactor;
    const cap = this.client.capabilities?.['appium:pixelRatio'];
    if (typeof cap === 'number')
      return cap;
    if (typeof cap === 'string') {
      const n = Number(cap);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  }

  // Viewport in CSS-style logical pixels. From the descriptor when present;
  // otherwise queried live from Appium via `client.getWindowRect()`. The
  // live path returns physical pixels — convert if a `deviceScaleFactor`
  // is known.
  async viewport(): Promise<Viewport> {
    if (this.descriptor?.viewport)
      return { width: this.descriptor.viewport.width, height: this.descriptor.viewport.height };
    const rect = await this.client.getWindowRect();
    const dpr = this.deviceScaleFactor;
    if (dpr && dpr > 0)
      return { width: Math.round(rect.width / dpr), height: Math.round(rect.height / dpr) };
    return { width: rect.width, height: rect.height };
  }

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

  // ── Convenience wrappers that one-automation reaches for ───────────────

  /** Sleep for `ms` milliseconds. Prefer `waitUntil` for condition polling. */
  async wait(ms: number): Promise<void> {
    await sleep(ms);
  }

  /**
   * Poll `predicate` until it returns truthy or the timeout elapses. Throws
   * with `message` (default: a generic timeout error) on timeout.
   */
  async waitUntil<T>(predicate: () => Promise<T> | T, opts: WaitOptions & { message?: string } = {}): Promise<T> {
    const timeout = opts.timeoutMs ?? this.defaultActionTimeoutMs;
    const poll = opts.pollMs ?? DEFAULT_WAIT_POLL_MS;
    const deadline = Date.now() + timeout;
    let lastErr: unknown;
    while (Date.now() <= deadline) {
      try {
        const result = await predicate();
        if (result)
          return result;
      } catch (err) {
        lastErr = err;
      }
      await sleep(poll);
    }
    const reason = lastErr instanceof Error ? `: ${lastErr.message}` : '';
    throw new Error(opts.message ?? `waitUntil: predicate not satisfied within ${timeout}ms${reason}`);
  }

  /** True iff the on-screen keyboard is currently shown. */
  async isKeyboardShown(): Promise<boolean> {
    try {
      const result = await this.client.executeScript<unknown>('mobile: isKeyboardShown', []);
      return !!result;
    } catch {
      return false;
    }
  }

  /** Android-only: the package name of the foreground activity. */
  async currentPackage(): Promise<string> {
    if (!this.isAndroid)
      throw new Error(`currentPackage is Android-only (current platform: ${this.platform ?? 'unknown'})`);
    const result = await this.client.executeScript<unknown>('mobile: getCurrentPackage', []);
    return typeof result === 'string' ? result : String(result ?? '');
  }

  /** Set the device locale (e.g. `en_US`). Appium driver handles the platform difference. */
  async setLocale(locale: string): Promise<void> {
    await this.client.executeScript('mobile: setLocale', [{ locale }]);
  }

  /** Begin recording the device screen. Returns immediately; call `stopScreenRecording` to retrieve the video. */
  async startScreenRecording(opts: ScreenRecordingOptions = {}): Promise<void> {
    const args: Record<string, unknown> = {};
    if (opts.timeLimitSec !== undefined) args.timeLimit = String(opts.timeLimitSec);
    if (opts.videoQuality) args.videoQuality = opts.videoQuality;
    if (opts.videoFps !== undefined) args.videoFps = opts.videoFps;
    if (opts.bitRate !== undefined) args.bitRate = opts.bitRate;
    await this.client.executeScript('mobile: startRecordingScreen', [args]);
  }

  /**
   * Stop screen recording and return the captured video. Format defaults to
   * MP4 per Appium driver defaults.
   */
  async stopScreenRecording(): Promise<Buffer> {
    const out = await this.client.executeScript<unknown>('mobile: stopRecordingScreen', []);
    if (typeof out !== 'string')
      throw new Error(`stopScreenRecording: expected base64 string, got ${typeof out}`);
    return Buffer.from(out, 'base64');
  }
}

export type ScreenRecordingOptions = {
  timeLimitSec?: number;
  videoQuality?: 'low' | 'medium' | 'high' | 'photo';  // iOS
  videoFps?: number;                                    // Android
  bitRate?: number;                                     // Android
};

function describeChain(loc: AppLocator): string {
  return loc.chain().map(p => `${p.using}=${p.value}`).join(' >> ');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
