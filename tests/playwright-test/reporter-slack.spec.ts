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
import { extractDryRunPayloads } from './dry-run-helpers';

test('summary mode emits one payload at end of run', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = { reporter: [['slack', { dryRun: true }]] };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('ok', () => {});
      test('breaks', () => { throw new Error('boom on line 1\\nmore detail'); });
    `,
  });
  expect(result.exitCode).toBe(1);
  const payloads = extractDryRunPayloads(result.output, 'slack');
  expect(payloads).toHaveLength(1);
  const summary = payloads[0];
  expect(summary.text).toContain('1 test failed');
  expect(summary.text).toContain('breaks');
  // Only the first error line lands in the message — no traceback noise.
  expect(summary.text).toContain('boom on line 1');
  expect(summary.text).not.toContain('more detail');
});

test('per-test mode emits one payload per failure plus a summary in `both`', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = { reporter: [['slack', { dryRun: true, mode: 'both' }]] };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('fail one', () => { throw new Error('e1'); });
      test('fail two', () => { throw new Error('e2'); });
    `,
  });
  expect(result.exitCode).toBe(1);
  const payloads = extractDryRunPayloads(result.output, 'slack');
  expect(payloads).toHaveLength(3); // 2 per-test + 1 summary
  expect(payloads[2].text).toContain('2 tests failed');
});

test('mention prepends user pings on failure', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = { reporter: [['slack', { dryRun: true, mention: ['U123', 'U456'] }]] };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('fails', () => { throw new Error('x'); });
    `,
  });
  expect(result.exitCode).toBe(1);
  const payloads = extractDryRunPayloads(result.output, 'slack');
  expect(payloads[0].text).toContain('<@U123>');
  expect(payloads[0].text).toContain('<@U456>');
});

test('summary mode fires a "passed" heartbeat even when nothing failed', async ({ runInlineTest }) => {
  // The reporter could elide passing-only runs, but a heartbeat makes the
  // mode contract obvious: summary always emits exactly one summary message.
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = { reporter: [['slack', { dryRun: true }]] };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('ok', () => {});
    `,
  });
  expect(result.exitCode).toBe(0);
  const payloads = extractDryRunPayloads(result.output, 'slack');
  expect(payloads).toHaveLength(1);
  expect(payloads[0].text).toContain('passed');
});

test('does nothing when webhookUrl is missing and dryRun is off', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = { reporter: [['slack', {}]] };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('fails', () => { throw new Error('x'); });
    `,
  });
  expect(result.exitCode).toBe(1);
  expect(result.output).not.toContain('webhook responded');
  expect(result.output).not.toContain('webhook error');
});
