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
import Module from 'module';
import path from 'path';
import url from 'url';
import crypto from 'crypto';
import sourceMapSupport from 'source-map-support';
import { loadTsConfig } from './tsconfig-loader.js';
import { libPath, packageJSON } from '../package.js';
import { createFileMatcher, debugTest, resolveImportSpecifierAfterMapping } from '../util.js';
import { importUnderBun, isBun } from './bunRuntime.js';
import { addToCompilationCache, belongsToNodeModules, currentFileDepsCollector, getFromCompilationCache, installSourceMapSupport, serializeCompilationCache, startCollectingFileDeps as ccStartCollectingFileDeps, stopCollectingFileDeps as ccStopCollectingFileDeps } from './compilationCache.js';
import * as esmLoaderSync from './esmLoaderSync.js';
import { PortTransport } from './portTransport.js';

import type { BabelPlugin, BabelTransformFunction } from './babelBundle.js';
import type { EsbuildTransformFunction } from './esbuildBundle.js';
import type { OxcTransformFunction } from './oxcBundle.js';
import type { Location } from '../../types/testReporter';
import type { LoadedTsConfig } from './tsconfig-loader.js';
import type { Matcher } from '../util.js';


const version = packageJSON.version;

type ParsedTsConfigData = {
  pathsBase?: string;
  paths: { key: string, values: string[] }[];
  allowJs: boolean;
};
const cachedTSConfigs = new Map<string, ParsedTsConfigData[]>();

export type TransformConfig = {
  babelPlugins: [string, any?][];
  external: string[];
  jsxImportSource?: string;
};

let _transformConfig: TransformConfig = {
  babelPlugins: [],
  external: [],
};

let _externalMatcher: Matcher = () => false;

export async function setTransformConfig(config: TransformConfig) {
  _transformConfig = config;
  _externalMatcher = createFileMatcher(_transformConfig.external);
  if (loaderChannel)
    await loaderChannel.send('setTransformConfig', { config });
}

export function transformConfig(): TransformConfig {
  return _transformConfig;
}

let _singleTSConfigPath: string | undefined;
let _singleTSConfig: ParsedTsConfigData[] | undefined;

export async function setSingleTSConfig(value: string | undefined) {
  _singleTSConfigPath = value;
  if (loaderChannel)
    await loaderChannel.send('setSingleTSConfig', { tsconfig: value });
}

export function singleTSConfig(): string | undefined {
  return _singleTSConfigPath;
}

function validateTsConfig(tsconfig: LoadedTsConfig): ParsedTsConfigData {
  // When no explicit baseUrl is set, resolve paths relative to the tsconfig file.
  // See https://www.typescriptlang.org/tsconfig#paths
  const pathsBase = tsconfig.absoluteBaseUrl ?? tsconfig.paths?.pathsBasePath;
  // Only add the catch-all mapping when baseUrl is specified
  const pathsFallback = tsconfig.absoluteBaseUrl ? [{ key: '*', values: ['*'] }] : [];
  return {
    allowJs: !!tsconfig.allowJs,
    pathsBase,
    paths: Object.entries(tsconfig.paths?.mapping || {}).map(([key, values]) => ({ key, values })).concat(pathsFallback)
  };
}

function loadAndValidateTsconfigsForFile(file: string): ParsedTsConfigData[] {
  if (_singleTSConfigPath && !_singleTSConfig)
    _singleTSConfig = loadTsConfig(_singleTSConfigPath).map(validateTsConfig);
  if (_singleTSConfig)
    return _singleTSConfig;
  return loadAndValidateTsconfigsForFolder(path.dirname(file));
}

function loadAndValidateTsconfigsForFolder(folder: string): ParsedTsConfigData[] {
  const foldersWithConfig: string[] = [];
  let currentFolder = path.resolve(folder);
  let result: ParsedTsConfigData[] | undefined;
  while (true) {
    const cached = cachedTSConfigs.get(currentFolder);
    if (cached) {
      result = cached;
      break;
    }

    foldersWithConfig.push(currentFolder);

    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      const configPath = path.join(currentFolder, name);
      if (fs.existsSync(configPath)) {
        const loaded = loadTsConfig(configPath);
        result = loaded.map(validateTsConfig);
        break;
      }
    }
    if (result)
      break;

    const parentFolder = path.resolve(currentFolder, '../');
    if (currentFolder === parentFolder)
      break;
    currentFolder = parentFolder;
  }

  result = result || [];
  for (const folder of foldersWithConfig)
    cachedTSConfigs.set(folder, result);
  return result;
}

const pathSeparator = process.platform === 'win32' ? ';' : ':';

// Memoized per-process. `transformHook` is on the per-file-load hot path, so
// avoid re-splitting the env var on every call. Read once, cached forever
// (env-var changes mid-process aren't supported elsewhere in the pipeline).
let _cachedTransformScopePrefixes: string[] | undefined;
function getTransformScopePrefixes(): string[] {
  if (_cachedTransformScopePrefixes === undefined) {
    const raw = process.env.PW_TEST_SOURCE_TRANSFORM_SCOPE;
    _cachedTransformScopePrefixes = raw ? raw.split(pathSeparator) : [];
  }
  return _cachedTransformScopePrefixes;
}
const builtins = new Set(Module.builtinModules);

export function resolveHook(filename: string, specifier: string): string | undefined {
  if (specifier.startsWith('node:') || builtins.has(specifier))
    return;
  if (!shouldTransform(filename))
    return;

  if (isRelativeSpecifier(specifier))
    return resolveImportSpecifierAfterMapping(path.resolve(path.dirname(filename), specifier), false);

  /**
   * TypeScript discourages path-mapping into node_modules:
   * https://www.typescriptlang.org/docs/handbook/modules/reference.html#paths-should-not-point-to-monorepo-packages-or-node_modules-packages
   * However, if path-mapping doesn't yield a result, TypeScript falls back to the default resolution through node_modules.
   */
  const isTypeScript = filename.endsWith('.ts') || filename.endsWith('.tsx');
  const tsconfigs = loadAndValidateTsconfigsForFile(filename);
  for (const tsconfig of tsconfigs) {
    if (!isTypeScript && !tsconfig.allowJs)
      continue;
    let longestPrefixLength = -1;
    let pathMatchedByLongestPrefix: string | undefined;

    for (const { key, values } of tsconfig.paths) {
      let matchedPartOfSpecifier = specifier;

      const [keyPrefix, keySuffix] = key.split('*');
      if (key.includes('*')) {
        // * If pattern contains '*' then to match pattern "<prefix>*<suffix>" module name must start with the <prefix> and end with <suffix>.
        // * <MatchedStar> denotes part of the module name between <prefix> and <suffix>.
        // * If module name can be matches with multiple patterns then pattern with the longest prefix will be picked.
        // https://github.com/microsoft/TypeScript/blob/f82d0cb3299c04093e3835bc7e29f5b40475f586/src/compiler/moduleNameResolver.ts#L1049
        if (keyPrefix) {
          if (!specifier.startsWith(keyPrefix))
            continue;
          matchedPartOfSpecifier = matchedPartOfSpecifier.substring(keyPrefix.length, matchedPartOfSpecifier.length);
        }
        if (keySuffix) {
          if (!specifier.endsWith(keySuffix))
            continue;
          matchedPartOfSpecifier = matchedPartOfSpecifier.substring(0, matchedPartOfSpecifier.length - keySuffix.length);
        }
      } else {
        if (specifier !== key)
          continue;
        matchedPartOfSpecifier = specifier;
      }

      if (keyPrefix.length <= longestPrefixLength)
        continue;

      for (const value of values) {
        let candidate = value;
        if (value.includes('*'))
          candidate = candidate.replace('*', matchedPartOfSpecifier);
        candidate = path.resolve(tsconfig.pathsBase!, candidate);
        const existing = resolveImportSpecifierAfterMapping(candidate, true);
        if (existing) {
          longestPrefixLength = keyPrefix.length;
          pathMatchedByLongestPrefix = existing;
        }
      }
    }
    if (pathMatchedByLongestPrefix)
      return pathMatchedByLongestPrefix;
  }

  if (path.isAbsolute(specifier)) {
    // Handle absolute file paths like `import '/path/to/file'`
    // Do not handle module imports like `import 'fs'`
    return resolveImportSpecifierAfterMapping(specifier, false);
  }

  // Legacy `node_modules/<pkg>/index.<ext>` fallback. Node's ESM resolver
  // requires a `package.json` for any bare specifier; the CJS resolver
  // (which playwright historically delegated to under pirates) did not.
  // Inline test fixtures still write packages without `package.json`, so
  // walk up the parent chain ourselves and look for an index entry. We
  // only kick in when the specifier is a single segment (`foo` or
  // `@scope/foo`) — anything else is a subpath that we leave to Node.
  if (!/^(?:@[^/]+\/)?[^/]+$/.test(specifier))
    return;
  let dir = path.dirname(filename);
  while (true) {
    const candidate = path.join(dir, 'node_modules', specifier);
    if (fileExistsCached(path.join(candidate, 'package.json'))) {
      // Defer to Node — it can read the package.json and `exports` field.
      return;
    }
    const indexHit = resolveImportSpecifierAfterMapping(path.join(candidate, 'index'), true);
    if (indexHit)
      return indexHit;
    const parent = path.dirname(dir);
    if (parent === dir)
      return;
    dir = parent;
  }
}

function fileExistsCached(p: string): boolean {
  try {
    return fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
}

export function shouldTransform(filename: string): boolean {
  if (_externalMatcher(filename))
    return false;
  return !belongsToNodeModules(filename);
}

let transformData: Map<string, any>;

export function setTransformData(pluginName: string, value: any) {
  transformData.set(pluginName, value);
}

export function logTransformFallback(transformer: string, filename: string): void {
  if (!process.env.DEBUG?.includes('pw:transform'))
    return;
  // eslint-disable-next-line no-restricted-properties
  process.stderr.write(`[pw:transform] ${transformer} returned no code for ${filename}; falling back to original source\n`);
}

export function transformHook(originalCode: string, filename: string, moduleUrl?: string, format?: 'commonjs' | 'module'): { code: string, serializedCache?: any } {
  const hasPreprocessor =
    process.env.PW_TEST_SOURCE_TRANSFORM &&
    getTransformScopePrefixes().some(f => filename.startsWith(f));
  const pluginsPrologue = _transformConfig.babelPlugins;
  const pluginsEpilogue = hasPreprocessor ? [[process.env.PW_TEST_SOURCE_TRANSFORM!]] as BabelPlugin[] : [];
  // Effective format: explicit param wins, otherwise derive from the moduleUrl
  // signal (set only for ESM imports). Files routed through `require()` come
  // in with no moduleUrl and no format hint — those are inherently CJS.
  const effectiveFormat: 'commonjs' | 'module' = format ?? (moduleUrl ? 'module' : 'commonjs');
  const hash = calculateHash(originalCode, filename, effectiveFormat, pluginsPrologue, pluginsEpilogue);
  const { cachedCode, addToCache, serializedCache } = getFromCompilationCache(filename, hash, moduleUrl);
  if (cachedCode !== undefined)
    return { code: cachedCode, serializedCache };

  // Fast path: oxc-transform handles TS/JSX/decorators ~10× faster than Babel,
  // but doesn't emit `require`/`module.exports`. For files the loader classified
  // as `commonjs` we route through esbuild instead — it does TS-strip + JSX +
  // ESM→CJS in one Go-native pass. Both paths are skipped when the user
  // configured custom Babel plugins, which need the full Babel pipeline.
  if (!pluginsPrologue.length && !pluginsEpilogue.length) {
    if (effectiveFormat === 'commonjs') {
      const { esbuildCjsTransform }: { esbuildCjsTransform: EsbuildTransformFunction } = require(libPath('transform', 'esbuildBundle'));
      transformData = new Map<string, any>();
      const esResult = esbuildCjsTransform(originalCode, filename, _transformConfig.jsxImportSource);
      if (!esResult?.code) {
        logTransformFallback('esbuild', filename);
        return { code: originalCode, serializedCache };
      }
      const { code, map } = esResult;
      const added = addToCache!(code, map, transformData);
      return { code, serializedCache: added.serializedCache };
    }

    const { oxcTransform }: { oxcTransform: OxcTransformFunction } = require(libPath('transform', 'oxcBundle'));
    transformData = new Map<string, any>();
    const oxcResult = oxcTransform(originalCode, filename, _transformConfig.jsxImportSource);
    if (!oxcResult?.code) {
      logTransformFallback('oxc', filename);
      return { code: originalCode, serializedCache };
    }
    const { code, map } = oxcResult;
    const added = addToCache!(code, map, transformData);
    return { code, serializedCache: added.serializedCache };
  }

  // We don't use any browserslist data, but babel checks it anyway.
  // Silence the annoying warning.
  process.env.BROWSERSLIST_IGNORE_OLD_DATA = 'true';

  const { babelTransform }: { babelTransform: BabelTransformFunction } = require(libPath('transform', 'babelBundle'));
  transformData = new Map<string, any>();
  // Pass `setTransformData` to plugins via plugin options instead of having
  // them import it. The bundled esmLoader inlines its own copy of this file,
  // so an import-based approach would close over the wrong `transformData`
  // module-level variable. The closure here always references the bundle copy
  // currently driving the transform.
  const setTransformDataForPlugin = (key: string, value: any) => transformData.set(key, value);
  const wrappedPrologue: BabelPlugin[] = pluginsPrologue.map(([name, opts]) => [
    name,
    { ...(opts || {}), setTransformData: setTransformDataForPlugin },
  ]);
  const babelResult = babelTransform(originalCode, filename, effectiveFormat === 'module', wrappedPrologue, pluginsEpilogue, _transformConfig.jsxImportSource);
  if (!babelResult?.code) {
    logTransformFallback('babel', filename);
    return { code: originalCode, serializedCache };
  }
  const { code, map } = babelResult;
  const added = addToCache!(code, map, transformData);
  return { code, serializedCache: added.serializedCache };
}

function calculateHash(content: string, filePath: string, format: 'commonjs' | 'module', pluginsPrologue: BabelPlugin[], pluginsEpilogue: BabelPlugin[]): string {
  const hash = crypto.createHash('sha1')
      .update(format === 'module' ? 'esm' : 'cjs')
      .update(content)
      .update(filePath)
      .update(version)
      .update(pluginsPrologue.map(p => p[0]).join(','))
      .update(pluginsEpilogue.map(p => p[0]).join(','))
      .digest('hex');
  return hash;
}

export async function requireOrImport(file: string) {
  installTransformIfNeeded();

  if (isBun())
    return await importUnderBun(file).finally(nextTask);

  const fileUrl = url.pathToFileURL(file).toString();

  // The .esm.preflight extension is a synthetic specifier handled by our
  // node:module ESM loader to flush source maps before the real import.
  await import(fileUrl + '.esm.preflight')
      .catch((error: any) => debugTest('Failed to load preflight for ' + file + ', source maps may be missing for errors thrown during loading.', error))
      .finally(nextTask);

  // Compilation cache, which includes source maps, is populated in a post task.
  // When importing a module results in an error, the very next access to `error.stack`
  // will need source maps. To make sure source maps have arrived, we insert a task
  // that will be processed after compilation cache and guarantee that
  // source maps are available, before `error.stack` is accessed.
  return await import(fileUrl).finally(nextTask);
}

let transformInstalled = false;

function installTransformIfNeeded() {
  if (transformInstalled)
    return;
  transformInstalled = true;

  if (isBun())
    return;

  installSourceMapSupport();

  const originalResolveFilename = (Module as any)._resolveFilename;
  function resolveFilename(this: any, specifier: string, parent: Module, ...rest: any[]) {
    if (parent) {
      const resolved = resolveHook(parent.filename, specifier);
      if (resolved !== undefined)
        specifier = resolved;
    }
    return originalResolveFilename.call(this, specifier, parent, ...rest);
  }
  (Module as any)._resolveFilename = resolveFilename;
}

const collectCJSDependencies = (module: Module, dependencies: Set<string>) => {
  module.children.forEach(child => {
    if (!belongsToNodeModules(child.filename) && !dependencies.has(child.filename)) {
      dependencies.add(child.filename);
      collectCJSDependencies(child, dependencies);
    }
  });
};

export function wrapFunctionWithLocation<A extends any[], R>(func: (location: Location, ...args: A) => R): (...args: A) => R {
  return (...args) => {
    const oldPrepareStackTrace = Error.prepareStackTrace;
    Error.prepareStackTrace = (error, stackFrames) => {
      const frame = sourceMapSupport.wrapCallSite(stackFrames[1] as any) as NodeJS.CallSite;
      const fileName = frame.getFileName();
      // Node error stacks for modules use file:// urls instead of paths.
      const file = (fileName && fileName.startsWith('file://')) ? url.fileURLToPath(fileName) : fileName;
      return {
        file,
        line: frame.getLineNumber(),
        column: frame.getColumnNumber(),
      };
    };
    const oldStackTraceLimit = Error.stackTraceLimit;
    Error.stackTraceLimit = 2;
    const obj: { stack: Location } = {} as any;
    Error.captureStackTrace(obj);
    const location = obj.stack;
    Error.stackTraceLimit = oldStackTraceLimit;
    Error.prepareStackTrace = oldPrepareStackTrace;
    return func(location, ...args);
  };
}

function isRelativeSpecifier(specifier: string) {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../');
}

async function nextTask() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

let loaderChannel: PortTransport | undefined;

function registerESMLoader() {
  // Opt-out switch.
  if (process.env.PW_DISABLE_TS_ESM)
    return;

  // Transpilation in `bun` is not necessary, and trying to register a hook would cause issues.
  // https://github.com/oven-sh/bun/issues/8222#issuecomment-3665364677
  if ('Bun' in globalThis)
    return;

  const nodeModule = require('node:module');

  if (nodeModule.registerHooks && !process.env.PLAYWRIGHT_FORCE_ASYNC_LOADER) {
    nodeModule.registerHooks({ resolve: esmLoaderSync.resolve, load: esmLoaderSync.load });
    return;
  }

  if (!nodeModule.register)
    return;

  const { port1, port2 } = new MessageChannel();
  // register will wait until the loader is initialized. The path is relative to
  // the bundle output layout (lib/common/index.js → ../transform/esmLoader.js),
  // not the source layout — esmLoader.js is its own esbuild entry point.
  nodeModule.register(url.pathToFileURL(require.resolve('../transform/esmLoader.js')), {
    data: { port: port2 },
    transferList: [port2],
  });
  loaderChannel = new PortTransport(port1, async (method, params) => {
    if (method === 'pushToCompilationCache')
      addToCompilationCache(params.cache);
  });
  // Seed the loader thread with the state accumulated so far. Subsequent updates
  // are pushed by setSingleTSConfig() / setTransformConfig() / startCollectingFileDeps().
  void loaderChannel.send('setSingleTSConfig', { tsconfig: _singleTSConfigPath });
  void loaderChannel.send('setTransformConfig', { config: _transformConfig });
  void loaderChannel.send('addToCompilationCache', { cache: serializeCompilationCache() });
}

export async function startCollectingFileDeps() {
  ccStartCollectingFileDeps();
  if (loaderChannel)
    await loaderChannel.send('startCollectingFileDeps', {});
}

export async function stopCollectingFileDeps(file: string) {
  ccStopCollectingFileDeps(file);
  if (loaderChannel)
    await loaderChannel.send('stopCollectingFileDeps', { file });
}

export async function incorporateCompilationCache() {
  if (!loaderChannel)
    return;
  // Gather dependency information from the esm loader that was populated by
  // its resolve hook. We don't push this proactively during load — only at end.
  const result = await loaderChannel.send('getCompilationCache', {});
  addToCompilationCache(result.cache);
}
