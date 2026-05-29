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

import type { AppiumClient, ElementHandle, LocatorStrategy } from './appiumClient.js';

export type LocatorChainPart = { using: LocatorStrategy; value: string };

export type LocatorFilter = {
  hasText?: string | RegExp;
  has?: AppLocator;
  hasNot?: AppLocator;
};

// ── Action option types ─────────────────────────────────────────────────────
// Shape mirrors Playwright web (`page.locator(...).click({ timeout, trial })`).
// Each action that polls the device honors a per-call `timeout` override; the
// default falls back to the device's `defaultActionTimeoutMs`. Options that
// don't apply to mobile (e.g. `force`, `noWaitAfter`) are intentionally
// omitted rather than no-op'd, so the surface is honest.

export type TimeoutOptions = { timeout?: number };

export type LocatorState = 'visible' | 'hidden' | 'attached' | 'detached';

export type LocatorClickOptions = TimeoutOptions & {
  // When true, runs the actionability wait without performing the click.
  // Useful for "would-be-clickable" preflight checks. Mirrors Playwright web.
  trial?: boolean;
};

export type LocatorFillOptions = TimeoutOptions;

export type LocatorTypeOptions = TimeoutOptions & {
  // Per-character delay, in ms. Passed through to the Appium driver if
  // supported; otherwise applied client-side between sendKeys batches.
  delay?: number;
};

export type LocatorReadOptions = TimeoutOptions;

export type LocatorWaitForOptions = TimeoutOptions & {
  // 'visible' (default) waits for `isDisplayed === true`;
  // 'hidden' waits for `isDisplayed === false` (or detached);
  // 'attached' waits for the element to resolve at all;
  // 'detached' waits for it to stop resolving.
  state?: LocatorState;
};

export type LocatorBoundingBox = { x: number; y: number; width: number; height: number };

export type LocatorScreenshotOptions = TimeoutOptions & {
  // When set, writes the captured PNG to disk in addition to returning it.
  path?: string;
};

export type LocatorTimeoutSource = number | (() => number);
type LocatorOptions = {
  actionTimeoutMs: LocatorTimeoutSource;
  pollMs: number;
};

const DEFAULT_POLL_MS = 100;
const DEFAULT_ACTION_TIMEOUT_MS = 20_000;

export class AppLocator {
  private readonly _client: AppiumClient;
  private readonly _chain: LocatorChainPart[];
  private readonly _options: LocatorOptions;
  // Selection narrowing applied after the chain resolves to many matches.
  private readonly _position: number | 'last' | undefined;
  private readonly _filter: LocatorFilter | undefined;

  constructor(
    client: AppiumClient,
    chain: LocatorChainPart[],
    options: Partial<LocatorOptions> = {},
    position?: number | 'last',
    filter?: LocatorFilter,
  ) {
    this._client = client;
    this._chain = chain;
    this._options = {
      actionTimeoutMs: options.actionTimeoutMs ?? DEFAULT_ACTION_TIMEOUT_MS,
      pollMs: options.pollMs ?? DEFAULT_POLL_MS,
    };
    this._position = position;
    this._filter = filter;
  }

  byAccessibilityId(id: string): AppLocator {
    return this._chained({ using: 'accessibility id', value: id });
  }

  byXpath(xpath: string): AppLocator {
    return this._chained({ using: 'xpath', value: xpath });
  }

  byClassName(name: string): AppLocator {
    return this._chained({ using: 'class name', value: name });
  }

  byIosPredicate(predicate: string): AppLocator {
    return this._chained({ using: '-ios predicate string', value: predicate });
  }

  byIosClassChain(chain: string): AppLocator {
    return this._chained({ using: '-ios class chain', value: chain });
  }

  byAndroidUiSelector(uiautomator: string): AppLocator {
    return this._chained({ using: '-android uiautomator', value: uiautomator });
  }

  byId(id: string): AppLocator {
    return this._chained({ using: 'id', value: id });
  }

  // Platform-aware semantic getters — pick the appropriate iOS/Android
  // strategy so a single test reads the same on both platforms. Mirrors
  // Playwright's web getByText / getByLabel / getByTestId.

  // Matches visible text; substring by default, RegExp via MATCHES. iOS uses
  // an NSPredicate; Android uses UiAutomator's textContains/textMatches.
  getByText(text: string | RegExp): AppLocator {
    if (this._platform() === 'iOS')
      return this._chained({ using: '-ios predicate string', value: iosTextPredicate('label', text) });
    return this._chained({ using: '-android uiautomator', value: androidUiSelector('text', text) });
  }

  // Matches the accessibility label / content-description. On iOS that's
  // the accessibility id (which native apps populate from the label by
  // convention); on Android it's content-desc.
  getByLabel(text: string | RegExp): AppLocator {
    if (this._platform() === 'iOS') {
      if (text instanceof RegExp)
        return this._chained({ using: '-ios predicate string', value: iosTextPredicate('label', text) });
      return this._chained({ using: 'accessibility id', value: text });
    }
    return this._chained({ using: '-android uiautomator', value: androidUiSelector('description', text) });
  }

  // Both platforms expose `accessibility id` and downstream apps typically
  // wire React Native's `testID` (or equivalent) to it. Uniform on purpose
  // — `getByTestId('save')` works the same on iOS and Android.
  getByTestId(id: string): AppLocator {
    return this._chained({ using: 'accessibility id', value: id });
  }

  // Element type — iOS XCUIElementType*** or Android android.widget.***.
  // Pass either the short name (`'Button'`) — we'll prefix correctly per
  // platform — or the full class name (`'XCUIElementTypeButton'`), passed
  // through unchanged.
  getByType(type: string): AppLocator {
    const fullClass = type.includes('.') || type.startsWith('XCUIElementType')
      ? type
      : (this._platform() === 'iOS' ? `XCUIElementType${type}` : `android.widget.${type}`);
    return this._chained({ using: 'class name', value: fullClass });
  }

  // Position selectors — mirror Playwright's Locator.first()/.nth()/.last().
  first(): AppLocator {
    return this._derived({ position: 0 });
  }

  nth(index: number): AppLocator {
    return this._derived({ position: index });
  }

  last(): AppLocator {
    return this._derived({ position: 'last' });
  }

  // Narrow by predicate. `hasText` matches a substring or RegExp against the
  // resolved element's text; `has` / `hasNot` check for the presence of a
  // child locator. Mirrors Playwright's Locator.filter().
  filter(options: LocatorFilter): AppLocator {
    return this._derived({ filter: { ...this._filter, ...options } });
  }

  async resolve(): Promise<ElementHandle> {
    const matches = await this._resolveCandidates();
    if (matches.length === 0)
      throw new Error(`No elements matched ${this._describe()}`);
    const idx = this._position === 'last'
      ? matches.length - 1
      : this._position ?? 0;
    const handle = matches.at(idx);
    if (!handle)
      throw new Error(`Index ${idx} out of bounds for ${matches.length} matches (${this._describe()})`);
    return handle;
  }

  async resolveAll(): Promise<ElementHandle[]> {
    return this._resolveCandidates();
  }

  async click(options: LocatorClickOptions = {}): Promise<void> {
    const handle = await this._waitForActionable({ requireEnabled: true, timeoutMs: options.timeout });
    if (options.trial)
      return;
    await this._client.click(handle);
  }

  async fill(text: string, options: LocatorFillOptions = {}): Promise<void> {
    await this._actAction(async handle => {
      await this._client.clear(handle);
      await this._client.sendKeys(handle, text);
    }, options.timeout);
  }

  async type(text: string, options: LocatorTypeOptions = {}): Promise<void> {
    await this._actAction(async handle => {
      if (options.delay && options.delay > 0) {
        for (const ch of text) {
          await this._client.sendKeys(handle, ch);
          await sleep(options.delay);
        }
      } else {
        await this._client.sendKeys(handle, text);
      }
    }, options.timeout);
  }

  async text(options: LocatorReadOptions = {}): Promise<string> {
    const handle = await this._waitForActionable({ requireEnabled: false, timeoutMs: options.timeout });
    return this._client.getText(handle);
  }

  async getAttribute(name: string, options: LocatorReadOptions = {}): Promise<string | null> {
    const handle = await this._waitForActionable({ requireEnabled: false, timeoutMs: options.timeout });
    return this._client.getAttribute(handle, name);
  }

  async isVisible(): Promise<boolean> {
    return this.isDisplayed();
  }

  async isDisplayed(): Promise<boolean> {
    try {
      const matches = await this._resolveCandidates();
      const handle = matches.at(this._position === 'last' ? matches.length - 1 : this._position ?? 0);
      if (!handle)
        return false;
      return await this._client.isDisplayed(handle);
    } catch {
      return false;
    }
  }

  async isEnabled(): Promise<boolean> {
    try {
      return await this._client.isEnabled(await this.resolve());
    } catch {
      return false;
    }
  }

  async count(): Promise<number> {
    return (await this._resolveCandidates()).length;
  }

  chain(): LocatorChainPart[] { return [...this._chain]; }

  get client(): AppiumClient { return this._client; }
  get actionTimeoutMs(): number {
    const v = this._options.actionTimeoutMs;
    return typeof v === 'function' ? v() : v;
  }
  get pollMs(): number { return this._options.pollMs; }
  describe(): string { return this._describe(); }

  // Public polling primitive — used by `expect` matchers to share the same
  // timeout/poll cadence as actions. Returns `value` from the first
  // `{ matched: true }` result; throws on timeout with the locator's
  // description embedded.
  async pollUntil<T>(
    check: () => Promise<{ matched: boolean; value?: T }>,
    opts: { timeoutMs?: number; pollMs?: number; what: string } = { what: 'condition' },
  ): Promise<T> {
    return this._pollUntil(check, opts);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private _chained(part: LocatorChainPart): AppLocator {
    return new AppLocator(this._client, [...this._chain, part], this._options, this._position, this._filter);
  }

  private _derived(patch: { position?: number | 'last'; filter?: LocatorFilter }): AppLocator {
    return new AppLocator(
      this._client,
      this._chain,
      this._options,
      patch.position !== undefined ? patch.position : this._position,
      patch.filter !== undefined ? patch.filter : this._filter,
    );
  }

  private async _resolveCandidates(): Promise<ElementHandle[]> {
    if (this._chain.length === 0)
      throw new Error('AppLocator has no selectors. Chain at least one byX() call.');
    // Walk the chain to a parent (all parts except the last), then findElements
    // for the leaf so we can apply position/filter narrowing afterwards.
    const leaf = this._chain[this._chain.length - 1];
    const parents = this._chain.slice(0, -1);
    let parent: ElementHandle | undefined;
    for (const part of parents) {
      parent = parent
        ? await this._client.findChildElement(parent, part.using, part.value)
        : await this._client.findElement(part.using, part.value);
    }
    const matches = parent
      ? await this._client.findChildElements(parent, leaf.using, leaf.value)
      : await this._client.findElements(leaf.using, leaf.value);
    if (!this._filter)
      return matches;
    return this._applyFilter(matches);
  }

  private async _applyFilter(matches: ElementHandle[]): Promise<ElementHandle[]> {
    const filter = this._filter!;
    const out: ElementHandle[] = [];
    for (const handle of matches) {
      if (filter.hasText !== undefined) {
        const text = await this._client.getText(handle).catch(() => '');
        if (filter.hasText instanceof RegExp) {
          if (!filter.hasText.test(text)) continue;
        } else if (!text.includes(filter.hasText)) {
          continue;
        }
      }
      if (filter.has) {
        const found = await this._childMatches(handle, filter.has);
        if (!found) continue;
      }
      if (filter.hasNot) {
        const found = await this._childMatches(handle, filter.hasNot);
        if (found) continue;
      }
      out.push(handle);
    }
    return out;
  }

  private async _childMatches(parent: ElementHandle, locator: AppLocator): Promise<boolean> {
    try {
      const chain = locator.chain();
      let handle: ElementHandle | undefined = parent;
      for (const part of chain)
        handle = await this._client.findChildElement(handle!, part.using, part.value);
      return !!handle;
    } catch {
      return false;
    }
  }

  // Polls until the resolved element is actionable, then runs `action`.
  // `actionable` = displayed (always) + enabled (for write actions).
  // Optional `timeoutMs` overrides the locator's default action timeout.
  private async _waitForActionable(opts: { requireEnabled: boolean; timeoutMs?: number }): Promise<ElementHandle> {
    return this._pollUntil<ElementHandle>(async () => {
      const handle = await this.resolve();
      if (!(await this._client.isDisplayed(handle)))
        return { matched: false, value: undefined };
      if (opts.requireEnabled && !(await this._client.isEnabled(handle)))
        return { matched: false, value: undefined };
      return { matched: true, value: handle };
    }, { what: `${this._describe()} to be actionable`, timeoutMs: opts.timeoutMs });
  }

  // Shared timeout/poll loop. Every poll calls `check()`. Returns the first
  // `{ matched: true }` value; on deadline, throws with the last underlying
  // error (if any) or a generic message.
  private async _pollUntil<T>(
    check: () => Promise<{ matched: boolean; value?: T }>,
    opts: { timeoutMs?: number; pollMs?: number; what: string },
  ): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? this.actionTimeoutMs;
    const pollMs = opts.pollMs ?? this._options.pollMs;
    const deadline = Date.now() + timeoutMs;
    let lastErr: unknown;
    // Always try at least once even with timeoutMs=0.
    let firstAttempt = true;
    while (firstAttempt || Date.now() <= deadline) {
      firstAttempt = false;
      try {
        const result = await check();
        if (result.matched)
          return result.value as T;
        lastErr = undefined;
      } catch (err) {
        lastErr = err;
      }
      if (Date.now() > deadline)
        break;
      await sleep(pollMs);
    }
    const tail = lastErr !== undefined ? ` (${describeError(lastErr)})` : '';
    throw new Error(`Timed out ${timeoutMs}ms waiting for ${opts.what}${tail}`);
  }

  private _platform(): 'iOS' | 'Android' | undefined {
    return this._client.platform;
  }

  private async _actAction(action: (handle: ElementHandle) => Promise<void>, timeoutMs?: number): Promise<void> {
    const handle = await this._waitForActionable({ requireEnabled: true, timeoutMs });
    await action(handle);
  }

  private _describe(): string {
    const parts = this._chain.map(p => `${p.using}=${p.value}`).join(' >> ');
    const pos = this._position === 'last' ? '.last()' : (this._position !== undefined ? `.nth(${this._position})` : '');
    const filt = this._filter ? `.filter(${JSON.stringify(this._filter)})` : '';
    return `${parts}${pos}${filt}`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function escapeQuotes(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Builds an iOS NSPredicate. RegExp → `MATCHES` with the source as the
// pattern; string → case-insensitive CONTAINS. `attribute` is typically
// `label`, `name`, or `value`.
function iosTextPredicate(attribute: 'label' | 'name' | 'value', text: string | RegExp): string {
  if (text instanceof RegExp)
    return `${attribute} MATCHES "${escapeQuotes(text.source)}"`;
  return `${attribute} CONTAINS[c] "${escapeQuotes(text)}"`;
}

// Builds an Android UiAutomator selector for text or content-description.
// String → ${attr}Contains; RegExp → ${attr}Matches with the source.
function androidUiSelector(attribute: 'text' | 'description', text: string | RegExp): string {
  if (text instanceof RegExp)
    return `new UiSelector().${attribute}Matches("${escapeQuotes(text.source)}")`;
  return `new UiSelector().${attribute}Contains("${escapeQuotes(text)}")`;
}
