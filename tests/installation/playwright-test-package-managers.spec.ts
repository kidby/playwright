/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { test, expect } from './npmTest.js';
import fs from 'fs';
import path from 'path';

test('npm: @playwright/test should work', async ({ exec, tmpWorkspace }) => {
  await exec('npm i @playwright/test');
  await exec('npx playwright install');
  await exec('npx playwright test -c . --browser=all --reporter=list,json sample.spec.js', { env: {  PLAYWRIGHT_JSON_OUTPUT_NAME: 'report.json' } });
  await exec('node read-json-report.js', path.join(tmpWorkspace, 'report.json'));
  await exec('node sanity.js @playwright/test chromium firefox webkit');
  await exec('node', 'esm-playwright-test.mjs');
});

test('npm: playwright + @playwright/test should work', async ({ exec, tmpWorkspace }) => {
  await exec('npm i playwright');
  await exec('npm i @playwright/test');
  await exec('npx playwright install');
  await exec('npx playwright test -c . --browser=all --reporter=list,json sample.spec.js', { env: {  PLAYWRIGHT_JSON_OUTPUT_NAME: 'report.json' } });
  await exec('node read-json-report.js', path.join(tmpWorkspace, 'report.json'));
  await exec('node sanity.js @playwright/test chromium firefox webkit');
  await exec('node', 'esm-playwright-test.mjs');
});

test('npm: @playwright/test + playwright-core should work', async ({ exec, tmpWorkspace }) => {
  await exec('npm i @playwright/test');
  await exec('npm i playwright-core');
  await exec('npx playwright install');
  await exec('npx playwright test -c . --browser=all --reporter=list,json sample.spec.js', { env: {  PLAYWRIGHT_JSON_OUTPUT_NAME: 'report.json' } });
  await exec('node read-json-report.js', path.join(tmpWorkspace, 'report.json'));
  await exec('node sanity.js @playwright/test chromium firefox webkit');
  await exec('node', 'esm-playwright-test.mjs');
});

test('npm: @playwright/test should install playwright-core bin', async ({ exec, tmpWorkspace }) => {
  await exec('npm i @playwright/test');
  const result = await exec('npx playwright-core --version');
  expect(result).toContain('Version 1.');
});

test('npm: uninstalling ct removes playwright bin', async ({ exec, tmpWorkspace }) => {
  await exec('npm i @playwright/test');
  await exec('npm i @playwright/experimental-ct-react');
  await exec('npm uninstall @playwright/experimental-ct-react');
  await exec('npx playwright test', { expectToExitWithError: true, message: 'command not found' });
});

test('yarn: @playwright/test should work', async ({ exec, tmpWorkspace }) => {
  await exec('yarn add @playwright/test');
  await exec('yarn playwright install');
  await exec('yarn playwright test -c . --browser=all --reporter=list,json sample.spec.js', { env: {  PLAYWRIGHT_JSON_OUTPUT_NAME: 'report.json' } });
  await exec('node read-json-report.js', path.join(tmpWorkspace, 'report.json'));
  await exec('node sanity.js @playwright/test chromium firefox webkit');
  await exec('node', 'esm-playwright-test.mjs');
});

test('pnpm: @playwright/test should work', async ({ exec, tmpWorkspace }) => {
  await exec('pnpm add @playwright/test');
  await exec('pnpm exec playwright install');
  await exec('pnpm exec playwright test -c . --browser=all --reporter=list,json sample.spec.js', { env: {  PLAYWRIGHT_JSON_OUTPUT_NAME: 'report.json' } });
  await exec('node read-json-report.js', path.join(tmpWorkspace, 'report.json'));
  await exec('node sanity.js @playwright/test chromium firefox webkit');
  await exec('node', 'esm-playwright-test.mjs');
});

test('bun: @playwright/test should work', async ({ exec, tmpWorkspace }) => {
  // Bun-as-package-manager: `bun add` installs via Bun's resolver, then
  // `bunx playwright` runs the binary. The shebang (`#!/usr/bin/env node`)
  // routes execution through Node, which is the supported runtime path.
  await exec('bun add @playwright/test');
  await exec('bunx playwright install');
  await exec('bunx playwright test -c . --browser=all --reporter=list,json sample.spec.js', { env: { PLAYWRIGHT_JSON_OUTPUT_NAME: 'report.json' } });
  await exec('node read-json-report.js', path.join(tmpWorkspace, 'report.json'));
  await exec('node sanity.js @playwright/test chromium firefox webkit');
  await exec('node', 'esm-playwright-test.mjs');
});

test('bun-runtime: @playwright/test should work', async ({ exec, tmpWorkspace, writeFiles }) => {
  // Bun-as-runtime: install via Bun, then run the CLI directly under Bun
  // (bypassing the `#!/usr/bin/env node` shebang). The bunPreload script
  // registered via bunfig.toml strips dangling `import type {...}`
  // statements and runs the TS transform before any user module loads.
  await exec('bun add @playwright/test');
  await exec('bunx playwright install');

  // Layer the preload onto the bunfig.toml that npmTest.ts already wrote.
  const existingBunfig = await fs.promises.readFile(path.join(tmpWorkspace, 'bunfig.toml'), 'utf-8');
  await writeFiles({
    'bunfig.toml': existingBunfig + '\npreload = ["./node_modules/playwright/lib/transform/bunPreload.js"]\n',
  });

  await exec('bun node_modules/playwright/cli.js test -c . --browser=chromium --reporter=list,json sample.spec.js', { env: { PLAYWRIGHT_JSON_OUTPUT_NAME: 'bun-runtime-report.json' } });
  await exec('node read-json-report.js', path.join(tmpWorkspace, 'bun-runtime-report.json'), '--validate-chromium-project-only');
});
