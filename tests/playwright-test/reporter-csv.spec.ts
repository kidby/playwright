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

import fs from 'fs';
import path from 'path';
import { test, expect } from './playwright-test-fixtures.js';

test('csv reporter emits header + one row per test', async ({ runInlineTest }, testInfo) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      export default { reporter: [['csv', { outputFile: 'out.csv' }]] };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('passes', () => { expect(1).toBe(1); });
      test('fails', () => { expect(1).toBe(2); });
    `,
  });
  expect(result.exitCode).toBe(1);
  const csv = fs.readFileSync(path.join(testInfo.outputPath(), 'out.csv'), 'utf-8');
  const lines = csv.trim().split('\n');
  // header + 2 tests
  expect(lines).toHaveLength(3);
  expect(lines[0]).toBe('file,project,title,fullTitle,status,durationMs,retries,ticketId,error');
  // title field plus fullTitle (which includes file+suite path)
  expect(lines[1]).toMatch(/^a\.spec\.ts,,passes,.+passes,passed,/);
  expect(lines[2]).toMatch(/^a\.spec\.ts,,fails,.+fails,failed,/);
  // Error column populated for the failure
  expect(lines[2]).toMatch(/expect\(received\)\.toBe/);
});

test('csv reporter extracts ticket id when ticketPattern matches', async ({ runInlineTest }, testInfo) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      export default {
        reporter: [['csv', { outputFile: 'out.csv', ticketPattern: '\\\\[(QE-\\\\d+)\\\\]' }]]
      };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('[QE-123] login flow', () => {});
      test('no ticket here', () => {});
    `,
  });
  expect(result.exitCode).toBe(0);
  const csv = fs.readFileSync(path.join(testInfo.outputPath(), 'out.csv'), 'utf-8');
  const lines = csv.trim().split('\n');
  expect(lines[1]).toContain(',QE-123,'); // ticket extracted
  expect(lines[2]).toMatch(/,,$/);         // ticket blank (no error either)
});

test('csv reporter escapes commas and quotes per RFC 4180', async ({ runInlineTest }, testInfo) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      export default { reporter: [['csv', { outputFile: 'out.csv' }]] };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('comma, in title', () => {});
      test('quote "x" in title', () => {});
    `,
  });
  expect(result.exitCode).toBe(0);
  const csv = fs.readFileSync(path.join(testInfo.outputPath(), 'out.csv'), 'utf-8');
  expect(csv).toContain('"comma, in title"');
  expect(csv).toContain('"quote ""x"" in title"');
});

test('csv reporter noHeader omits column row', async ({ runInlineTest }, testInfo) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      export default { reporter: [['csv', { outputFile: 'out.csv', noHeader: true }]] };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('one', () => {});
    `,
  });
  expect(result.exitCode).toBe(0);
  const csv = fs.readFileSync(path.join(testInfo.outputPath(), 'out.csv'), 'utf-8');
  expect(csv).not.toContain('file,project,title');
  expect(csv.split('\n')[0]).toMatch(/^a\.spec\.ts,/);
});
