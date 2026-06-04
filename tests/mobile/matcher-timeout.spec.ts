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

// Regression sentinel for the unified matcher-timeout default. Before the
// fix, pollWeb hardcoded 5_000ms while the AppLocator path fell back to the
// locator's actionTimeoutMs (20_000ms). The single DEFAULT_MATCHER_TIMEOUT_MS
// constant in mobileMatchers.ts now backstops both paths, and both honor an
// explicit `{ timeout }` option identically.

import { test } from '@playwright/test';

import { NativeDevice, expect, iosCapabilities } from '../../packages/playwright-mobile/src/index.js';

import { startMockAppium } from './mockAppium.js';

import type { MockAppium } from './mockAppium.js';

let mock: MockAppium;
test.beforeEach(async () => { mock = await startMockAppium(); });
test.afterEach(async () => { await mock.close(); });

// A minimal web-Locator stand-in that never reports visible. The shape
// matches the duck-type check in mobileMatchers (`waitFor` + `isVisible`).
function neverVisibleWebStub() {
  return {
    waitFor: async () => {},
    isVisible: async () => false,
    isHidden: async () => true,
    isEnabled: async () => false,
    isDisabled: async () => true,
    isChecked: async () => false,
    textContent: async () => null,
    getAttribute: async () => null,
    inputValue: async () => '',
    count: async () => 0,
    evaluate: async () => undefined,
  };
}

test('explicit timeout option is honored uniformly across web-locator and AppLocator paths', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && /\/displayed$/.test(req.path))
      return { body: { value: false } };
  });
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example' }));
  device.defaultActionTimeoutMs = 60_000;

  const appLocator = device.app.byAccessibilityId('does-not-exist');
  const webLocator = neverVisibleWebStub();

  const appStart = Date.now();
  await expect(appLocator).toBeVisible({ timeout: 300 }).then(
      () => { throw new Error('expected timeout'); },
      () => {},
  );
  const appDuration = Date.now() - appStart;

  const webStart = Date.now();
  await expect(webLocator).toBeVisible({ timeout: 300 }).then(
      () => { throw new Error('expected timeout'); },
      () => {},
  );
  const webDuration = Date.now() - webStart;

  // Both paths should honor the small explicit timeout: ~300ms, never the
  // device's 60_000ms or any hardcoded 5_000ms default.
  expect(appDuration).toBeGreaterThanOrEqual(250);
  expect(appDuration).toBeLessThan(2_000);
  expect(webDuration).toBeGreaterThanOrEqual(250);
  expect(webDuration).toBeLessThan(2_000);

  await device.stop();
});

test('no asymmetry: both paths share the same default order — option > ctx > package default', async () => {
  // Verifies the constant is consumed (sourced from the package). Reading
  // the source string is the lightest possible assertion that the magic
  // 5_000 isn't sneaking back in.
  const fs = await import('fs');
  const path = await import('path');
  const url = await import('url');
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.resolve(here, '../../packages/playwright-mobile/src/mobileMatchers.ts'), 'utf-8');

  // Both timeout-fallback sites must reference the constant, not bare literals.
  const pollWebTimeoutLine = src.match(/const timeout = options\.timeout \?\? ctx\.timeout \?\? ([A-Z_]+);/);
  expect(pollWebTimeoutLine, 'pollWeb should use DEFAULT_MATCHER_TIMEOUT_MS, not a literal').not.toBeNull();
  expect(pollWebTimeoutLine![1]).toBe('DEFAULT_MATCHER_TIMEOUT_MS');

  // Locate the toHaveScreenshot fallback — `isLocator ? target.actionTimeoutMs : <fallback>`.
  const screenshotFallback = src.match(/isLocator \? target\.actionTimeoutMs : ([A-Z_]+)/);
  expect(screenshotFallback, 'toHaveScreenshot fallback should use the same constant').not.toBeNull();
  expect(screenshotFallback![1]).toBe('DEFAULT_MATCHER_TIMEOUT_MS');
});
