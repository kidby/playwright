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

// Stable internal-types surface for @playwright/test's matcher implementations.
// NOT part of the public Playwright API — consumers should not depend on
// these shapes; they may change between releases. Exists because importing
// via `playwright-core/lib/client/*` source paths breaks `tsgo -p ./tests/`
// (those paths are not in the package's `exports` map and the lib output
// is a single coreBundle.js, not per-file).
//
// Canonical definitions live in:
//   ExpectReceived, ExpectResult     → packages/playwright-core/src/client/frame.ts
//   FrameExpectParams                → packages/playwright-core/src/client/types.ts
//   ExpectScreenshotOptions, PageEx  → packages/playwright-core/src/client/page.ts
//
// If you change those, mirror the change here. There's no compile-time link
// between the two; this is a deliberate duplication for the cross-package
// path-resolution constraint.

import type * as channels from '@protocol/channels';
import type { Locator, Page } from '../index';

export type ExpectReceived = {
  value?: any;
  ariaSnapshot?: string;
};

export type ExpectResult = {
  matches: boolean;
  received?: ExpectReceived;
  log?: string[];
  timedOut?: boolean;
  errorMessage?: string;
};

export type FrameExpectParams =
  Omit<channels.FrameExpectParams, 'selector' | 'expression' | 'expectedValue'>
  & { expectedValue?: any };

export type ExpectScreenshotOptions =
  Omit<channels.PageExpectScreenshotOptions, 'locator' | 'expected' | 'mask'>
  & {
    expected?: Buffer;
    locator?: Locator;
    timeout: number;
    isNot: boolean;
    mask?: Locator[];
  };

export type ExpectScreenshotResult = {
  actual?: Buffer;
  previous?: Buffer;
  diff?: Buffer;
  errorMessage?: string;
  log?: string[];
  timedOut?: boolean;
};

// Internal Page class shape — augments the public Page interface with the
// fork's `_expectScreenshot` hook. Used by `toMatchSnapshot.ts` to call into
// the runtime-only method.
export type PageInternal = Page & {
  _expectScreenshot(options: ExpectScreenshotOptions): Promise<ExpectScreenshotResult>;
};
