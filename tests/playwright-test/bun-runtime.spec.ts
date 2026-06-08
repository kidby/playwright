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

import { test, expect } from './playwright-test-fixtures.js';

const bunRuntimeJs = require.resolve('../../packages/playwright/lib/transform/bunRuntime');
const { isBun } = require(bunRuntimeJs) as typeof import('../../packages/playwright/src/transform/bunRuntime.js');

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

function runUnderBun(script: string, env?: Record<string, string>) {
  return spawnSync(bunPath, ['-e', script], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  });
}

test('isBun() reports the current runtime accurately', () => {
  expect(isBun()).toBe(!!process.versions.bun);
});

itBun('isBun(): returns true when invoked from a spawned Bun process', () => {
  const r = runUnderBun(`
    const { isBun } = require('${bunRuntimeJs}');
    process.stdout.write(String(isBun()));
  `);
  expect(r.status).toBe(0);
  expect(r.stdout).toBe('true');
});

itBun('Bun runs `.ts` files natively without our type-stripping plugin', () => {
  // The bunRuntime plugin's onLoad type-stripper was removed (Bun handles
  // `import type` on its own threadpool). This sanity-check confirms the
  // native loader still strips type-only imports correctly end-to-end.
  const r = runUnderBun(`
    const path = require('node:path');
    const fs = require('node:fs');
    const os = require('node:os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bun-native-ts-'));
    const file = path.join(tmp, 'x.ts');
    fs.writeFileSync(file, "import type { A } from 'x';\\nexport const y: number = 1;\\nconsole.log(y);");
    import(file).then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
  `);
  expect(r.status).toBe(0);
  expect(r.stdout.replace(/\x1b\[\d+m/g, '').trim()).toBe('1');
});
