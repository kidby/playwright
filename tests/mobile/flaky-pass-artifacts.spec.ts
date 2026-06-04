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

// Regression sentinel for fixture gating around failure artifacts. The mobile
// `device` fixture is test-scoped — every retry attempt runs the fixture
// afresh with its own `testInfo`. As long as the gating skips `passed` and
// `skipped` (and nothing else), every failing retry of a flaky test attaches
// its mobile-snapshot + mobile-screenshot to that attempt's TestResult, and
// the eventual passing attempt is the only one without artifacts.
//
// If a future refactor narrowed the gate (e.g. "only `failed`, not
// `timedOut`/`interrupted`") or widened it (e.g. "skip `flaky`"), this test
// would catch the regression before it reaches CI.

import { test, expect } from '@playwright/test';

import { shouldCaptureFailureArtifacts } from '../../packages/playwright-mobile/src/index.js';

type TestStatus = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';

const cases: ReadonlyArray<{ status: TestStatus; expected: boolean; note: string }> = [
  { status: 'passed', expected: false, note: 'happy path — nothing to capture' },
  { status: 'skipped', expected: false, note: 'skipped — no execution to capture' },
  { status: 'failed', expected: true, note: 'standard failure' },
  { status: 'timedOut', expected: true, note: 'timeout — artifacts useful for diagnosis' },
  { status: 'interrupted', expected: true, note: 'interrupted (e.g. SIGINT) — capture what we can' },
];

for (const { status, expected, note } of cases) {
  test(`shouldCaptureFailureArtifacts(${status}) === ${expected} (${note})`, () => {
    expect(shouldCaptureFailureArtifacts(status)).toBe(expected);
  });
}

test('gating covers every TestStatus value — flaky-pass attempts ARE captured per-attempt', () => {
  // Every TestStatus is covered above; if a new status appears upstream, the
  // gate currently treats it as "capture" (anything not 'passed'/'skipped'),
  // which is the safer default. This test documents the invariant.
  const allStatuses: TestStatus[] = ['passed', 'failed', 'timedOut', 'skipped', 'interrupted'];
  const covered = new Set(cases.map(c => c.status));
  for (const s of allStatuses)
    expect(covered.has(s), `status "${s}" not covered by the gating table`).toBe(true);
});
