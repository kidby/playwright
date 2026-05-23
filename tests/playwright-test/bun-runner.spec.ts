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

import { execFileSync, spawnSync } from 'child_process';
import path from 'path';

import { test, expect } from './playwright-test-fixtures.js';

const bunPath = (() => {
  if (process.env.BUN === '0')
    return '';
  try {
    return execFileSync('which', ['bun'], { encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
})();

const itBun = bunPath ? test : test.skip;
const bunRuntimeJs = path.join(__dirname, '..', '..', 'packages', 'playwright', 'lib', 'transform', 'bunRuntime');

// Scope note: the in-workspace runner cannot be fully exercised under Bun
// because Bun's workspace-aware resolver routes `playwright-core/lib/bootstrap`
// to the .ts source instead of honoring the package.json `exports` entry
// `./lib/bootstrap.js`, and `bootstrap.ts` is an async-module that can't be
// `require()`-d. That regression doesn't surface for non-workspace consumers.
// The full runner-under-Bun proof lives in the one-automation integration
// scenario where the fork is consumed as a normal package, not a workspace
// member. This spec covers only what's testable in-tree.

itBun('bunRuntime loads under Bun without throwing', () => {
  const result = spawnSync(bunPath, ['-e', `
    require(${JSON.stringify(bunRuntimeJs)});
    process.stdout.write('ok');
  `], { encoding: 'utf-8' });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('ok');
});
