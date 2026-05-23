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

import { oop, client } from '../../packages/playwright-core/lib/coreBundle.js';

export type TestModeName = 'default' | 'driver';

const { start } = oop;

interface TestMode {
  setup(): Promise<client.Playwright>;
  teardown(): Promise<void>;
}

export class DriverTestMode implements TestMode {
  private _impl: { playwright: client.Playwright; stop: () => Promise<void>; };

  async setup() {
    this._impl = await start({
      NODE_OPTIONS: undefined,  // Hide driver process while debugging.
    });
    // No ESM-namespace unwrap needed here — `start()` returns a fresh client
    // object from `Connection.initializePlaywright()`, not the frozen
    // `require('playwright-core')` namespace.
    return this._impl.playwright;
  }

  async teardown() {
    await this._impl.stop();
  }
}

export class DefaultTestMode implements TestMode {
  async setup() {
    // `require('playwright-core')` returns the frozen ESM namespace. Reach for
    // the default export (the mutable Playwright instance) so fixture chains
    // can stamp test-only state like `_defaultLaunchOptions` on it.
    const lib = require('playwright-core');
    return (lib.default ?? lib) as client.Playwright;
  }

  async teardown() {
  }
}
