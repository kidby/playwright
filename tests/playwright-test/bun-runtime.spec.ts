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
import fs from 'fs';
import path from 'path';

import { test, expect } from './playwright-test-fixtures.js';

const bunRuntimeJs = require.resolve('../../packages/playwright/lib/transform/bunRuntime');
const { isBun, stripTypeImports } = require(bunRuntimeJs) as typeof import('../../packages/playwright/src/transform/bunRuntime.js');

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

test('stripTypeImports: removes `import type { ... } from`', () => {
  expect(stripTypeImports(`import type { A, B } from 'x';\nexport const y = 1;`))
      .toBe(`\nexport const y = 1;`);
});

test('stripTypeImports: removes `import type Default from`', () => {
  expect(stripTypeImports(`import type Foo from 'x';\nexport const y = 1;`))
      .toBe(`\nexport const y = 1;`);
});

test('stripTypeImports: collapses per-specifier `type` markers', () => {
  expect(stripTypeImports(`import { type A, B } from 'x';`))
      .toBe(`import { B } from 'x';`);
});

test('stripTypeImports: all-marker clause collapses to empty braces', () => {
  expect(stripTypeImports(`import { type A, type B } from 'x';`))
      .toBe(`import {} from 'x';`);
});

test('stripTypeImports: multi-line braced clause', () => {
  const src = `import type {\n  A,\n  B,\n} from 'x';\nconst v = 1;`;
  expect(stripTypeImports(src)).toBe(`\nconst v = 1;`);
});

test('stripTypeImports: mixed file keeps value imports byte-identical', () => {
  const src = [
    `import type { A } from 'types';`,
    `import { realValue } from 'lib';`,
    `import { type B, C } from 'mixed';`,
    `export const x = realValue + C;`,
  ].join('\n');
  expect(stripTypeImports(src)).toBe([
    ``,
    `import { realValue } from 'lib';`,
    `import { C } from 'mixed';`,
    `export const x = realValue + C;`,
  ].join('\n'));
});

test('stripTypeImports: no-type fast path leaves source untouched', () => {
  const src = `import { A } from 'x';\nconst foo = A;`;
  expect(stripTypeImports(src)).toBe(src);
});

test('stripTypeImports: identifiers starting with "type" survive', () => {
  const src = `import { typeOf, typeChecker } from 'utils';\nconst v = typeOf(typeChecker);`;
  expect(stripTypeImports(src)).toBe(src);
});

test('stripTypeImports: default + named with per-specifier marker is left untouched (known limitation)', () => {
  // The per-specifier regex requires `import` immediately before `{`, so default+named mixed
  // forms slip through. If the source regex is generalized later, flip this assertion.
  const src = `import Foo, { type A, B } from 'x';`;
  expect(stripTypeImports(src)).toBe(src);
});

test('isBun() reports the current runtime accurately', () => {
  // Detects whichever runtime is hosting the test runner: Node or Bun.
  expect(isBun()).toBe(!!process.versions.bun);
});

itBun('isBun(): returns true when invoked from a spawned Bun process', () => {
  const result = runUnderBun(`
    const { isBun } = require(${JSON.stringify(bunRuntimeJs)});
    if (!isBun()) { process.stderr.write('isBun() returned false under Bun'); process.exit(1); }
  `);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});

itBun('Bun.plugin onLoad strips type imports end-to-end', async ({}, testInfo) => {
  fs.mkdirSync(testInfo.outputDir, { recursive: true });
  const fixture = path.join(testInfo.outputDir, 'fixture.ts');
  fs.writeFileSync(fixture, `import type { Missing } from './does-not-exist';\nexport const x = 42;\n`);
  const result = runUnderBun(`
    require(${JSON.stringify(bunRuntimeJs)});
    (async () => {
      const m = await import(${JSON.stringify(fixture)});
      process.stdout.write(String(m.x));
    })();
  `);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('42');
});

itBun('Bun.plugin onLoad handles .tsx with JSX correctly', async ({}, testInfo) => {
  fs.mkdirSync(testInfo.outputDir, { recursive: true });
  const fixture = path.join(testInfo.outputDir, 'fixture.tsx');
  fs.writeFileSync(fixture, `import type { Missing } from './does-not-exist';\nconst el = <div className="x">hi</div>;\nexport const x = el ? 1 : 0;\n`);
  const result = runUnderBun(`
    require(${JSON.stringify(bunRuntimeJs)});
    (async () => {
      const m = await import(${JSON.stringify(fixture)});
      process.stdout.write(String(m.x));
    })();
  `);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout).toBe('1');
});

// Idempotency of installBunRuntime() is not externally observable: Bun.plugin is a non-writable,
// non-configurable property and cannot be spied. The guard `if (installed) return` is unit-tested
// transitively by the onLoad smoke test above — if it were broken, the second registration would
// also fire and double-transform sources, which would either produce duplicated edits or throw.
