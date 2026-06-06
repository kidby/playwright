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

import { SdkObject } from './instrumentation';
import type { Progress } from './progress';
import type { AppiumDevice } from './appium';
import type { ElementHandle } from './ios/appiumClient';

export class AppLocator extends SdkObject {
  private readonly _device: AppiumDevice;

  constructor(parent: AppiumDevice, public readonly chain: any[], public readonly options: any = {}) {
    super(parent, 'appLocator');
    this._device = parent;
  }

  async wait(progress: Progress, params: any): Promise<void> {
    const state = params.state ?? 'visible';
    if (state === 'visible' || state === 'attached') {
      await this._waitForActionable({ requireEnabled: false, timeoutMs: params.timeout });
    } else {
      await this._pollUntil(async () => {
        try {
          const isDisp = await this.isDisplayed();
          return { matched: !isDisp };
        } catch {
          return { matched: true };
        }
      }, { what: 'element to be hidden', timeoutMs: params.timeout });
    }
  }

  async click(progress: Progress, params: any): Promise<void> {
    await this._actAction(async handle => {
      await this._device.client.click(handle);
    }, params.timeout);
  }

  async fill(progress: Progress, params: any): Promise<void> {
    await this._actAction(async handle => {
      if (this._device.client.platform === 'Android') {
        await this._device.client.clear(handle);
      } else {
        const textLength = (await this._device.client.getText(handle)).length;
        if (textLength > 0) {
          await this._device.client.executeScript('mobile: longClickGesture', [{ elementId: handle.ELEMENT }]).catch(() => undefined);
          await this._device.client.clear(handle);
        }
      }
      await this._device.client.sendKeys(handle, params.text);
    }, params.timeout);
  }

  async clear(progress: Progress, params: any): Promise<void> {
    await this._actAction(async handle => {
      await this._device.client.clear(handle);
    }, params.timeout);
  }

  async screenshot(progress: Progress, params: any): Promise<Buffer> {
    const handle = await this._waitForActionable({ requireEnabled: false, timeoutMs: params.timeout });
    const buffer = await this._device.client.elementScreenshot(handle);
    return buffer;
  }

  // Polling logic

  async isDisplayed(): Promise<boolean> {
    try {
      const matches = await this._resolveCandidates();
      const pos = this.options?.position;
      const handle = matches.at(pos === 'last' ? matches.length - 1 : pos ?? 0);
      if (!handle)
        return false;
      return await this._device.client.isDisplayed(handle);
    } catch {
      return false;
    }
  }

  async resolve(): Promise<ElementHandle> {
    const matches = await this._resolveCandidates();
    if (matches.length === 0)
      throw new Error(`No elements matched`);
    const pos = this.options?.position;
    const idx = pos === 'last'
      ? matches.length - 1
      : pos ?? 0;
    const handle = matches.at(idx);
    if (!handle)
      throw new Error(`Index ${idx} out of bounds for ${matches.length} matches`);
    return handle;
  }

  private async _resolveCandidates(): Promise<ElementHandle[]> {
    if (this.chain.length === 0)
      throw new Error('AppLocator has no selectors. Chain at least one byX() call.');
    const leaf = this.chain[this.chain.length - 1];
    const parents = this.chain.slice(0, -1);
    let parent: ElementHandle | undefined;
    for (const part of parents) {
      parent = parent
        ? await this._device.client.findChildElement(parent, part.using, part.value)
        : await this._device.client.findElement(part.using, part.value);
    }
    const matches = parent
      ? await this._device.client.findChildElements(parent, leaf.using, leaf.value)
      : await this._device.client.findElements(leaf.using, leaf.value);
    if (!this.options?.filter)
      return matches;
    return this._applyFilter(matches);
  }

  private async _applyFilter(matches: ElementHandle[]): Promise<ElementHandle[]> {
    const filter = this.options.filter;
    const out: ElementHandle[] = [];
    for (const handle of matches) {
      if (filter.hasText !== undefined) {
        const text = await this._device.client.getText(handle).catch(() => '');
        // Regex not supported over RPC easily, assume string for now
        if (!text.includes(filter.hasText)) 
          continue;
        
      }
      out.push(handle);
    }
    return out;
  }

  private async _waitForActionable(opts: { requireEnabled: boolean; timeoutMs?: number }): Promise<ElementHandle> {
    return this._pollUntil<ElementHandle>(async () => {
      const handle = await this.resolve();
      if (!(await this._device.client.isDisplayed(handle)))
        return { matched: false, value: undefined };
      if (opts.requireEnabled && !(await this._device.client.isEnabled(handle)))
        return { matched: false, value: undefined };
      return { matched: true, value: handle };
    }, { what: `element to be actionable`, timeoutMs: opts.timeoutMs });
  }

  private async _actAction(action: (handle: ElementHandle) => Promise<void>, timeoutMs?: number): Promise<void> {
    const handle = await this._waitForActionable({ requireEnabled: true, timeoutMs });
    await action(handle);
  }

  private async _pollUntil<T>(
    check: () => Promise<{ matched: boolean; value?: T }>,
    opts: { timeoutMs?: number; pollMs?: number; what: string },
  ): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? 20000;
    const pollMs = opts.pollMs ?? 250;
    const deadline = Date.now() + timeoutMs;
    let lastErr: unknown;
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
      await new Promise(r => setTimeout(r, pollMs));
    }
    throw new Error(`Timed out ${timeoutMs}ms waiting for ${opts.what}`);
  }
}
