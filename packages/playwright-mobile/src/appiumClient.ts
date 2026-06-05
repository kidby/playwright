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

import { URL } from 'url';

const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

export type AppiumCapabilities = Record<string, unknown> & {
  platformName: 'iOS' | 'Android';
  'appium:automationName': 'UiAutomator2' | 'XCUITest' | string;
  'appium:platformVersion'?: string;
  'appium:deviceName'?: string;
  'appium:udid'?: string;
  'appium:app'?: string;
  'appium:bundleId'?: string;
  'appium:appPackage'?: string;
  'appium:appActivity'?: string;
  'appium:noReset'?: boolean;
  'appium:newCommandTimeout'?: number;
};

export type ElementHandle = { ELEMENT: string };

export type LocatorStrategy =
  | 'accessibility id'
  | 'xpath'
  | 'class name'
  | '-ios predicate string'
  | '-ios class chain'
  | '-android uiautomator'
  | 'id';

type Rect = { x: number; y: number; width: number; height: number };
type WindowRect = { width: number; height: number; x: number; y: number };
type W3CResponseEnvelope = { value?: unknown; sessionId?: string; message?: string };

export type SessionLogEntry = {
  ts: number;            // ms since session start
  method: 'GET' | 'POST' | 'DELETE';
  path: string;          // request path
  status: 'ok' | 'err';  // outcome
  err?: string;          // error message on failure
};

// Distinguishes calls that mutate visible state from passive reads. The
// mobile trace recorder uses this to decide when to grab a post-call
// screenshot (only after user-visible actions).
export type AppiumCallKind = 'action' | 'read' | 'session';
const ACTION_PATH = /\/(click|value|clear|back|forward|active)\b|\/execute(\/sync)?$/;

function classifyCall(method: string, path: string): AppiumCallKind {
  if (path === '/session' || path.startsWith('/session/') && method === 'DELETE' && !/\/element|\/timeouts/.test(path))
    return 'session';
  if (method === 'GET')
    return 'read';
  if (ACTION_PATH.test(path))
    return 'action';
  return 'read';
}

export class AppiumClient {
  private readonly _serverUrl: string;
  private _sessionId: string | undefined;
  private _capabilities: AppiumCapabilities | undefined;
  // Session log of every WebDriver request. Capped to keep memory bounded on
  // long sessions; full log is attached to the HTML report as `appium-log`
  // by the mobile fixture teardown.
  private _log: SessionLogEntry[] = [];
  private readonly _logLimit = 4096;
  private _logStartMs = 0;
  // Subscribers receive every WebDriver call entry. Mobile trace recorders
  // subscribe to align screenshots / events with the action timeline.
  private readonly _callListeners: Array<(entry: SessionLogEntry, kind: AppiumCallKind) => void> = [];

  /** Compat shim — older callers set `onCall` as a single handler. */
  set onCall(handler: ((entry: SessionLogEntry, kind: AppiumCallKind) => void) | undefined) {
    this._callListeners.length = 0;
    if (handler)
      this._callListeners.push(handler);
  }
  /** Subscribe an additional listener; returns an unsubscribe function. */
  subscribeCalls(handler: (entry: SessionLogEntry, kind: AppiumCallKind) => void): () => void {
    this._callListeners.push(handler);
    return () => {
      const i = this._callListeners.indexOf(handler);
      if (i !== -1)
        this._callListeners.splice(i, 1);
    };
  }

  constructor(serverUrl: string) {
    this._serverUrl = serverUrl.replace(/\/+$/, '');
  }

  get sessionId() { return this._sessionId; }
  get capabilities() { return this._capabilities; }
  get platform(): 'iOS' | 'Android' | undefined { return this._capabilities?.platformName; }

  /** Return the captured WebDriver request log as a human-readable string. */
  formatLog(): string {
    const lines = [
      `# Appium session log (${this._log.length} entries)`,
      `# session=${this._sessionId ?? '(none)'} server=${this._serverUrl}`,
      '',
    ];
    for (const e of this._log)
      lines.push(`${e.ts.toString().padStart(7)}ms  ${e.method.padEnd(6)} ${e.status === 'ok' ? '   ' : 'ERR'} ${e.path}${e.err ? ` -- ${e.err}` : ''}`);
    return lines.join('\n');
  }

  attachSession(sessionId: string) {
    this._sessionId = sessionId;
  }

  async createSession(capabilities: AppiumCapabilities): Promise<string> {
    const body = { capabilities: { alwaysMatch: capabilities, firstMatch: [{}] } };
    const res = await this._send('POST', '/session', body);
    const id = (res?.value as { sessionId?: string })?.sessionId ?? res?.sessionId;
    if (!id)
      throw new Error(`createSession: server did not return a sessionId. Body: ${JSON.stringify(res)}`);
    this._sessionId = id;
    this._capabilities = capabilities;
    return id;
  }

  async deleteSession() {
    if (!this._sessionId)
      return;
    await this._send('DELETE', `/session/${this._sessionId}`);
    this._sessionId = undefined;
    this._capabilities = undefined;
  }

  async findElement(using: LocatorStrategy, value: string): Promise<ElementHandle> {
    const res = await this._send('POST', `/session/${this._requireSession()}/element`, { using, value });
    return toHandle(res.value);
  }

  async findElements(using: LocatorStrategy, value: string): Promise<ElementHandle[]> {
    const res = await this._send('POST', `/session/${this._requireSession()}/elements`, { using, value });
    return (res.value as unknown[]).map(toHandle);
  }

  async findChildElement(parent: ElementHandle, using: LocatorStrategy, value: string): Promise<ElementHandle> {
    const res = await this._send('POST', `/session/${this._requireSession()}/element/${parent.ELEMENT}/element`, { using, value });
    return toHandle(res.value);
  }

  async findChildElements(parent: ElementHandle, using: LocatorStrategy, value: string): Promise<ElementHandle[]> {
    const res = await this._send('POST', `/session/${this._requireSession()}/element/${parent.ELEMENT}/elements`, { using, value });
    return (res.value as unknown[]).map(toHandle);
  }

  async click(element: ElementHandle) {
    await this._send('POST', `/session/${this._requireSession()}/element/${element.ELEMENT}/click`, {});
  }

  async sendKeys(element: ElementHandle, text: string) {
    await this._send('POST', `/session/${this._requireSession()}/element/${element.ELEMENT}/value`, {
      text,
      value: [...text],
    });
  }

  async clear(element: ElementHandle) {
    await this._send('POST', `/session/${this._requireSession()}/element/${element.ELEMENT}/clear`, {});
  }

  async getText(element: ElementHandle): Promise<string> {
    const res = await this._send('GET', `/session/${this._requireSession()}/element/${element.ELEMENT}/text`);
    return String(res.value ?? '');
  }

  async getAttribute(element: ElementHandle, name: string): Promise<string | null> {
    const res = await this._send('GET', `/session/${this._requireSession()}/element/${element.ELEMENT}/attribute/${encodeURIComponent(name)}`);
    return res.value === null ? null : String(res.value);
  }

  async isDisplayed(element: ElementHandle): Promise<boolean> {
    const res = await this._send('GET', `/session/${this._requireSession()}/element/${element.ELEMENT}/displayed`);
    return !!res.value;
  }

  async isEnabled(element: ElementHandle): Promise<boolean> {
    const res = await this._send('GET', `/session/${this._requireSession()}/element/${element.ELEMENT}/enabled`);
    return !!res.value;
  }

  async elementRect(element: ElementHandle): Promise<Rect> {
    const res = await this._send('GET', `/session/${this._requireSession()}/element/${element.ELEMENT}/rect`);
    return res.value as Rect;
  }

  async screenshot(): Promise<Buffer> {
    const res = await this._send('GET', `/session/${this._requireSession()}/screenshot`);
    return Buffer.from(String(res.value), 'base64');
  }

  async elementScreenshot(element: ElementHandle): Promise<Buffer> {
    const res = await this._send('GET', `/session/${this._requireSession()}/element/${element.ELEMENT}/screenshot`);
    return Buffer.from(String(res.value), 'base64');
  }

  async executeScript<T = unknown>(script: string, args: unknown[] = []): Promise<T> {
    const res = await this._send('POST', `/session/${this._requireSession()}/execute/sync`, { script, args });
    return res.value as T;
  }

  async getContexts(): Promise<string[]> {
    const res = await this._send('GET', `/session/${this._requireSession()}/contexts`);
    return (res.value as string[]) ?? [];
  }

  async getCurrentContext(): Promise<string> {
    const res = await this._send('GET', `/session/${this._requireSession()}/context`);
    return String(res.value ?? 'NATIVE_APP');
  }

  async setContext(name: string) {
    await this._send('POST', `/session/${this._requireSession()}/context`, { name });
  }

  async switchToWindow(handle: string) {
    await this._send('POST', `/session/${this._requireSession()}/window`, { handle });
  }

  async getWindowRect(): Promise<WindowRect> {
    const res = await this._send('GET', `/session/${this._requireSession()}/window/rect`);
    return res.value as WindowRect;
  }

  async getPageSource(): Promise<string> {
    const res = await this._send('GET', `/session/${this._requireSession()}/source`);
    return typeof res.value === 'string' ? res.value : '';
  }

  private _requireSession(): string {
    if (!this._sessionId)
      throw new Error('No active Appium session. Call createSession() first.');
    return this._sessionId;
  }

  private async _send(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<W3CResponseEnvelope> {
    if (this._logStartMs === 0)
      this._logStartMs = Date.now();
    const ts = Date.now() - this._logStartMs;
    const url = new URL(this._serverUrl + path);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', 'accept': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      const msg = (e as Error).message;
      this._appendLog({ ts, method, path, status: 'err', err: msg });
      throw new Error(`Appium ${method} ${path} failed: ${msg}`);
    }
    const text = await response.text();
    let payload: W3CResponseEnvelope;
    try {
      payload = text.length ? JSON.parse(text) : {};
    } catch {
      this._appendLog({ ts, method, path, status: 'err', err: `non-JSON ${response.status}` });
      throw new Error(`Appium ${method} ${path} returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
    }
    const errorValue = payload.value && typeof payload.value === 'object'
      ? (payload.value as { error?: string; message?: string })
      : undefined;
    if (!response.ok || errorValue?.error) {
      const errMsg = errorValue?.message || payload.message || text || `HTTP ${response.status}`;
      this._appendLog({ ts, method, path, status: 'err', err: errMsg });
      throw new Error(`Appium ${method} ${path} → ${response.status}: ${errMsg}`);
    }
    this._appendLog({ ts, method, path, status: 'ok' });
    return payload;
  }

  private _appendLog(entry: SessionLogEntry): void {
    if (this._log.length >= this._logLimit) {
      // Drop the oldest entries when we hit the cap; keeps tail (most recent)
      // since the failure context near test end is what users debug.
      this._log.splice(0, Math.floor(this._logLimit / 4));
    }
    this._log.push(entry);
    if (this._callListeners.length) {
      const kind = classifyCall(entry.method, entry.path);
      for (const fn of this._callListeners) {
        try {
          fn(entry, kind);
        } catch {
          // Listener failures must not break the call.
        }
      }
    }
  }
}

function toHandle(value: unknown): ElementHandle {
  if (!value || typeof value !== 'object')
    throw new Error(`Expected element handle, got ${JSON.stringify(value)}`);
  const record = value as Record<string, unknown>;
  const id = record[W3C_ELEMENT_KEY] ?? record.ELEMENT;
  if (typeof id !== 'string')
    throw new Error(`Element handle missing id: ${JSON.stringify(value)}`);
  return { ELEMENT: id };
}
