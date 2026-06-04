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

// The install guard is now a `Symbol.for('playwright.bunRuntimeInstalled')` stamp on globalThis,
// so it's testable by stubbing the entire `Bun` global with a plain object whose `plugin` we can
// spy. This is how we catch double-registration that would otherwise survive multiple module copies
// loading in the same process (workspace symlinks, npm hoisting).

const INSTALL_KEY = Symbol.for('playwright.bunRuntimeInstalled');

type BunStub = {
  plugin: (p: { name: string; setup: (b: unknown) => void }) => void;
  pathToFileURL: (path: string) => URL;
  calls: string[];
};

function withFakeBun<T>(fn: (bun: BunStub) => T): T {
  const originalVersions = process.versions;
  const globals = globalThis as unknown as Record<symbol | string, unknown>;
  const originalBun = globals.Bun;
  const originalGuard = globals[INSTALL_KEY];
  Object.defineProperty(process, 'versions', {
    value: { ...originalVersions, bun: '1.0.0' },
    configurable: true,
  });
  const calls: string[] = [];
  const bun: BunStub = {
    plugin: p => { calls.push(p.name); },
    pathToFileURL: (p: string) => new URL('file://' + p),
    calls,
  };
  globals.Bun = bun;
  delete globals[INSTALL_KEY];
  try {
    return fn(bun);
  } finally {
    Object.defineProperty(process, 'versions', { value: originalVersions, configurable: true });
    if (originalBun === undefined)
      delete globals.Bun;
    else
      globals.Bun = originalBun;
    if (originalGuard === undefined)
      delete globals[INSTALL_KEY];
    else
      globals[INSTALL_KEY] = originalGuard;
  }
}

const { installBunRuntime } = require(bunRuntimeJs) as typeof import('../../packages/playwright/src/transform/bunRuntime.js');

test('installBunRuntime registers Bun.plugin exactly once across repeated calls', () => {
  withFakeBun(bun => {
    installBunRuntime();
    installBunRuntime();
    installBunRuntime();
    expect(bun.calls).toEqual(['playwright-bun-runtime']);
  });
});

test('clearing the Symbol.for guard allows a fresh registration', () => {
  withFakeBun(bun => {
    installBunRuntime();
    expect(bun.calls.length).toBe(1);
    const globals = globalThis as unknown as Record<symbol, unknown>;
    delete globals[INSTALL_KEY];
    installBunRuntime();
    expect(bun.calls.length).toBe(2);
  });
});

test('installBunRuntime is a no-op when isBun() reports false', () => {
  expect(() => installBunRuntime()).not.toThrow();
});
