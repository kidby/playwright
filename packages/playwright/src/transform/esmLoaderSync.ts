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

import fs from 'fs';
import url from 'url';

import { currentFileDepsCollector } from './compilationCache.js';
import { resolveHook, shouldTransform, transformHook } from './transform.js';

export function resolve(specifier: string, context: { parentURL?: string, conditions?: string[] }, nextResolve: Function) {
  if (context.parentURL && context.parentURL.startsWith('file://')) {
    const filename = url.fileURLToPath(context.parentURL);
    const resolved = resolveHook(filename, specifier);
    if (resolved !== undefined) {
      // These hooks serve both require() and import. The two default resolvers disagree on
      // what an already-resolved specifier should look like:
      // - require()'s resolver wants an absolute path and rejects file:// specifiers;
      // - the ESM resolver wants a file:// URL and, on Windows, mistakes an absolute path's
      //   drive letter for a URL scheme ("Received protocol 'c:'").
      // The `import` condition is present only for ESM resolution, so use it to pick the form.
      specifier = context.conditions?.includes('import') ? url.pathToFileURL(resolved).toString() : resolved;
    }
  }
  const result = nextResolve(specifier, context);
  if (result?.url && result.url.startsWith('file://'))
    currentFileDepsCollector()?.add(url.fileURLToPath(result.url));
  return result;
}

function isTypeScriptLike(filename: string): boolean {
  return filename.endsWith('.ts') || filename.endsWith('.tsx')
    || filename.endsWith('.mts') || filename.endsWith('.cts')
    || filename.endsWith('.jsx');
}

// Fork is ESM-only: any unknown / 'typescript' format defaults to 'module'.
const kSupportedFormats = new Map<string | null | undefined, string | null | undefined>([
  ['commonjs', 'commonjs'],
  ['module', 'module'],
  ['commonjs-typescript', 'commonjs'],
  ['module-typescript', 'module'],
  ['typescript', null],
  [null, null],
  [undefined, undefined],
]);

export function load(moduleUrl: string, context: { format?: string }, nextLoad: Function) {
  // Bail out for wasm, json, etc.
  if (!kSupportedFormats.has(context.format))
    return nextLoad(moduleUrl, context);

  // Bail for built-in modules.
  if (!moduleUrl.startsWith('file://'))
    return nextLoad(moduleUrl, context);

  const filename = url.fileURLToPath(moduleUrl);

  // Bail for node_modules.
  if (!shouldTransform(filename))
    return nextLoad(moduleUrl, context);

  // Vendored CJS modules (e.g. test assets with `module.exports`) must NOT
  // be force-loaded as ESM. Defer to Node's default loader so it honors the
  // nearest package.json. This mirrors the guard in esmLoader.ts.
  if (filename.endsWith('.js') && context.format === 'commonjs')
    return nextLoad(moduleUrl, context);

  // Output format is required, so we determine it manually when unknown.
  // Default ambiguous .js (null/undefined format) to 'commonjs' — only files
  // with an explicit 'module' format or TypeScript extensions get ESM treatment.
  const mapped = kSupportedFormats.get(context.format);
  const format: 'commonjs' | 'module' = mapped === 'commonjs' ? 'commonjs'
    : mapped === 'module' ? 'module'
    : (filename.endsWith('.mjs') || filename.endsWith('.mts')) ? 'module'
    : (filename.endsWith('.cjs') || filename.endsWith('.cts')) ? 'commonjs'
    : isTypeScriptLike(filename) ? 'module'
    : 'commonjs';

  const code = fs.readFileSync(filename, 'utf-8');
  // Pass `moduleUrl` only for ESM. For CommonJS the transformer routes through
  // esbuild (ESM→CJS module conversion) using the explicit format hint.
  const transformed = transformHook(code, filename, format === 'module' ? moduleUrl : undefined, format);

  // shortCircuit is required to designate no more loaders should be called.
  return {
    format,
    source: transformed.code,
    shortCircuit: true,
  };
}
