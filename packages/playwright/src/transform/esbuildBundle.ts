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

import { transformSync as esbuildTransformSync } from 'esbuild';

// CJS-compat path for user files classified as CommonJS (by extension or by
// nearest `package.json: {"type":"commonjs"}`). oxc-transform doesn't yet
// support ESM→CJS module conversion (tracked at oxc-project/oxc#4050), so we
// route this slim compatibility layer through esbuild — already a top-level
// dep, native (Go), and `transformSync` does TS-strip + JSX + ESM→CJS in one
// pass. No banner is prepended: esbuild's `format: 'cjs'` output already has
// `require` / `__dirname` / `__filename` as CJS-runtime globals.

export type EsbuildTransformResult = { code: string; map?: { version: number; sources: string[]; mappings: string; names: string[] } } | null;
export type EsbuildTransformFunction = (code: string, filename: string, jsxImportSource?: string) => EsbuildTransformResult;

function isTypeScript(filename: string): boolean {
  return filename.endsWith('.ts') || filename.endsWith('.tsx') || filename.endsWith('.mts') || filename.endsWith('.cts');
}

function isJSX(filename: string): boolean {
  return filename.endsWith('.tsx') || filename.endsWith('.jsx');
}

export const esbuildCjsTransform: EsbuildTransformFunction = (code, filename, jsxImportSource) => {
  // Match the CSS/SCSS/LESS import stripping done in oxcBundle so the two
  // transformers behave identically for the bits that aren't module-format
  // specific. esbuild would otherwise try to resolve those imports at
  // transform time and fail.
  const cleanedCode = code.replace(/^\s*import\s+(?:[^'"]*\s+from\s+)?['"][^'"]+\.(?:css|less|scss)['"]\s*;?\s*$/gm, '');

  const loader: 'ts' | 'tsx' | 'js' | 'jsx' = isTypeScript(filename)
    ? (isJSX(filename) ? 'tsx' : 'ts')
    : (isJSX(filename) ? 'jsx' : 'js');

  const result = esbuildTransformSync(cleanedCode, {
    loader,
    format: 'cjs',
    target: 'esnext',
    sourcefile: filename,
    sourcemap: 'external',
    sourcesContent: false,
    platform: 'node',
    ...(jsxImportSource ? { jsx: 'automatic', jsxImportSource } : {}),
  });

  let map: any;
  try {
    map = result.map ? JSON.parse(result.map) : undefined;
  } catch {
    map = undefined;
  }

  return {
    code: result.code,
    map,
  };
};
