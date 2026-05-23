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

test('passes inside range (inclusive), fails outside, rejects non-finite', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('passes', () => {
        expect(150).toBeWithinRange(100, 200);
        expect(100).toBeWithinRange(100, 200);
        expect(200).toBeWithinRange(100, 200);
      });
      test('fails-below', () => {
        expect(50).toBeWithinRange(100, 200);
      });
      test('fails-above', () => {
        expect(300).toBeWithinRange(100, 200);
      });
      test('fails-not-finite', () => {
        expect(Number.NaN).toBeWithinRange(100, 200);
      });
    `,
  });
  expect(result.exitCode).toBe(1);
  expect(result.passed).toBe(1);
  expect(result.failed).toBe(3);
});
