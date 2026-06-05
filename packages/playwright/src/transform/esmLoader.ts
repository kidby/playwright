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
import path from 'path';
import url from 'url';

import { addToCompilationCache, currentFileDepsCollector, serializeCompilationCache, startCollectingFileDeps, stopCollectingFileDeps } from './compilationCache.js';
import { PortTransport } from './portTransport.js';
import { resolveHook, setSingleTSConfig, setTransformConfig, shouldTransform, transformHook } from './transform.js';
import { resolve as resolveSync, load as loadSync } from './esmLoaderSync.js';

// Before each import of the ESM module, a preflight request with the .esm.preflight extension is issued.
// When handled, it is resolved similarly to the regular import, but loading it yields empty content.
const esmPreflightExtension = '.esm.preflight';

async function resolve(originalSpecifier: string, context: { parentURL?: string }, defaultResolve: Function) {
  let specifier = originalSpecifier.replace(esmPreflightExtension, '');
  if (context.parentURL && context.parentURL.startsWith('file://')) {
    const filename = url.fileURLToPath(context.parentURL);
    const resolved = resolveHook(filename, specifier);
    if (resolved !== undefined)
      specifier = url.pathToFileURL(resolved).toString();
  }
  let result;
  try {
    result = await defaultResolve(specifier, context, defaultResolve);
  } catch (err: any) {
    // Rewrite the not-found path in the error back to the original spec the
    // user wrote. Node ESM's default message embeds an absolute file:// path
    // (either because we resolved relative→absolute in resolveHook, or
    // because Node's own default resolver converts the relative spec to an
    // absolute file URL internally before reporting). Tests and user
    // diagnostics want to see the spec from the source file.
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && typeof err.message === 'string' && context.parentURL?.startsWith('file://')) {
      const userSpec = originalSpecifier.replace(esmPreflightExtension, '');
      // Replace either form: the absolute file:// URL we passed in, or the
      // absolute path Node derived from `parentURL + userSpec`.
      err.message = err.message.split(specifier).join(userSpec);
      if (userSpec.startsWith('./') || userSpec.startsWith('../')) {
        const parentDir = url.fileURLToPath(context.parentURL).replace(/\/[^/]*$/, '');
        const absFromUser = path.resolve(parentDir, userSpec);
        err.message = err.message.split(absFromUser).join(userSpec);
      }
    }
    throw err;
  }
  // Note: we collect dependencies here that will be sent to the main thread
  // (and optionally runner process) after the loading finishes.
  if (result?.url && result.url.startsWith('file://'))
    currentFileDepsCollector()?.add(url.fileURLToPath(result.url));

  // JSON imports under Node 22+ require an explicit `with { type: 'json' }`
  // attribute. Inject it transparently for `.json` URLs so existing
  // `import x from './foo.json'` statements keep working — the load hook
  // below then synthesizes named exports for the top-level keys.
  if (result?.url?.endsWith('.json'))
    result.importAttributes = { ...(result.importAttributes ?? {}), type: 'json' };

  if (originalSpecifier.endsWith(esmPreflightExtension))
    result.url = result.url + esmPreflightExtension;
  return result;
}

// Formats we transform: TS variants + JS (CJS or ESM). Anything else (wasm,
// json, builtin) goes straight to Node's default loader.
const kSupportedFormats = new Set([
  'commonjs',
  'module',
  'commonjs-typescript',
  'module-typescript',
  null,
  undefined,
]);

async function load(moduleUrl: string, context: { format?: string }, defaultLoad: Function) {
  // JSON: synthesize an ESM wrapper that exposes a `default` export plus a
  // named export for every top-level key. Lets `import { key } from
  // './foo.json'` work — Node's native JSON loader only exposes `default`.
  if (context.format === 'json' && moduleUrl.startsWith('file://')) {
    const filename = url.fileURLToPath(moduleUrl);
    try {
      const raw = fs.readFileSync(filename, 'utf-8');
      const parsed = JSON.parse(raw);
      return { format: 'module', source: synthesizeJsonModule(parsed), shortCircuit: true };
    } catch {
      // Fall through to default loader if read/parse fails — Node's own
      // error message is better for genuinely malformed JSON.
    }
  }

  // Bail out for wasm, etc.
  if (!kSupportedFormats.has(context.format as any))
    return defaultLoad(moduleUrl, context, defaultLoad);

  // Bail for built-in modules.
  if (!moduleUrl.startsWith('file://'))
    return defaultLoad(moduleUrl, context, defaultLoad);

  const filename = url.fileURLToPath(moduleUrl);
  const isPreflight = moduleUrl.endsWith(esmPreflightExtension);

  // Bail for node_modules.
  if (!shouldTransform(filename))
    return defaultLoad(moduleUrl, context, defaultLoad);

  // Vendored CJS modules (e.g. third_party/yauzl with a local
  // `package.json: {"type":"commonjs"}`) must NOT be force-loaded as ESM.
  // Defer to Node's default loader so it honors the nearest package.json.
  if (filename.endsWith('.js') && context.format === 'commonjs')
    return defaultLoad(moduleUrl, context, defaultLoad);

  const originalModuleUrl = isPreflight ? moduleUrl.slice(0, -esmPreflightExtension.length) : moduleUrl;
  const originalFilename = isPreflight ? url.fileURLToPath(originalModuleUrl) : filename;

  // `.cts` / `.cjs` files are always CommonJS, and `.mts` / `.mjs` are always
  // ESM. For ambiguous `.ts` / `.tsx` / `.js` / `.jsx`, fall back to whatever
  // Node detected from the nearest package.json (`commonjs-typescript` /
  // `commonjs` → CJS, else ESM). The transformer routes CJS through esbuild
  // (ESM→CJS module conversion) and ESM through oxc (TS-strip + JSX). The
  // oxcBundle banner is skipped for `.cts`/`.cjs` so emitted code is legal CJS.
  let format: 'commonjs' | 'module' = 'module';
  if (originalFilename.endsWith('.cjs') || originalFilename.endsWith('.cts'))
    format = 'commonjs';
  else if (originalFilename.endsWith('.mjs') || originalFilename.endsWith('.mts'))
    format = 'module';
  else if (context.format === 'commonjs' || context.format === 'commonjs-typescript')
    format = 'commonjs';

  const code = fs.readFileSync(originalFilename, 'utf-8');
  const transformed = transformHook(code, originalFilename, originalModuleUrl, format);

  // Flush the source maps to the main thread, so that errors after import() are source-mapped.
  if (transformed.serializedCache)
    transport?.post('pushToCompilationCache', { cache: transformed.serializedCache });

  return {
    format,
    source: isPreflight ? (format === 'commonjs' ? '' : 'void 0;') : transformed.code,
    shortCircuit: true,
  };
}

// Reserved words and other identifiers we shouldn't emit as `export const X`.
const kReservedIdentifiers = new Set([
  'default', 'true', 'false', 'null', 'undefined',
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'do', 'else', 'export', 'extends', 'finally', 'for', 'function',
  'if', 'import', 'in', 'instanceof', 'let', 'new', 'return', 'super',
  'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while',
  'with', 'yield', 'await', 'enum', 'implements', 'interface', 'package',
  'private', 'protected', 'public', 'static',
]);

function synthesizeJsonModule(parsed: unknown): string {
  const payload = JSON.stringify(parsed);
  let source = `const _data = ${payload};\nexport default _data;\n`;
  // Only top-level objects can carry named exports; arrays / primitives just
  // get the default export.
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (const key of Object.keys(parsed as Record<string, unknown>)) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) || kReservedIdentifiers.has(key))
        continue;
      source += `export const ${key} = _data[${JSON.stringify(key)}];\n`;
    }
  }
  return source;
}

let transport: PortTransport | undefined;

function initialize(data: { port: MessagePort }) {
  transport = createTransport(data?.port);
}

function createTransport(port: MessagePort) {
  return new PortTransport(port, async (method, params) => {
    if (method === 'setSingleTSConfig') {
      await setSingleTSConfig(params.tsconfig);
      return;
    }

    if (method === 'setTransformConfig') {
      await setTransformConfig(params.config);
      return;
    }

    if (method === 'addToCompilationCache') {
      addToCompilationCache(params.cache);
      return;
    }

    if (method === 'getCompilationCache')
      return { cache: serializeCompilationCache() };

    if (method === 'startCollectingFileDeps') {
      startCollectingFileDeps();
      return;
    }

    if (method === 'stopCollectingFileDeps') {
      stopCollectingFileDeps(params.file);
      return;
    }
  });
}


export { initialize, load, resolve, resolveSync, loadSync };
