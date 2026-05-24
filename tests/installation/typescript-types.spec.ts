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
import path from 'path';
import fs from 'fs';
import { test } from './npmTest.js';

test('typescript types should work', async ({ exec, tsc, writeFiles }) => {
  const libraryPackages = [
    'playwright',
    'playwright-core',
    'playwright-firefox',
    'playwright-webkit',
    'playwright-chromium',
  ];
  await exec('npm i @playwright/test', ...libraryPackages, { env: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' } });

  for (const libraryPackage of libraryPackages) {
    // Default `tsc` runs --module commonjs; --moduleResolution node10 doesn't
    // consult `exports`, so the legacy resolution finds `index.d.ts` and the
    // imports type-check fine. This is the path most existing consumers use.
    const tsFilename = libraryPackage + '.ts';
    await writeFiles({
      [tsFilename]: `import { Page } from '${libraryPackage}';`,
    });
    await tsc(tsFilename);

    // ESM-only fork: `tsc --module nodenext` consults `exports` and rejects
    // CJS-context static imports of ESM-only packages (TS1479). The supported
    // migration is to use ESM-context files — either `.mts` or a workspace
    // with `"type": "module"`. We exercise the `.mts` path here.
    const mtsFilename = libraryPackage + '.mts';
    await writeFiles({
      [mtsFilename]: `import { Page } from '${libraryPackage}';`,
    });
    await tsc(`--module nodenext ${mtsFilename}`);
  }

  await tsc('playwright-test-types.ts');
  // Mirror the fixture into a `.mts` so `--module nodenext` resolves it under
  // ESM-context rules (matches the supported migration path for users).
  const ptTypesSource = await fs.promises.readFile(path.join(__dirname, 'fixture-scripts', 'playwright-test-types.ts'), 'utf-8');
  await writeFiles({ 'playwright-test-types.mts': ptTypesSource });
  await tsc('--module nodenext playwright-test-types.mts');

  await writeFiles({
    'test.ts':
      `import { AndroidDevice, _android, AndroidWebView, Page } from 'playwright';`,
  });
  await tsc('test.ts');
});
