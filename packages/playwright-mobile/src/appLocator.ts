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

import type { AppiumClient, ElementHandle, LocatorStrategy } from './appiumClient';

export type LocatorChainPart = { using: LocatorStrategy; value: string };

export class AppLocator {
  private readonly _client: AppiumClient;
  private readonly _chain: LocatorChainPart[];

  constructor(client: AppiumClient, chain: LocatorChainPart[]) {
    this._client = client;
    this._chain = chain;
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

  async resolve(): Promise<ElementHandle> {
    if (this._chain.length === 0)
      throw new Error('AppLocator has no selectors. Chain at least one byX() call.');
    let handle = await this._client.findElement(this._chain[0].using, this._chain[0].value);
    for (let i = 1; i < this._chain.length; i++)
      handle = await this._client.findChildElement(handle, this._chain[i].using, this._chain[i].value);
    return handle;
  }

  async resolveAll(): Promise<ElementHandle[]> {
    if (this._chain.length === 0)
      throw new Error('AppLocator has no selectors.');
    if (this._chain.length === 1)
      return await this._client.findElements(this._chain[0].using, this._chain[0].value);
    const parentChain = this._chain.slice(0, -1);
    let handle = await this._client.findElement(parentChain[0].using, parentChain[0].value);
    for (let i = 1; i < parentChain.length; i++)
      handle = await this._client.findChildElement(handle, parentChain[i].using, parentChain[i].value);
    const last = this._chain[this._chain.length - 1];
    return await this._client.findChildElements(handle, last.using, last.value);
  }

  async click(): Promise<void> {
    const handle = await this.resolve();
    await this._client.click(handle);
  }

  async fill(text: string): Promise<void> {
    const handle = await this.resolve();
    await this._client.clear(handle);
    await this._client.sendKeys(handle, text);
  }

  async type(text: string): Promise<void> {
    const handle = await this.resolve();
    await this._client.sendKeys(handle, text);
  }

  async text(): Promise<string> {
    return await this._client.getText(await this.resolve());
  }

  async getAttribute(name: string): Promise<string | null> {
    return await this._client.getAttribute(await this.resolve(), name);
  }

  async isDisplayed(): Promise<boolean> {
    try {
      return await this._client.isDisplayed(await this.resolve());
    } catch {
      return false;
    }
  }

  async count(): Promise<number> {
    return (await this.resolveAll()).length;
  }

  chain(): LocatorChainPart[] { return [...this._chain]; }

  private _chained(part: LocatorChainPart): AppLocator {
    return new AppLocator(this._client, [...this._chain, part]);
  }
}
