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

// Regression sentinel for AI reporter log routing under workers > 1.
// The handlers key per-test logs by `testKey(test)` derived from the
// `test` parameter Playwright passes to onStdOut/onStdErr — not from any
// "current test" singleton. If a future refactor reintroduces a singleton
// (the dead `_currentTestId` field was removed in this fork), this test
// will fail because parallel tests would cross-contaminate each other's
// logs in the per-failure markdown briefings.

import fs from 'fs';
import path from 'path';

import { test, expect } from './playwright-test-fixtures.js';

test('logs are attributed to the correct test under workers > 1', async ({ runInlineTest }, testInfo) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = {
        reporter: [['ai', { outputDir: 'ai-out' }]],
        workers: 3,
      };
    `,
    'a.spec.ts': `
      import { test } from '@playwright/test';
      test('alpha-fails', async () => {
        process.stdout.write('marker-alpha-stdout\\n');
        process.stderr.write('marker-alpha-stderr\\n');
        await new Promise(r => setTimeout(r, 50));
        throw new Error('alpha boom');
      });
    `,
    'b.spec.ts': `
      import { test } from '@playwright/test';
      test('bravo-fails', async () => {
        process.stdout.write('marker-bravo-stdout\\n');
        process.stderr.write('marker-bravo-stderr\\n');
        await new Promise(r => setTimeout(r, 50));
        throw new Error('bravo boom');
      });
    `,
    'c.spec.ts': `
      import { test } from '@playwright/test';
      test('charlie-fails', async () => {
        process.stdout.write('marker-charlie-stdout\\n');
        process.stderr.write('marker-charlie-stderr\\n');
        await new Promise(r => setTimeout(r, 50));
        throw new Error('charlie boom');
      });
    `,
  }, { workers: 3 });

  expect(result.exitCode).toBe(1);
  const aiDir = path.join(testInfo.outputPath(), 'ai-out');
  const briefingFiles = fs.readdirSync(aiDir).filter(f => f.endsWith('.md') && f !== 'index.md');
  expect(briefingFiles.length).toBe(3);

  const briefings = briefingFiles.map(f => ({
    name: f,
    body: fs.readFileSync(path.join(aiDir, f), 'utf-8'),
  }));

  // Each briefing should contain its own test's markers and NONE of the others'.
  // If a singleton _currentTestId resurfaced, parallel writes from sibling
  // tests would land in the wrong briefing's "console output" section.
  const greek = ['alpha', 'bravo', 'charlie'] as const;
  for (const me of greek) {
    const mine = briefings.find(b => b.body.includes(`${me}-fails`));
    expect(mine, `briefing for ${me} not found`).toBeTruthy();
    expect(mine!.body).toContain(`marker-${me}-stdout`);
    expect(mine!.body).toContain(`marker-${me}-stderr`);
    for (const other of greek) {
      if (other === me)
        continue;
      expect(
          mine!.body.includes(`marker-${other}-stdout`),
          `briefing for ${me} leaked marker-${other}-stdout — log routing under workers>1 is broken`,
      ).toBe(false);
      expect(
          mine!.body.includes(`marker-${other}-stderr`),
          `briefing for ${me} leaked marker-${other}-stderr — log routing under workers>1 is broken`,
      ).toBe(false);
    }
  }
});
