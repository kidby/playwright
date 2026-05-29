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

// Augments Playwright's `Matchers<R, T>` so mobile-specific assertions
// typecheck when the receiver is an `AppLocator` or `NativeDevice`. The matchers
// themselves are registered at runtime via `expect.extend(mobileMatchers)`
// in `mobileTest.ts`. These signatures only inform TypeScript — they don't
// add any runtime behaviour.

import type { AppLocator } from './appLocator.js';
import type { NativeDevice } from "./nativeDevice.js";
import type { MobileScreenshotOptions } from './screenshotComparator.js';

type MobileTimeout = { timeout?: number };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace PlaywrightTest {
    // The generic shape mirrors @playwright/test: `R` is the matcher
    // return-type wrapper (used for `.resolves`/`.rejects`); `T` is the
    // received value. We gate on `T extends AppLocator` (or `NativeDevice` for
    // `toHaveScreenshot`) using conditional method types: when the
    // receiver isn't one of ours, the methods resolve to `never` and
    // callers see a normal "method does not exist" error.
    interface Matchers<R, T = unknown> {
      toBeVisible: T extends AppLocator ? (options?: MobileTimeout) => Promise<R> : never;
      toBeHidden: T extends AppLocator ? (options?: MobileTimeout) => Promise<R> : never;
      toBeEnabled: T extends AppLocator ? (options?: MobileTimeout) => Promise<R> : never;
      toBeDisabled: T extends AppLocator ? (options?: MobileTimeout) => Promise<R> : never;
      toHaveText: T extends AppLocator ? (expected: string | RegExp, options?: MobileTimeout) => Promise<R> : never;
      toContainText: T extends AppLocator ? (expected: string | RegExp, options?: MobileTimeout) => Promise<R> : never;
      toHaveAttribute: T extends AppLocator ? (name: string, expected: string | RegExp, options?: MobileTimeout) => Promise<R> : never;
      toHaveValue: T extends AppLocator ? (expected: string | RegExp, options?: MobileTimeout) => Promise<R> : never;
      toHaveCount: T extends AppLocator ? (expected: number, options?: MobileTimeout) => Promise<R> : never;
      toBeChecked: T extends AppLocator ? (options?: MobileTimeout) => Promise<R> : never;
      toBeFocused: T extends AppLocator ? (options?: MobileTimeout) => Promise<R> : never;
      toHaveScreenshot: T extends AppLocator | NativeDevice
        ? ((name?: string | string[], options?: MobileScreenshotOptions & MobileTimeout) => Promise<R>) &
            ((options?: MobileScreenshotOptions & MobileTimeout) => Promise<R>)
        : never;
    }
  }
}

export {};
