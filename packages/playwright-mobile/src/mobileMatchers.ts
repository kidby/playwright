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

// Web-first assertion matchers for mobile (Appium) locators. Each matcher
// polls the underlying one-shot locator method until the condition is met
// or the timeout fires — same cadence and semantics as Playwright's web
// `expect(locator).toBeVisible()` family.

import { test as baseTest } from 'playwright/test';

import { AppLocator } from './appLocator.js';
import { NativeDevice } from "./nativeDevice.js";
import { compareToBaseline, defaultBaselineName, stabilize } from './screenshotComparator.js';

import type { MobileScreenshotOptions } from './screenshotComparator.js';

export type MatcherTimeoutOptions = { timeout?: number };

// Single package-wide last-resort fallback. AppLocator-based matchers prefer
// the locator's `actionTimeoutMs` (which inherits from the device fixture, so
// `defaultActionTimeoutMs` from config takes effect); web-locator matchers
// and NativeDevice-only matchers fall back to this constant. Aligns mobile
// and web assertions in mixed specs so identical `expect().toBeVisible()`
// calls don't time out at different windows.
const DEFAULT_MATCHER_TIMEOUT_MS = 5000;

type MatcherResult = { pass: boolean; message: () => string; name?: string; actual?: unknown; expected?: unknown };

type MatcherContext = {
  isNot?: boolean;
  // Playwright binds `timeout` from `expect.configure({ timeout })` (or
  // the per-call info.timeout). When unset, falls back to the locator's
  // default in `effectiveTimeout` below.
  timeout?: number;
  // The Playwright runner injects testInfo for snapshot-bearing matchers.
  // Treat as optional everywhere else.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  testInfo?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  snapshotPath?: (...names: string[]) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  utils?: any;
};

// Resolution order for every matcher's timeout: explicit per-call option →
// expect.configure({ timeout }) (this.timeout) → DEFAULT_MATCHER_TIMEOUT_MS
function effectiveTimeout(ctx: MatcherContext, options: { timeout?: number }): number {
  return options.timeout ?? ctx.timeout ?? DEFAULT_MATCHER_TIMEOUT_MS;
}

function requireAppLocator(received: unknown, matcher: string): AppLocator {
  if (!(received instanceof AppLocator))
    throw new Error(`${matcher}() expected an AppLocator (from @playwright/experimental-mobile), got ${received === null ? 'null' : typeof received}`);
  return received;
}

type WebLocator = {
  waitFor: (options?: { state?: 'attached' | 'detached' | 'visible' | 'hidden'; timeout?: number }) => Promise<void>;
  isVisible: () => Promise<boolean>;
  isHidden: () => Promise<boolean>;
  isEnabled: () => Promise<boolean>;
  isDisabled: () => Promise<boolean>;
  isChecked: () => Promise<boolean>;
  textContent: () => Promise<string | null>;
  getAttribute: (name: string) => Promise<string | null>;
  inputValue: () => Promise<string>;
  count: () => Promise<number>;
  evaluate: <R>(fn: (el: Element) => R) => Promise<R>;
};

function isWebLocator(received: unknown): received is WebLocator {
  return !!received && typeof received === 'object' && typeof (received as WebLocator).waitFor === 'function';
}

async function pollWeb(
  ctx: MatcherContext,
  options: MatcherTimeoutOptions,
  what: string,
  check: () => Promise<{ ok: boolean; detail?: string }>,
): Promise<MatcherResult> {
  const isNot = !!ctx.isNot;
  const timeout = options.timeout ?? ctx.timeout ?? DEFAULT_MATCHER_TIMEOUT_MS;
  const deadline = Date.now() + timeout;
  let last: { ok: boolean; detail?: string } = { ok: false };
  while (Date.now() <= deadline) {
    last = await check().catch(() => ({ ok: false }));
    if (last.ok !== isNot)
      return { pass: !isNot, message: () => '' };
    await new Promise(r => setTimeout(r, 100));
  }
  return {
    pass: isNot,
    message: () => `Expected ${what} within ${timeout}ms${last.detail ? ` — last: ${last.detail}` : ''}.`,
  };
}

function requireNativeDeviceOrLocator(received: unknown, matcher: string): AppLocator | NativeDevice {
  if (received instanceof AppLocator || received instanceof NativeDevice)
    return received;
  throw new Error(`${matcher}() expected an AppLocator or NativeDevice, got ${received === null ? 'null' : typeof received}`);
}

// Run a polling check and translate the throw-on-timeout result into the
// `{ pass, message }` shape Playwright expects, accounting for `.not` and
// the timeout resolution order (per-call > expect.configure > locator
// default).
async function pollAssertion(
  ctx: MatcherContext,
  locator: AppLocator,
  options: MatcherTimeoutOptions,
  what: string,
  check: () => Promise<{ ok: boolean; detail?: string }>,
): Promise<MatcherResult> {
  const isNot = !!ctx.isNot;
  const timeoutMs = effectiveTimeout(ctx, options);
  let lastDetail: string | undefined;
  try {
    await locator.pollUntil(async () => {
      const r = await check();
      lastDetail = r.detail;
      // `.not` inverts the polling target: succeed when ok === isNot.
      return { matched: r.ok !== isNot, value: undefined };
    }, { what, timeoutMs });
    return { pass: !isNot, message: () => `Expected ${locator.describe()} ${isNot ? 'not ' : ''}${what} — passed.` };
  } catch (err) {
    const head = `Expected ${locator.describe()} ${isNot ? 'not ' : ''}${what}.`;
    const tail = lastDetail ? ` Last observed: ${lastDetail}.` : '';
    return {
      pass: isNot,
      message: () => `${head}${tail} ${(err as Error).message}`,
    };
  }
}

function textMatches(actual: string, expected: string | RegExp): boolean {
  return expected instanceof RegExp ? expected.test(actual) : actual === expected;
}

function textContains(actual: string, expected: string | RegExp): boolean {
  return expected instanceof RegExp ? expected.test(actual) : actual.includes(expected);
}

// Each entry follows the `expect.extend` convention: `function(received, ...)`
// with `this` bound to the matcher context (isNot, testInfo, etc.). Wrappers
// return `Promise<MatcherResult>`.

export const mobileMatchers = {
  async toBeVisible(this: MatcherContext, received: unknown, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    if (received instanceof AppLocator)
      return pollAssertion(this, received, options, 'to be visible', async () => ({ ok: await received.isDisplayed() }));
    if (isWebLocator(received))
      return pollWeb(this, options, 'to be visible', async () => ({ ok: await received.isVisible() }));
    throw new Error(`toBeVisible() expected an AppLocator or a Playwright Locator, got ${received === null ? 'null' : typeof received}`);
  },

  async toBeHidden(this: MatcherContext, received: unknown, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    if (received instanceof AppLocator)
      return pollAssertion(this, received, options, 'to be hidden', async () => ({ ok: !(await received.isDisplayed()) }));
    if (isWebLocator(received))
      return pollWeb(this, options, 'to be hidden', async () => ({ ok: await received.isHidden() }));
    throw new Error(`toBeHidden() expected an AppLocator or a Playwright Locator, got ${received === null ? 'null' : typeof received}`);
  },

  async toBeEnabled(this: MatcherContext, received: unknown, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    if (received instanceof AppLocator)
      return pollAssertion(this, received, options, 'to be enabled', async () => ({ ok: await received.isEnabled() }));
    if (isWebLocator(received))
      return pollWeb(this, options, 'to be enabled', async () => ({ ok: await received.isEnabled() }));
    throw new Error(`toBeEnabled() expected an AppLocator or a Playwright Locator, got ${received === null ? 'null' : typeof received}`);
  },

  async toBeDisabled(this: MatcherContext, received: unknown, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    if (received instanceof AppLocator)
      return pollAssertion(this, received, options, 'to be disabled', async () => ({ ok: !(await received.isEnabled()) }));
    if (isWebLocator(received))
      return pollWeb(this, options, 'to be disabled', async () => ({ ok: await received.isDisabled() }));
    throw new Error(`toBeDisabled() expected an AppLocator or a Playwright Locator, got ${received === null ? 'null' : typeof received}`);
  },

  async toHaveText(this: MatcherContext, received: unknown, expected: string | RegExp, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    if (received instanceof AppLocator) {
      return pollAssertion(this, received, options, `to have text ${formatExpected(expected)}`, async () => {
        const text = await received.text().catch(() => '');
        return { ok: textMatches(text, expected), detail: JSON.stringify(text) };
      });
    }
    if (isWebLocator(received)) {
      return pollWeb(this, options, `to have text ${formatExpected(expected)}`, async () => {
        const text = (await received.textContent().catch(() => '')) ?? '';
        return { ok: textMatches(text, expected), detail: JSON.stringify(text) };
      });
    }
    throw new Error(`toHaveText() expected an AppLocator or a Playwright Locator, got ${received === null ? 'null' : typeof received}`);
  },

  async toContainText(this: MatcherContext, received: unknown, expected: string | RegExp, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    if (received instanceof AppLocator) {
      return pollAssertion(this, received, options, `to contain text ${formatExpected(expected)}`, async () => {
        const text = await received.text().catch(() => '');
        return { ok: textContains(text, expected), detail: JSON.stringify(text) };
      });
    }
    if (isWebLocator(received)) {
      return pollWeb(this, options, `to contain text ${formatExpected(expected)}`, async () => {
        const text = (await received.textContent().catch(() => '')) ?? '';
        return { ok: textContains(text, expected), detail: JSON.stringify(text) };
      });
    }
    throw new Error(`toContainText() expected an AppLocator or a Playwright Locator, got ${received === null ? 'null' : typeof received}`);
  },

  async toHaveAttribute(this: MatcherContext, received: unknown, name: string, expected: string | RegExp, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    const what = `attribute "${name}" to ${expected instanceof RegExp ? 'match' : 'equal'} ${formatExpected(expected)}`;
    const evaluate = async (value: string | null): Promise<{ ok: boolean; detail?: string }> => {
      if (value === null)
        return { ok: false, detail: 'null' };
      return { ok: textMatches(value, expected), detail: JSON.stringify(value) };
    };
    if (received instanceof AppLocator)
      return pollAssertion(this, received, options, what, async () => evaluate(await received.getAttribute(name).catch(() => null)));
    if (isWebLocator(received))
      return pollWeb(this, options, what, async () => evaluate(await received.getAttribute(name).catch(() => null)));
    throw new Error(`toHaveAttribute() expected an AppLocator or a Playwright Locator, got ${received === null ? 'null' : typeof received}`);
  },

  async toHaveValue(this: MatcherContext, received: unknown, expected: string | RegExp, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    const what = `value to ${expected instanceof RegExp ? 'match' : 'equal'} ${formatExpected(expected)}`;
    if (received instanceof AppLocator) {
      return pollAssertion(this, received, options, what, async () => {
        const value = await received.getAttribute('value').catch(() => null);
        if (value === null)
          return { ok: false, detail: 'null' };
        return { ok: textMatches(value, expected), detail: JSON.stringify(value) };
      });
    }
    if (isWebLocator(received)) {
      return pollWeb(this, options, what, async () => {
        const value = await received.inputValue().catch(() => null);
        if (value === null)
          return { ok: false, detail: 'null' };
        return { ok: textMatches(value, expected), detail: JSON.stringify(value) };
      });
    }
    throw new Error(`toHaveValue() expected an AppLocator or a Playwright Locator, got ${received === null ? 'null' : typeof received}`);
  },

  async toHaveCount(this: MatcherContext, received: unknown, expected: number, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    if (received instanceof AppLocator) {
      return pollAssertion(this, received, options, `count to equal ${expected}`, async () => {
        const count = await received.count().catch(() => -1);
        return { ok: count === expected, detail: String(count) };
      });
    }
    if (isWebLocator(received)) {
      return pollWeb(this, options, `count to equal ${expected}`, async () => {
        const count = await received.count().catch(() => -1);
        return { ok: count === expected, detail: String(count) };
      });
    }
    throw new Error(`toHaveCount() expected an AppLocator or a Playwright Locator, got ${received === null ? 'null' : typeof received}`);
  },

  async toBeChecked(this: MatcherContext, received: unknown, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    if (received instanceof AppLocator) {
      return pollAssertion(this, received, options, 'to be checked', async () => {
        const attr = received.client.platform === 'Android' ? 'checked' : 'value';
        const v = await received.getAttribute(attr).catch(() => null);
        const ok = v === 'true' || v === '1';
        return { ok, detail: JSON.stringify(v) };
      });
    }
    if (isWebLocator(received))
      return pollWeb(this, options, 'to be checked', async () => ({ ok: await received.isChecked() }));
    throw new Error(`toBeChecked() expected an AppLocator or a Playwright Locator, got ${received === null ? 'null' : typeof received}`);
  },

  async toBeFocused(this: MatcherContext, received: unknown, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    if (received instanceof AppLocator) {
      return pollAssertion(this, received, options, 'to be focused', async () => {
        const attr = received.client.platform === 'Android' ? 'focused' : 'hasFocus';
        const v = await received.getAttribute(attr).catch(() => null);
        const ok = v === 'true' || v === '1';
        return { ok, detail: JSON.stringify(v) };
      });
    }
    if (isWebLocator(received)) {
      return pollWeb(this, options, 'to be focused', async () => {
        const focused = await received.evaluate((el: Element) => el === el.ownerDocument.activeElement).catch(() => false);
        return { ok: focused };
      });
    }
    throw new Error(`toBeFocused() expected an AppLocator or a Playwright Locator, got ${received === null ? 'null' : typeof received}`);
  },

  async toHaveScreenshot(this: MatcherContext, received: unknown, nameOrOptions: string | string[] | MobileScreenshotOptions = {}, maybeOptions: MobileScreenshotOptions = {}): Promise<MatcherResult> {
    if (!(received instanceof AppLocator) && !(received instanceof NativeDevice)) {
      throw new Error(
          'toHaveScreenshot(): received a non-mobile target. The @playwright/mobile screenshot matcher only handles AppLocator and NativeDevice. ' +
          'For web Page/Locator screenshots, import `expect` from `@playwright/test` directly in the spec (avoid using the same expect both for mobile and web).',
      );
    }
    const target = requireNativeDeviceOrLocator(received, 'toHaveScreenshot');
    const { name, options } = splitNameAndOptions(nameOrOptions, maybeOptions);

    const isLocator = target instanceof AppLocator;
    const client = isLocator ? target.client : target.client;
    const platform = client.platform;
    const deviceName = (client.capabilities?.['appium:deviceName'] as string | undefined);
    const scaleFactor = isLocator ? undefined : target.deviceScaleFactor;

    const capture = isLocator
      ? async () => target.screenshot()
      : async () => client.screenshot();

    const stabilizationFrames = options.stabilizationFrames ?? 2;
    const pollMs = options.pollMs ?? (isLocator ? target.pollMs : 100);
    const outerTimeoutMs = (options as MatcherTimeoutOptions).timeout
      ?? this.timeout
      ?? (isLocator ? target.actionTimeoutMs : DEFAULT_MATCHER_TIMEOUT_MS);
    const stabilizationTimeoutMs = options.stabilizationTimeoutMs ?? Math.min(outerTimeoutMs, 5_000);

    // Playwright's `expect.extend` doesn't forward testInfo on `this`, so
    // pull it from the active test context directly. Throws if called
    // outside a running test (which is the right behavior for this
    // matcher — there's nowhere to write baselines).
    let testInfo: any;
    try {
      testInfo = baseTest.info();
    } catch {
      throw new Error('toHaveScreenshot() must be called from within a Playwright test.');
    }

    const testTitle = (testInfo.title as string | undefined)
      ?? (Array.isArray(testInfo.titlePath) ? testInfo.titlePath.slice(-1)[0] as string : undefined)
      ?? 'screenshot';
    const baselineFilename = defaultBaselineName({ testTitle, platform, deviceName, scaleFactor, override: name });

    // Snapshot dir: snapshot file lives in `testInfo.snapshotDir`, which is
    // alongside the spec by default. Falls back to outputDir if absent.
    const baselineDir: string = testInfo.snapshotDir
      ?? testInfo.outputDir
      ?? process.cwd();

    const deadline = Date.now() + outerTimeoutMs;
    const captured = await stabilize(capture, {
      stabilizationFrames,
      pollMs,
      deadline: Math.min(Date.now() + stabilizationTimeoutMs, deadline),
    });

    const updateSnapshots: 'all' | 'none' | 'missing' = testInfo.config?.updateSnapshots ?? options.updateSnapshots ?? 'missing';
    const compareResult = compareToBaseline(baselineDir, baselineFilename, captured, {
      ...options,
      updateSnapshots,
    });

    const isNot = !!this.isNot;
    if (compareResult.mode === 'pass')
      return { pass: !isNot, message: () => 'Screenshot matched baseline.' };
    if (compareResult.mode === 'written') {
      return {
        pass: !isNot,
        message: () => `Baseline written to ${compareResult.path}. Re-run to compare.`,
      };
    }
    // Attach artifacts so reporters can show the diff.
    if (testInfo.attach) {
      try {
        await testInfo.attach('actual', { path: compareResult.actualPath, contentType: 'image/png' });
        if (compareResult.expectedPath)
          await testInfo.attach('expected', { path: compareResult.expectedPath, contentType: 'image/png' });
        if (compareResult.diffPath)
          await testInfo.attach('diff', { path: compareResult.diffPath, contentType: 'image/png' });
      } catch {
        // Attaching is best-effort; don't fail the matcher on attach errors.
      }
    }
    return {
      pass: isNot,
      message: () => compareResult.message,
    };
  },
};

function formatExpected(expected: string | RegExp): string {
  if (expected instanceof RegExp)
    return expected.toString();
  return JSON.stringify(expected);
}

function splitNameAndOptions(
  nameOrOptions: string | string[] | MobileScreenshotOptions,
  maybeOptions: MobileScreenshotOptions,
): { name?: string | string[]; options: MobileScreenshotOptions & MatcherTimeoutOptions } {
  if (typeof nameOrOptions === 'string' || Array.isArray(nameOrOptions))
    return { name: nameOrOptions, options: maybeOptions };
  return { name: nameOrOptions.name, options: nameOrOptions };
}
