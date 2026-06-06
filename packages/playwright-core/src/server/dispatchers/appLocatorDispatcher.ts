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

import { Dispatcher } from './dispatcher';
import type { AppLocator } from '../appLocator';
import type * as channels from '@protocol/channels';
import type { Progress } from '@protocol/progress';

export class AppLocatorDispatcher extends Dispatcher<AppLocator, channels.AppLocatorChannel, Dispatcher<any, any, any>> implements channels.AppLocatorChannel {
  _type_AppLocator = true;

  constructor(scope: Dispatcher<any, any, any>, locator: AppLocator) {
    super(scope, locator, 'AppLocator', {});
  }

  async wait(params: channels.AppLocatorWaitParams, progress: Progress): Promise<channels.AppLocatorWaitResult> {
    return { element: undefined };
  }

  async click(params: channels.AppLocatorClickParams, progress: Progress): Promise<void> {
    await this._object.click(progress, params);
  }

  async fill(params: channels.AppLocatorFillParams, progress: Progress): Promise<void> {
    await this._object.fill(progress, params);
  }

  async clear(params: channels.AppLocatorClearParams, progress: Progress): Promise<void> {
    await this._object.clear(progress, params);
  }

  async screenshot(params: channels.AppLocatorScreenshotParams, progress: Progress): Promise<channels.AppLocatorScreenshotResult> {
    const binary = await this._object.screenshot(progress, params);
    return { binary };
  }
}
