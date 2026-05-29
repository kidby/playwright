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
// expect.configure({ timeout }) (this.timeout) → locator/device default
// (passed as `undefined`, which the locator's pollUntil maps to its own
// `actionTimeoutMs`).
function effectiveTimeout(ctx: MatcherContext, options: { timeout?: number }): number | undefined {
  return options.timeout ?? ctx.timeout;
}

function requireAppLocator(received: unknown, matcher: string): AppLocator {
  if (!(received instanceof AppLocator))
    throw new Error(`${matcher}() expected an AppLocator (from @playwright/experimental-mobile), got ${received === null ? 'null' : typeof received}`);
  return received;
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
    const locator = requireAppLocator(received, 'toBeVisible');
    return pollAssertion(this, locator, options, 'to be visible', async () => ({ ok: await locator.isDisplayed() }));
  },

  async toBeHidden(this: MatcherContext, received: unknown, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    const locator = requireAppLocator(received, 'toBeHidden');
    return pollAssertion(this, locator, options, 'to be hidden', async () => ({ ok: !(await locator.isDisplayed()) }));
  },

  async toBeEnabled(this: MatcherContext, received: unknown, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    const locator = requireAppLocator(received, 'toBeEnabled');
    return pollAssertion(this, locator, options, 'to be enabled', async () => ({ ok: await locator.isEnabled() }));
  },

  async toBeDisabled(this: MatcherContext, received: unknown, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    const locator = requireAppLocator(received, 'toBeDisabled');
    return pollAssertion(this, locator, options, 'to be disabled', async () => ({ ok: !(await locator.isEnabled()) }));
  },

  async toHaveText(this: MatcherContext, received: unknown, expected: string | RegExp, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    const locator = requireAppLocator(received, 'toHaveText');
    return pollAssertion(this, locator, options, `to have text ${formatExpected(expected)}`, async () => {
      const text = await locator.text().catch(() => '');
      return { ok: textMatches(text, expected), detail: JSON.stringify(text) };
    });
  },

  async toContainText(this: MatcherContext, received: unknown, expected: string | RegExp, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    const locator = requireAppLocator(received, 'toContainText');
    return pollAssertion(this, locator, options, `to contain text ${formatExpected(expected)}`, async () => {
      const text = await locator.text().catch(() => '');
      return { ok: textContains(text, expected), detail: JSON.stringify(text) };
    });
  },

  async toHaveAttribute(this: MatcherContext, received: unknown, name: string, expected: string | RegExp, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    const locator = requireAppLocator(received, 'toHaveAttribute');
    return pollAssertion(this, locator, options, `attribute "${name}" to ${expected instanceof RegExp ? 'match' : 'equal'} ${formatExpected(expected)}`, async () => {
      const value = await locator.getAttribute(name).catch(() => null);
      if (value === null)
        return { ok: false, detail: 'null' };
      return { ok: textMatches(value, expected), detail: JSON.stringify(value) };
    });
  },

  async toHaveValue(this: MatcherContext, received: unknown, expected: string | RegExp, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    const locator = requireAppLocator(received, 'toHaveValue');
    return pollAssertion(this, locator, options, `value to ${expected instanceof RegExp ? 'match' : 'equal'} ${formatExpected(expected)}`, async () => {
      const value = await locator.getAttribute('value').catch(() => null);
      if (value === null)
        return { ok: false, detail: 'null' };
      return { ok: textMatches(value, expected), detail: JSON.stringify(value) };
    });
  },

  async toHaveCount(this: MatcherContext, received: unknown, expected: number, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    const locator = requireAppLocator(received, 'toHaveCount');
    return pollAssertion(this, locator, options, `count to equal ${expected}`, async () => {
      const count = await locator.count().catch(() => -1);
      return { ok: count === expected, detail: String(count) };
    });
  },

  async toBeChecked(this: MatcherContext, received: unknown, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    const locator = requireAppLocator(received, 'toBeChecked');
    return pollAssertion(this, locator, options, 'to be checked', async () => {
      const attr = locator.client.platform === 'Android' ? 'checked' : 'value';
      const v = await locator.getAttribute(attr).catch(() => null);
      // iOS XCUITest reports `value` as "1" for checked switches/buttons,
      // "0" for unchecked. Android UiAutomator2 reports `checked` as
      // "true"/"false".
      const ok = v === 'true' || v === '1';
      return { ok, detail: JSON.stringify(v) };
    });
  },

  async toBeFocused(this: MatcherContext, received: unknown, options: MatcherTimeoutOptions = {}): Promise<MatcherResult> {
    const locator = requireAppLocator(received, 'toBeFocused');
    return pollAssertion(this, locator, options, 'to be focused', async () => {
      const attr = locator.client.platform === 'Android' ? 'focused' : 'hasFocus';
      const v = await locator.getAttribute(attr).catch(() => null);
      const ok = v === 'true' || v === '1';
      return { ok, detail: JSON.stringify(v) };
    });
  },

  async toHaveScreenshot(this: MatcherContext, received: unknown, nameOrOptions: string | string[] | MobileScreenshotOptions = {}, maybeOptions: MobileScreenshotOptions = {}): Promise<MatcherResult> {
    const target = requireNativeDeviceOrLocator(received, 'toHaveScreenshot');
    const { name, options } = splitNameAndOptions(nameOrOptions, maybeOptions);

    const isLocator = target instanceof AppLocator;
    const client = isLocator ? target.client : target.client;
    const platform = client.platform;
    const deviceName = (client.capabilities?.['appium:deviceName'] as string | undefined);
    const scaleFactor = isLocator ? undefined : target.deviceScaleFactor;

    const capture = isLocator
      ? async () => client.elementScreenshot(await target.resolve())
      : async () => client.screenshot();

    const stabilizationFrames = options.stabilizationFrames ?? 2;
    const pollMs = options.pollMs ?? (isLocator ? target.pollMs : 100);
    const outerTimeoutMs = (options as MatcherTimeoutOptions).timeout
      ?? this.timeout
      ?? (isLocator ? target.actionTimeoutMs : 20_000);
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
