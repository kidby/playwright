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

type LocatorOptions = {
  actionTimeoutMs: number;
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

  async click(): Promise<void> {
    await this._actAction(async handle => this._client.click(handle));
  }

  async fill(text: string): Promise<void> {
    await this._actAction(async handle => {
      await this._client.clear(handle);
      await this._client.sendKeys(handle, text);
    });
  }

  async type(text: string): Promise<void> {
    await this._actAction(async handle => this._client.sendKeys(handle, text));
  }

  async text(): Promise<string> {
    const handle = await this._waitForActionable({ requireEnabled: false });
    return this._client.getText(handle);
  }

  async getAttribute(name: string): Promise<string | null> {
    const handle = await this._waitForActionable({ requireEnabled: false });
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
  private async _waitForActionable(opts: { requireEnabled: boolean }): Promise<ElementHandle> {
    const deadline = Date.now() + this._options.actionTimeoutMs;
    let lastErr: unknown;
    while (Date.now() <= deadline) {
      try {
        const handle = await this.resolve();
        if (!(await this._client.isDisplayed(handle)))
          lastErr = new Error('not displayed');
        else if (opts.requireEnabled && !(await this._client.isEnabled(handle)))
          lastErr = new Error('not enabled');
        else
          return handle;
      } catch (err) {
        lastErr = err;
      }
      await sleep(this._options.pollMs);
    }
    throw new Error(
      `Timed out ${this._options.actionTimeoutMs}ms waiting for ${this._describe()} to be actionable (${describeError(lastErr)})`,
    );
  }

  private async _actAction(action: (handle: ElementHandle) => Promise<void>): Promise<void> {
    const handle = await this._waitForActionable({ requireEnabled: true });
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
