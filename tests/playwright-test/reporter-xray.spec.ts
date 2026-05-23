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
import { lastDryRunPayload } from './dry-run-helpers.js';

test('extracts test keys from titles, skips tests with no key', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = { reporter: [['xray', { dryRun: true, testPlan: 'QE-100' }]] };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('[QE-1] passes', () => {});
      test('[QE-2] fails', () => { throw new Error('e'); });
      test('untagged', () => {});
    `,
  });
  expect(result.exitCode).toBe(1);
  const payload = lastDryRunPayload(result.output, 'xray');
  expect(payload.info.testPlanKey).toBe('QE-100');
  expect(payload.tests.map((t: any) => t.testKey).sort()).toEqual(['QE-1', 'QE-2']);
  expect(payload.tests.find((t: any) => t.testKey === 'QE-1').status).toBe('PASSED');
  expect(payload.tests.find((t: any) => t.testKey === 'QE-2').status).toBe('FAILED');
});
