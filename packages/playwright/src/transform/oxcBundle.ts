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

// CJS-compat shims so user configs / spec files keep using `require`,
// `__dirname`, `__filename`. Kept on a single output line so oxc's source
// map (emitted for the unbanered input) still aligns with the actual output
// line numbers — a multi-line banner would shift every mapping by N and
// break stack traces, inspector source highlighting, and `__source`.
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

function isCommonJS(filename: string): boolean {
  return filename.endsWith('.cjs') || filename.endsWith('.cts');
}

export const oxcTransform: OxcTransformFunction = (code, filename, jsxImportSource) => {
  // CSS / SCSS / LESS imports are erased — they're irrelevant under Node and
  // their resolution would fail. Matches what `babelBundle.ts` did pre-oxc.
  const cleanedCode = code.replace(/^\s*import\s+(?:[^'"]*\s+from\s+)?['"][^'"]+\.(?:css|less|scss)['"]\s*;?\s*$/gm, '');

  // JSX is enabled by file extension only (`.jsx` / `.tsx`). A content-based
  // heuristic was tried but produced false positives on TS generic syntax
  // (`<T>(`) in plain `.ts` files.
  const lang: 'ts' | 'tsx' | 'js' | 'jsx' = isTypeScript(filename)
    ? (isJSX(filename) ? 'tsx' : 'ts')
    : (isJSX(filename) ? 'jsx' : 'js');

  const result = oxcTransformSync(filename, cleanedCode, {
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
    // Append `(line:col)` in babel's 0-indexed style so existing tooling
    // (stack-trace formatters, IDE bridges, the loader.spec.ts harness) can
    // continue to scrape the position from the message. oxc renders 1-indexed
    // `[file:line:col]` in its codeframe; subtract 1 from the column.
    let suffix = '';
    const m = err.codeframe?.match(/:(\d+):(\d+)\]/);
    if (m)
      suffix = ` (${m[1]}:${Number(m[2]) - 1})`;
    throw new Error(`${filename}: ${err.message}${suffix}${err.codeframe ? '\n' + err.codeframe : ''}`);
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
  //
  // CJS files (`.cjs` / `.cts`) skip the banner — they already have
  // `require` / `__dirname` / `__filename` as runtime globals from Node's
  // CommonJS wrapper, and the banner's `import { createRequire }` would be
  // illegal inside a CJS module anyway.
  const outCode = isCommonJS(filename) ? finalCode : (CJS_COMPAT_BANNER + finalCode);
  return {
    code: outCode,
    map: result.map as any,
  };
};
