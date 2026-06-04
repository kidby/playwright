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

// Single source of truth for built-in reporter shorthands. Both `common/config.ts`
// (for the `BuiltInReporter` type union) and `runner/reporters.ts` (for the
// runtime constructor lookup) read from here. Adding a new built-in reporter
// only requires touching this file.

import AIReporter from './ai.js';
import { BlobReporter } from './blob.js';
import CSVReporter from './csv.js';
import CatalogReporter from './catalog.js';
import DotReporter from './dot.js';
import EmptyReporter from './empty.js';
import GitHubReporter from './github.js';
import HtmlReporter from './html.js';
import JSONReporter from './json.js';
import JUnitReporter from './junit.js';
import JiraReporter from './jira.js';
import LineReporter from './line.js';
import ListReporter from './list.js';
import ListModeReporter from './listModeReporter.js';
import NewRelicReporter from './newRelic.js';
import XrayReporter from './xray.js';

import type { ReporterV2 } from './reporterV2.js';

export type ReporterCtor = new (arg: any) => ReporterV2;

type RegistryEntry = {
  default: ReporterCtor;
  // Some reporters render differently when the runner is just listing tests
  // (`playwright test --list`) — they swap to ListModeReporter in that mode.
  listMode?: ReporterCtor;
};

const REGISTRY: Record<string, RegistryEntry> = {
  list: { default: ListReporter, listMode: ListModeReporter },
  line: { default: LineReporter, listMode: ListModeReporter },
  dot: { default: DotReporter, listMode: ListModeReporter },
  json: { default: JSONReporter },
  junit: { default: JUnitReporter },
  null: { default: EmptyReporter },
  github: { default: GitHubReporter },
  html: { default: HtmlReporter },
  blob: { default: BlobReporter },
  catalog: { default: CatalogReporter },
  ai: { default: AIReporter },
  csv: { default: CSVReporter },
  jira: { default: JiraReporter },
  newRelic: { default: NewRelicReporter },
  xray: { default: XrayReporter },
};

export const BUILT_IN_REPORTER_NAMES = Object.keys(REGISTRY) as readonly BuiltInReporterName[];

// Hand-listed string-literal union because TypeScript can't infer this from a
// `Record<string, _>` (the index signature widens the keys to `string`).
// Keep this in sync with the keys above — `isBuiltInReporter` guards the gap
// at runtime.
export type BuiltInReporterName =
  | 'list' | 'line' | 'dot' | 'json' | 'junit' | 'null' | 'github' | 'html' | 'blob'
  | 'catalog' | 'ai' | 'csv' | 'jira' | 'newRelic' | 'xray';

export function resolveBuiltInReporter(name: BuiltInReporterName, mode: 'list' | 'test' | 'merge'): ReporterCtor {
  const entry = REGISTRY[name];
  if (mode === 'list' && entry.listMode)
    return entry.listMode;
  return entry.default;
}

export function isBuiltInReporter(name: string): name is BuiltInReporterName {
  return name in REGISTRY;
}
