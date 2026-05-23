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

import * as babel from '@babel/core';
import { transformSync as oxcTransformSync } from 'oxc-transform';

// CJS-compat shims injected at the top of every transformed module so user
// configs / spec files that still use `require`, `__dirname`, `__filename`
// continue to work under our ESM-only runtime. Cheap to inject; ignored if
// unused.
//
// IMPORTANT: kept on a single output line so the source map (which oxc emits
// for the unbanered input) still aligns with the actual output line numbers.
// A multi-line banner would shift every mapping by N and break stack traces,
// inspector source highlighting, and `__source` JSX locations.
const CJS_COMPAT_BANNER =
  `import { createRequire as __pwCreateRequire } from 'module';` +
  `import { dirname as __pwDirname } from 'path';` +
  `import { fileURLToPath as __pwFileURLToPath } from 'url';` +
  `const require = __pwCreateRequire(import.meta.url);` +
  `const __filename = __pwFileURLToPath(import.meta.url);` +
  `const __dirname = __pwDirname(__filename);`;

export type OxcTransformResult = { code: string; map?: { version: number; sources: string[]; mappings: string; names: string[] } } | null;

export type OxcTransformFunction = (code: string, filename: string, jsxImportSource?: string) => OxcTransformResult;

function isTypeScript(filename: string): boolean {
  return filename.endsWith('.ts') || filename.endsWith('.tsx') || filename.endsWith('.mts') || filename.endsWith('.cts');
}

function isJSX(filename: string): boolean {
  return filename.endsWith('.tsx') || filename.endsWith('.jsx');
}

export const oxcTransform: OxcTransformFunction = (code, filename, jsxImportSource) => {
  const lang: 'ts' | 'tsx' | 'js' | 'jsx' = isTypeScript(filename)
    ? (isJSX(filename) ? 'tsx' : 'ts')
    : (isJSX(filename) ? 'jsx' : 'js');

  const result = oxcTransformSync(filename, code, {
    lang,
    sourceType: 'module',
    sourcemap: true,
    typescript: {
      onlyRemoveTypeImports: false,
      allowNamespaces: true,
    },
    jsx: {
      runtime: 'automatic',
      throwIfNamespace: false,
      ...(jsxImportSource ? { importSource: jsxImportSource } : {}),
    },
  });

  if (result.errors && result.errors.length) {
    const err = result.errors[0];
    throw new Error(`${filename}: ${err.message}${err.codeframe ? '\n' + err.codeframe : ''}`);
  }

  let finalCode = result.code;

  // oxc-transform doesn't yet transform TC39 stage-3 decorators (e.g. `@step`)
  // — it preserves them as-is. Node 25 can't execute them natively, so we run a
  // focused Babel pass with only the decorator plugin when the output still has
  // `@` decorators in it. Cheap precondition check skips the babel cost for
  // files that don't use decorators.
  if (/^\s*@\w[\w.]*/m.test(finalCode)) {
    const babelResult = babel.transformSync(finalCode, {
      filename,
      babelrc: false,
      configFile: false,
      browserslistConfigFile: false,
      sourceMaps: false,
      compact: false,
      plugins: [
        [require('@babel/plugin-proposal-decorators'), { version: '2023-05' }],
      ],
    });
    if (babelResult?.code)
      finalCode = babelResult.code;
  }

  // Banner goes on a SHARED first line (no `\n`); oxc's mapping for input line
  // 1 already targets output line 1, so prepending text to that line preserves
  // line numbers in the source map. Subsequent lines line up unchanged.
  return {
    code: CJS_COMPAT_BANNER + finalCode,
    map: result.map as any,
  };
};
