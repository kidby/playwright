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

import { test, expect } from './playwright-test-fixtures.js';

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

test('renders jira shortcut links per test', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = {
        reporter: [['catalog', {
          jira: { baseUrl: 'https://example.atlassian.net/browse/' },
        }]],
      };
    `,
    'a.spec.ts': `
      import { test } from '@playwright/test';
      test('[QE-101] checkout works', () => {});
    `,
  });
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain('https://example.atlassian.net/browse/QE-101');
});

test('linkResolver overrides jira shortcut', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = {
        reporter: [['catalog', {
          jira: { baseUrl: 'https://wrong.atlassian.net/browse/' },
          linkResolver: () => ({ jira: 'https://custom.example/TICKET-1' }),
        }]],
      };
    `,
    'a.spec.ts': `
      import { test } from '@playwright/test';
      test('[QE-999] custom mapping', () => {});
    `,
  });
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain('https://custom.example/TICKET-1');
  expect(result.output).not.toContain('wrong.atlassian.net');
});

test('sourceBaseUrl emits a source link with line anchor', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = {
        reporter: [['catalog', { sourceBaseUrl: 'https://example.com/src/' }]],
      };
    `,
    'a.spec.ts': `
      import { test } from '@playwright/test';
      test('linked', () => {});
    `,
  });
  expect(result.exitCode).toBe(0);
  expect(result.output).toMatch(/https:\/\/example\.com\/src\/a\.spec\.ts#L\d+/);
});

test('emits insights box and reports overall metrics', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = {
        reporter: [['catalog', { showInsights: true }]],
      };
    `,
    'a.spec.ts': `
      import { test } from '@playwright/test';
      test('one', () => {});
      test('two', () => {});
      test('three', () => {});
    `,
  });
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain('Performance & Resource Metrics');
  expect(result.output).toContain('Insights');
});

test('inline failure block is printed under the failing test', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = {
        reporter: [['catalog', { printFailuresInline: true }]],
      };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('ok', () => {});
      test('boom', () => { expect(1).toBe(2); });
    `,
  });
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain('boom');
  expect(result.output).toContain('Expected: 2');
  expect(result.output).toContain('Received: 1');
});
