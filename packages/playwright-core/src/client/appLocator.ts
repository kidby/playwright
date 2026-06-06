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
import type * as channels from '@protocol/channels';

export class AppLocator extends ChannelOwner<channels.AppLocatorChannel> {
  static from(appLocator: channels.AppLocatorChannel): AppLocator {
    return (appLocator as any)._object;
  }

  async wait(options: { state?: 'attached' | 'detached' | 'visible' | 'hidden', timeout?: number } = {}): Promise<void> {
    await this._channel.wait(options);
  }

  async click(options: { timeout?: number, trial?: boolean } = {}): Promise<void> {
    await this._channel.click(options);
  }

  async fill(text: string, options: { timeout?: number } = {}): Promise<void> {
    await this._channel.fill({ text, ...options });
  }

  async clear(options: { timeout?: number } = {}): Promise<void> {
    await this._channel.clear(options);
  }

  async screenshot(options: { timeout?: number } = {}): Promise<Buffer> {
    const { binary } = await this._channel.screenshot(options);
    return binary;
  }
}
