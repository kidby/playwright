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

// Verifies the `shardingMode` config / `--sharding-mode` CLI flag.
// Each test runs a fixed set of synthetic specs across 3 shards with
// `--reporter=json` and asserts on which tests landed where.

import path from 'path';

import { test, expect } from './playwright-test-fixtures';

// Build a fixed set of 12 tests across 3 files. The names encode their
// index so the JSON reporter output is trivially mappable to test IDs.
function twelveTests() {
  const mkFile = (start: number) => `
    import { test } from '@playwright/test';
    ${Array.from({ length: 4 }, (_, i) => `test('t${start + i}', () => {});`).join('\n    ')}
  `;
  return {
    'playwright.config.ts': `export default { projects: [{ name: 'p' }] };`,
    'a.test.ts': mkFile(1),
    'b.test.ts': mkFile(5),
    'c.test.ts': mkFile(9),
  };
}

async function runShard(runInlineTest: any, files: Record<string, string>, current: number, total: number, extraArgs: string[] = []) {
  return runInlineTest(files, {
    'reporter': 'json',
    'shard': `${current}/${total}`,
    ...Object.fromEntries(extraArgs.map(a => {
      const eq = a.indexOf('=');
      return eq === -1 ? [a, ''] : [a.slice(0, eq), a.slice(eq + 1)];
    })),
  });
}

function testIdsFromReport(report: any): string[] {
  const ids: string[] = [];
  const walk = (suite: any) => {
    for (const spec of suite.specs ?? [])
      ids.push(spec.title);
    for (const child of suite.suites ?? [])
      walk(child);
  };
  for (const top of report.suites ?? [])
    walk(top);
  return ids.sort();
}

test('shardingMode=partition gives contiguous slices (default)', async ({ runInlineTest }) => {
  const files = twelveTests();
  const r1 = await runShard(runInlineTest, files, 1, 3);
  const r2 = await runShard(runInlineTest, files, 2, 3);
  const r3 = await runShard(runInlineTest, files, 3, 3);
  expect(r1.exitCode).toBe(0);
  expect(r2.exitCode).toBe(0);
  expect(r3.exitCode).toBe(0);
  // 12 tests / 3 shards = 4 each, contiguous.
  expect(testIdsFromReport(r1.report)).toEqual(['t1', 't2', 't3', 't4']);
  expect(testIdsFromReport(r2.report)).toEqual(['t5', 't6', 't7', 't8']);
  expect(testIdsFromReport(r3.report)).toEqual(['t9', 't10', 't11', 't12'].sort());
});

test('shardingMode=round-robin balances groups across shards', async ({ runInlineTest }) => {
  const files = twelveTests();
  const r1 = await runShard(runInlineTest, files, 1, 3, ['sharding-mode=round-robin']);
  const r2 = await runShard(runInlineTest, files, 2, 3, ['sharding-mode=round-robin']);
  const r3 = await runShard(runInlineTest, files, 3, 3, ['sharding-mode=round-robin']);
  expect(r1.exitCode).toBe(0);
  expect(r2.exitCode).toBe(0);
  expect(r3.exitCode).toBe(0);
  const all = [...testIdsFromReport(r1.report), ...testIdsFromReport(r2.report), ...testIdsFromReport(r3.report)];
  // No test is lost or duplicated.
  expect(all.sort()).toEqual(['t1', 't10', 't11', 't12', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9'].sort());
  // Each shard non-empty (the three files have identical sizes; sort
  // tie-breaking still produces a deterministic split).
  expect(testIdsFromReport(r1.report).length).toBeGreaterThan(0);
  expect(testIdsFromReport(r2.report).length).toBeGreaterThan(0);
  expect(testIdsFromReport(r3.report).length).toBeGreaterThan(0);
});

test('shardingMode=duration-round-robin reads .last-run.json', async ({ runInlineTest }, testInfo) => {
  // First run writes baseline durations.
  const files = twelveTests();
  const r0 = await runInlineTest(files, { 'reporter': 'json' });
  expect(r0.exitCode).toBe(0);

  // The default `.last-run.json` lives in the first project's outputDir.
  const lastRunFile = path.join(testInfo.outputPath('test-results', 'p'), '.last-run.json');
  // Second run with duration-round-robin should at least not crash and
  // should still partition every test exactly once across shards.
  const r1 = await runShard(runInlineTest, files, 1, 3, ['sharding-mode=duration-round-robin', `last-failed-file=${lastRunFile}`]);
  const r2 = await runShard(runInlineTest, files, 2, 3, ['sharding-mode=duration-round-robin', `last-failed-file=${lastRunFile}`]);
  const r3 = await runShard(runInlineTest, files, 3, 3, ['sharding-mode=duration-round-robin', `last-failed-file=${lastRunFile}`]);
  expect(r1.exitCode).toBe(0);
  expect(r2.exitCode).toBe(0);
  expect(r3.exitCode).toBe(0);
  const all = [...testIdsFromReport(r1.report), ...testIdsFromReport(r2.report), ...testIdsFromReport(r3.report)];
  expect(all.sort()).toEqual(['t1', 't10', 't11', 't12', 't2', 't3', 't4', 't5', 't6', 't7', 't8', 't9'].sort());
});

test('shardingMode rejects unknown value', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'playwright.config.ts': `export default { shardingMode: 'bogus' };`,
    'a.test.ts': `import { test } from '@playwright/test'; test('x', () => {});`,
  });
  expect(result.exitCode).toBe(1);
  expect(result.output).toContain('config.shardingMode must be one of');
});
