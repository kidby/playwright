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
import { test, expect } from './playwright-test-fixtures';

test('ai reporter writes per-failure markdown + index + jsonl', async ({ runInlineTest }, testInfo) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = { reporter: [['ai', { outputDir: 'ai-out' }]] };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('first failure', () => { throw new Error('boom one'); });
      test('second failure', () => { expect(1).toBe(2); });
      test('passes', () => {});
    `,
  });
  expect(result.exitCode).toBe(1);
  const aiDir = path.join(testInfo.outputPath(), 'ai-out');
  expect(fs.existsSync(path.join(aiDir, 'index.md'))).toBe(true);
  expect(fs.existsSync(path.join(aiDir, 'failures.jsonl'))).toBe(true);

  const index = fs.readFileSync(path.join(aiDir, 'index.md'), 'utf-8');
  expect(index).toContain('2 failures');
  expect(index).toContain('first failure');
  expect(index).toContain('second failure');
  expect(index).not.toContain('passes'); // passes excluded by default

  const jsonl = fs.readFileSync(path.join(aiDir, 'failures.jsonl'), 'utf-8').trim().split('\n');
  expect(jsonl).toHaveLength(2);
  const first = JSON.parse(jsonl[0]);
  expect(first.title).toBe('first failure');
  expect(first.errorMessages[0]).toContain('boom one');
});

test('ai reporter per-failure markdown teaches CLI investigation steps', async ({ runInlineTest }, testInfo) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = { reporter: [['ai', { outputDir: 'ai-out' }]] };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('boom test', () => { throw new Error('boom'); });
    `,
  });
  expect(result.exitCode).toBe(1);
  const aiDir = path.join(testInfo.outputPath(), 'ai-out');
  const files = fs.readdirSync(aiDir).filter(f => f.endsWith('.md') && f !== 'index.md');
  expect(files.length).toBe(1);
  const briefing = fs.readFileSync(path.join(aiDir, files[0]), 'utf-8');
  // The distinguishing block of this reporter.
  expect(briefing).toContain('## How to investigate');
  expect(briefing).toContain('npx playwright show-report');
  expect(briefing).toContain('npx playwright test');
  expect(briefing).toContain('npx playwright codegen');
  expect(briefing).toContain('Reporter source: `packages/playwright/src/reporters/ai.ts`');
});

test('ai reporter inline prompt is prepended', async ({ runInlineTest }, testInfo) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = {
        reporter: [['ai', { outputDir: 'ai-out', prompt: 'You are the Intellum triage bot.\\nAlways suggest a JIRA label.' }]]
      };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('bad', () => { throw new Error('x'); });
    `,
  });
  expect(result.exitCode).toBe(1);
  const aiDir = path.join(testInfo.outputPath(), 'ai-out');
  const files = fs.readdirSync(aiDir).filter(f => f.endsWith('.md') && f !== 'index.md');
  const briefing = fs.readFileSync(path.join(aiDir, files[0]), 'utf-8');
  expect(briefing.startsWith('You are the Intellum triage bot.')).toBe(true);
  expect(briefing).toMatch(/# Failure:.*\bbad\b/);
});

test('ai reporter writes empty index when all pass', async ({ runInlineTest }, testInfo) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = { reporter: [['ai', { outputDir: 'ai-out' }]] };
    `,
    'a.spec.ts': `
      import { test } from '@playwright/test';
      test('a', () => {});
    `,
  });
  expect(result.exitCode).toBe(0);
  const aiDir = path.join(testInfo.outputPath(), 'ai-out');
  const index = fs.readFileSync(path.join(aiDir, 'index.md'), 'utf-8');
  expect(index).toContain('0 failures');
  expect(index).toContain('_No failures._');
  const jsonl = fs.readFileSync(path.join(aiDir, 'failures.jsonl'), 'utf-8');
  expect(jsonl).toBe('');
});
