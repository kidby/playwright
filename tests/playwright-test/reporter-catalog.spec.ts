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

import { test, expect } from './playwright-test-fixtures';

test('prints area buckets with pass/fail/flaky counts and percentiles', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = {
        reporter: [['catalog', {
          productAreaResolver: file => ({ area: file.endsWith('billing.spec.ts') ? 'billing' : 'core' })
        }]]
      };
    `,
    'billing.spec.ts': `
      import { test } from '@playwright/test';
      test('checkout', () => {});
      test('invoice', () => {});
    `,
    'profile.spec.ts': `
      import { test } from '@playwright/test';
      test('avatar', () => {});
      test('preferences fail', () => { throw new Error('x'); });
    `,
  });
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain('Catalog summary');
  expect(result.output).toMatch(/billing\s+2P/);
  expect(result.output).toMatch(/core\s+1P 1F/);
  expect(result.output).toMatch(/p50=\d+ms/);
  expect(result.output).toMatch(/p90=\d+ms/);
  expect(result.output).toMatch(/p95=\d+ms/);
});
