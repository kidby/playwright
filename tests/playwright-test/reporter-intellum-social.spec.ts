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

test('emits structured payload with kind, body, and CI meta', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = { reporter: [['intellum-social', { dryRun: true }]] };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('fails', () => { throw new Error('boom'); });
    `,
  });
  expect(result.exitCode).toBe(1);
  const payloads = extractDryRunPayloads(result.output, 'intellum-social');
  expect(payloads).toHaveLength(1);
  expect(payloads[0].kind).toBe('test-run');
  expect(payloads[0].body[0].error).toContain('boom');
  expect(payloads[0].meta.totals.failed).toBe(1);
});
