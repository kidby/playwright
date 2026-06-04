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
import os from 'os';
import path from 'path';
import url from 'url';

import sourceMapSupport from 'source-map-support';
import { calculateSha1 } from '@utils/crypto';
import { isUnderTest } from '@utils/debug';

import { isWorkerProcess } from '../globals.js';
import { packageRoot } from '../package.js';
import {
  closeCacheDb,
  openCacheDb,
  scheduleLegacyLayoutCleanup,
  sqliteAddEntry,
  sqliteGetEntry,
  sqliteGetSourceMap,
  useLegacyCache,
} from './cacheBackend.js';

// `code` is populated when the compiled output fits the per-entry cap, which
// lets the warm-path lookup skip the disk read entirely. Larger files keep
// only the path and re-read on hit.
const MEMORY_CACHE_CODE_CAP = 256 * 1024;

export type MemoryCache = {
  codePath: string;
  sourceMapPath: string;
  dataPath: string;
  moduleUrl?: string;
  code?: string;
  // Set in SQLite mode so workers can re-query the DB on memory miss.
  contentHash?: string;
};

export type SerializedCompilationCache = {
  sourceMaps: [string, string][],
  memoryCache: [string, MemoryCache][],
  fileDependencies: [string, string[]][],
  externalDependencies: [string, string[]][],
};

// Assumptions for the compilation cache:
// - Files in the temp directory we work with can disappear at any moment, either some of them or all together.
// - Multiple workers can be trying to read from the compilation cache at the same time.
// - There is a single invocation of the test runner at a time.
//
// Therefore, we implement the following logic:
// - Never assume that file is present, always try to read it to determine whether it's actually present.
// - Never write to the cache from worker processes to avoid "multiple writers" races.
// - Since we perform all static imports in the runner beforehand, most of the time
//   workers should be able to read from the cache.
// - For workers-only dynamic imports or some cache problems, we will re-transpile files in
//   each worker anew.

export const cacheDir = process.env.PWTEST_CACHE_DIR || (() => {
  if (process.platform === 'win32')
    return path.join(os.tmpdir(), `playwright-transform-cache`);
  // Use `geteuid()` instead of more natural `os.userInfo().username`
  // since `os.userInfo()` is not always available.
  // Note: `process.geteuid()` is not available on windows.
  // See https://github.com/microsoft/playwright/issues/22721
  return path.join(os.tmpdir(), `playwright-transform-cache-` + process.geteuid?.());
})();

const sourceMaps: Map<string, string> = new Map();
const memoryCache = new Map<string, MemoryCache>();
// Directories already created in this process — skip the recursive-mkdir
// syscall on subsequent cache writes that share the same parent.
const ensuredCacheDirs = new Set<string>();

function ensureCacheDir(dirPath: string): void {
  if (ensuredCacheDirs.has(dirPath))
    return;
  fs.mkdirSync(dirPath, { recursive: true });
  ensuredCacheDirs.add(dirPath);
}

// Dependencies resolved by the loader.
const fileDependencies = new Map<string, Set<string>>();
// Dependencies resolved by the external bundler.
const externalDependencies = new Map<string, Set<string>>();

const devSourceInfix = path.sep + 'playwright' + path.sep + 'packages' + path.sep;

export function installSourceMapSupport() {
  Error.stackTraceLimit = 200;
  if (!useLegacyCache)
    scheduleLegacyLayoutCleanup(cacheDir);

  sourceMapSupport.install({
    environment: 'node',
    handleUncaughtExceptions: false,
    retrieveSourceMap(source) {
      if (!process.env.PWDEBUGIMPL && isUnderTest() && source.includes(devSourceInfix))
        return { map: identitySourceMap(source), url: source };
      if (!sourceMaps.has(source))
        return null;
      const sourceMapPath = sourceMaps.get(source)!;
      // SQLite-backed entries store their key as `sqlite:<filename>#<contentHash>`.
      // Legacy entries store a real filesystem path.
      if (sourceMapPath.startsWith('sqlite:')) {
        const hashIdx = sourceMapPath.indexOf('#');
        if (hashIdx === -1)
          return null;
        const filename = sourceMapPath.slice('sqlite:'.length, hashIdx);
        const contentHash = sourceMapPath.slice(hashIdx + 1);
        const map = sqliteGetSourceMap(cacheDir, filename, contentHash);
        if (!map)
          return null;
        try {
          return { map: JSON.parse(map), url: source };
        } catch {
          return null;
        }
      }
      try {
        return {
          map: JSON.parse(fs.readFileSync(sourceMapPath, 'utf-8')),
          url: source,
        };
      } catch {
        return null;
      }
    }
  });

  // Best-effort: close the DB on process exit so the WAL file can finalise.
  // `exit` fires for normal termination; SIGINT/SIGTERM go through the same
  // exit hook after the runner's own teardown.
  process.once('exit', closeCacheDb);
}

function identitySourceMap(source: string) {
  // source may be a `file://` URL in ESM contexts; readFileSync wants a path.
  const filePath = source.startsWith('file:') ? url.fileURLToPath(source) : source;
  const lineCount = fs.readFileSync(filePath, 'utf8').split('\n').length;
  return {
    version: 3,
    sources: [source],
    mappings: lineCount ? 'AAAA' + ';AACA'.repeat(lineCount - 1) : '',
  };
}

function _innerAddToCompilationCacheAndSerialize(filename: string, entry: MemoryCache) {
  sourceMaps.set(entry.moduleUrl || filename, entry.sourceMapPath);
  memoryCache.set(filename, entry);
  return {
    sourceMaps: [[entry.moduleUrl || filename, entry.sourceMapPath]],
    memoryCache: [[filename, entry]],
    fileDependencies: [],
    externalDependencies: [],
  };
}

type CompilationCacheLookupResult = {
  serializedCache?: any;
  cachedCode?: string;
  addToCache?: (code: string, map: any | undefined | null, data: Map<string, any>) => { serializedCache?: any };
};

export function getFromCompilationCache(filename: string, contentHash: string, moduleUrl?: string): CompilationCacheLookupResult {
  // First check the memory cache by filename, this cache will always work in the worker,
  // because we just compiled this file in the loader.
  const cache = memoryCache.get(filename);
  if (cache?.code !== undefined)
    return { cachedCode: cache.code };
  if (!useLegacyCache && cache?.contentHash) {
    const entry = sqliteGetEntry(cacheDir, filename, cache.contentHash);
    if (entry) {
      if (entry.code.length <= MEMORY_CACHE_CODE_CAP)
        cache.code = entry.code;
      return { cachedCode: entry.code };
    }
  }
  if (useLegacyCache && cache?.codePath) {
    try {
      const cachedCode = fs.readFileSync(cache.codePath, 'utf-8');
      if (cachedCode.length <= MEMORY_CACHE_CODE_CAP)
        cache.code = cachedCode;
      return { cachedCode };
    } catch {
      // Not able to read the file - fall through.
    }
  }

  if (useLegacyCache)
    return _legacyDiskCacheLookup(filename, contentHash, moduleUrl);
  return _sqliteDiskCacheLookup(filename, contentHash, moduleUrl);
}

function _sqliteDiskCacheLookup(filename: string, contentHash: string, moduleUrl?: string): CompilationCacheLookupResult {
  const entry = sqliteGetEntry(cacheDir, filename, contentHash);
  if (entry) {
    const cachedInMemory = entry.code.length <= MEMORY_CACHE_CODE_CAP ? entry.code : undefined;
    const serializedCache = _innerAddToCompilationCacheAndSerialize(filename, {
      codePath: _sqliteSyntheticKey(filename, contentHash),
      sourceMapPath: _sqliteSyntheticKey(filename, contentHash),
      dataPath: _sqliteSyntheticKey(filename, contentHash),
      moduleUrl,
      code: cachedInMemory,
      contentHash,
    });
    return { cachedCode: entry.code, serializedCache };
  }

  return {
    addToCache: (code: string, map: any | undefined | null, data: Map<string, any>) => {
      if (isWorkerProcess())
        return {};
      sqliteAddEntry(
          cacheDir,
          filename,
          contentHash,
          code,
          map ? JSON.stringify(map) : null,
          data.size ? JSON.stringify(Object.fromEntries(data), undefined, 2) : null,
          moduleUrl ?? null,
      );
      const cachedInMemory = code.length <= MEMORY_CACHE_CODE_CAP ? code : undefined;
      const serializedCache = _innerAddToCompilationCacheAndSerialize(filename, {
        codePath: _sqliteSyntheticKey(filename, contentHash),
        sourceMapPath: _sqliteSyntheticKey(filename, contentHash),
        dataPath: _sqliteSyntheticKey(filename, contentHash),
        moduleUrl,
        code: cachedInMemory,
        contentHash,
      });
      return { serializedCache };
    },
  };
}

// Synthetic identifier used when the storage is SQLite, so the existing
// `MemoryCache` shape (designed around filesystem paths) keeps a non-empty
// value while the actual code lives in the DB.
function _sqliteSyntheticKey(filename: string, contentHash: string): string {
  return `sqlite:${filename}#${contentHash}`;
}

function _legacyDiskCacheLookup(filename: string, contentHash: string, moduleUrl?: string): CompilationCacheLookupResult {
  const filePathHash = calculateFilePathHash(filename);
  const hashPrefix = filePathHash + '_' + contentHash.substring(0, 7);
  const cacheFolderName = filePathHash.substring(0, 2);
  const cachePath = calculateCachePath(filename, cacheFolderName, hashPrefix);
  const codePath = cachePath + '.js';
  const sourceMapPath = cachePath + '.map';
  const dataPath = cachePath + '.data';
  try {
    const cachedCode = fs.readFileSync(codePath, 'utf8');
    const cachedInMemory = cachedCode.length <= MEMORY_CACHE_CODE_CAP ? cachedCode : undefined;
    const serializedCache = _innerAddToCompilationCacheAndSerialize(filename, { codePath, sourceMapPath, dataPath, moduleUrl, code: cachedInMemory });
    return { cachedCode, serializedCache };
  } catch {
  }

  return {
    addToCache: (code: string, map: any | undefined | null, data: Map<string, any>) => {
      if (isWorkerProcess())
        return {};
      // Trim cache. This won't help with deleted files, but it will remove storing multiple copies of the same file
      clearOldCacheEntries(cacheFolderName, filePathHash);
      ensureCacheDir(path.dirname(cachePath));
      if (map)
        fs.writeFileSync(sourceMapPath, JSON.stringify(map), 'utf8');
      if (data.size)
        fs.writeFileSync(dataPath, JSON.stringify(Object.fromEntries(data), undefined, 2), 'utf8');
      fs.writeFileSync(codePath, code, 'utf8');
      const cachedInMemory = code.length <= MEMORY_CACHE_CODE_CAP ? code : undefined;
      const serializedCache = _innerAddToCompilationCacheAndSerialize(filename, { codePath, sourceMapPath, dataPath, moduleUrl, code: cachedInMemory });
      return { serializedCache };
    }
  };
}

export function serializeCompilationCache(): SerializedCompilationCache {
  return {
    sourceMaps: [...sourceMaps.entries()],
    memoryCache: [...memoryCache.entries()],
    fileDependencies: [...fileDependencies.entries()].map(([filename, deps]) => ([filename, [...deps]])),
    externalDependencies: [...externalDependencies.entries()].map(([filename, deps]) => ([filename, [...deps]])),
  };
}

export function addToCompilationCache(payload: SerializedCompilationCache) {
  for (const entry of payload.sourceMaps)
    sourceMaps.set(entry[0], entry[1]);
  for (const entry of payload.memoryCache)
    memoryCache.set(entry[0], entry[1]);
  for (const entry of payload.fileDependencies) {
    const existing = fileDependencies.get(entry[0]) || [];
    fileDependencies.set(entry[0], new Set([...entry[1], ...existing]));
  }
  for (const entry of payload.externalDependencies) {
    const existing = externalDependencies.get(entry[0]) || [];
    externalDependencies.set(entry[0], new Set([...entry[1], ...existing]));
  }
}

function calculateFilePathHash(filePath: string): string {
  // Larger file path hash allows for fewer collisions compared to content, as we only check file path collision for deleting files
  return calculateSha1(filePath).substring(0, 10);
}

function calculateCachePath(filePath: string, cacheFolderName: string, hashPrefix: string): string {
  const fileName = hashPrefix + '_' + path.basename(filePath, path.extname(filePath)).replace(/\W/g, '');
  return path.join(cacheDir, cacheFolderName, fileName);
}

function clearOldCacheEntries(cacheFolderName: string, filePathHash: string) {
  const cachePath = path.join(cacheDir, cacheFolderName);
  try {
    const cachedRelevantFiles = fs.readdirSync(cachePath).filter(file => file.startsWith(filePathHash));
    for (const file of cachedRelevantFiles)
      fs.rmSync(path.join(cachePath, file), { force: true });
  } catch {
  }
}

// Since ESM and CJS collect dependencies differently,
// we go via the global state to collect them.
let depsCollector: Set<string> | undefined;

export function startCollectingFileDeps() {
  depsCollector = new Set();
}

export function stopCollectingFileDeps(filename: string) {
  if (!depsCollector)
    return;
  depsCollector.delete(filename);
  for (const dep of depsCollector) {
    if (belongsToNodeModules(dep))
      depsCollector.delete(dep);
  }
  fileDependencies.set(filename, depsCollector);
  depsCollector = undefined;
}

export function currentFileDepsCollector(): Set<string> | undefined {
  return depsCollector;
}

export function setExternalDependencies(filename: string, deps: string[]) {
  const depsSet = new Set(deps.filter(dep => !belongsToNodeModules(dep) && dep !== filename));
  externalDependencies.set(filename, depsSet);
}

export function fileDependenciesForTest() {
  return Object.fromEntries([...fileDependencies].map(entry => (
    [path.basename(entry[0]), [...entry[1]].map(f => path.basename(f)).sort()]
  )));
}

export function collectAffectedTestFiles(changedFile: string, testFileCollector: Set<string>) {
  const isTestFile = (file: string) => fileDependencies.has(file);

  if (isTestFile(changedFile))
    testFileCollector.add(changedFile);

  for (const [testFile, deps] of fileDependencies) {
    if (deps.has(changedFile))
      testFileCollector.add(testFile);
  }

  for (const [importingFile, depsOfImportingFile] of externalDependencies) {
    if (depsOfImportingFile.has(changedFile)) {
      if (isTestFile(importingFile))
        testFileCollector.add(importingFile);

      for (const [testFile, depsOfTestFile] of fileDependencies) {
        if (depsOfTestFile.has(importingFile))
          testFileCollector.add(testFile);
      }
    }
  }
}

export function affectedTestFiles(changes: string[]): string[] {
  const result = new Set<string>();
  for (const change of changes)
    collectAffectedTestFiles(change, result);
  return [...result];
}

export function internalDependenciesForTestFile(filename: string): Set<string> | undefined{
  return fileDependencies.get(filename);
}

export function dependenciesForTestFile(filename: string): Set<string> {
  const result = new Set<string>();
  for (const testDependency of fileDependencies.get(filename) || []) {
    result.add(testDependency);
    for (const externalDependency of externalDependencies.get(testDependency) || [])
      result.add(externalDependency);
  }
  for (const dep of externalDependencies.get(filename) || [])
    result.add(dep);
  return result;
}

// This is only used in the dev mode, specifically excluding
// files from packages/playwright*. In production mode, node_modules covers
// that.
const kPlaywrightInternalPrefix = packageRoot;

export function belongsToNodeModules(file: string) {
  if (file.includes(`${path.sep}node_modules${path.sep}`))
    return true;
  if (file.startsWith(kPlaywrightInternalPrefix) && (file.endsWith('.js') || file.endsWith('.mjs')))
    return true;
  return false;
}

export async function getUserData(pluginName: string): Promise<Map<string, any>> {
  const result = new Map<string, any>();
  for (const [fileName, cache] of memoryCache) {
    if (!cache.dataPath)
      continue;
    if (!fs.existsSync(cache.dataPath))
      continue;
    const data = JSON.parse(await fs.promises.readFile(cache.dataPath, 'utf8'));
    if (data[pluginName])
      result.set(fileName, data[pluginName]);
  }
  return result;
}
