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

test('emits one event per test with CI metadata and extraAttributes', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      export default { reporter: [['new-relic', {
        dryRun: true,
        eventType: 'CustomEvent',
        extraAttributes: { env: 'staging' },
      }]] };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('alpha', () => {});
      test('beta', () => { throw new Error('boom'); });
    `,
  });
  expect(result.exitCode).toBe(1);
  const events = lastDryRunPayload(result.output, 'new-relic');
  expect(Array.isArray(events)).toBe(true);
  expect(events).toHaveLength(2);
  expect(events[0].eventType).toBe('CustomEvent');
  expect(events[0].env).toBe('staging');
  expect(events.find((e: any) => e.testTitle === 'beta').status).toBe('failed');
  expect(events.find((e: any) => e.testTitle === 'beta').errorMessage).toContain('boom');
});
