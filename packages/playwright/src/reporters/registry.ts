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

// Single source of truth for built-in reporter shorthands.
//
// Reporters are LOADED LAZILY at runtime. The cost of parsing + evaluating
// reporter source code is fixed-at-startup if we eager-import — with 15
// reporters bundled, that's ~235 KB of JS executed every time the CLI starts,
// even when only one reporter is in use.
//
// To get true laziness, we resolve reporter files via `require()` with a
// computed path string. esbuild can't statically analyse that, so it leaves
// the call as-is in the bundle; at runtime, `createRequire` (provided by the
// cjsCompat banner) resolves the file from `lib/reporters/<name>.js`. The
// build pipeline emits a per-file `.js` for each reporter (see
// `utils/build/build.js` reporters entry-point list).

import path from 'path';
import { createRequire } from 'module';

import type { ReporterV2 } from './reporterV2.js';

export type ReporterCtor = new (arg: any) => ReporterV2;

type RegistryEntry = {
  // Basename (no extension) of the reporter's per-file lib output.
  file: string;
  // The named export to pluck — most use `default`, some have a named export.
  exportName?: string;
  // Reporters that render differently in `--list` mode swap to listModeReporter.
  listMode?: { file: string; exportName?: string };
};

const LIST_MODE_LOADER = { file: 'listModeReporter' };

const REGISTRY: Record<string, RegistryEntry> = {
  list: { file: 'list',    listMode: LIST_MODE_LOADER },
  line: { file: 'line',    listMode: LIST_MODE_LOADER },
  dot:  { file: 'dot',     listMode: LIST_MODE_LOADER },
  json: { file: 'json' },
  junit: { file: 'junit' },
  null: { file: 'empty' },
  github: { file: 'github' },
  html: { file: 'html' },
  blob: { file: 'blob', exportName: 'BlobReporter' },
  catalog: { file: 'catalog' },
  ai: { file: 'ai' },
  csv: { file: 'csv' },
  jira: { file: 'jira' },
  newRelic: { file: 'newRelic' },
  xray: { file: 'xray' },
};

export const BUILT_IN_REPORTER_NAMES = Object.keys(REGISTRY) as readonly BuiltInReporterName[];

// Hand-listed string-literal union — keep in sync with REGISTRY keys above.
// `isBuiltInReporter` guards the runtime side.
export type BuiltInReporterName =
  | 'list' | 'line' | 'dot' | 'json' | 'junit' | 'null' | 'github' | 'html' | 'blob'
  | 'catalog' | 'ai' | 'csv' | 'jira' | 'newRelic' | 'xray';

// `require` is bound to `lib/common/index.js` (via the cjsCompat banner's
// createRequire), so the reporter `.js` files are reached via the relative
// path `../reporters/<name>.js`. Using `require()` instead of `import()` so
// the call site is opaque to esbuild's bundler (no inline).
const _requireFromHere = createRequire(import.meta.url);
function loadReporterFile(file: string): { default?: ReporterCtor; [k: string]: unknown } {
  // The variable argument prevents esbuild from statically resolving + bundling.
  const target = path.join('..', 'reporters', file + '.js');
  return _requireFromHere(target);
}

function pluckCtor(mod: { default?: ReporterCtor; [k: string]: unknown }, exportName: string): ReporterCtor {
  const ctor = mod[exportName];
  if (typeof ctor !== 'function')
    throw new Error(`Reporter module did not export '${exportName}' as a constructor`);
  return ctor as ReporterCtor;
}

export async function resolveBuiltInReporter(name: BuiltInReporterName, mode: 'list' | 'test' | 'merge'): Promise<ReporterCtor> {
  const entry = REGISTRY[name];
  const target = (mode === 'list' && entry.listMode) ? entry.listMode : entry;
  const mod = loadReporterFile(target.file);
  return pluckCtor(mod, target.exportName || 'default');
}

export function isBuiltInReporter(name: string): name is BuiltInReporterName {
  return name in REGISTRY;
}
