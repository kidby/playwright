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

import type { Page } from '@playwright/test';
import type * as LH from 'lighthouse/types/lh.js';

/** Lighthouse category id. */
export type LighthouseCategory = 'performance' | 'accessibility' | 'best-practices' | 'seo' | 'pwa';

/** Per-category minimum score (0–100). Defaults to 100 for every named category if omitted. */
export type LighthouseThresholds = Partial<Record<LighthouseCategory, number>>;

/** Report file formats lighthouse can emit. */
export type LighthouseReportFormat = 'html' | 'json' | 'csv';

/** Options passed to {@link audit} or the `lighthouse` fixture. */
export type LighthouseOptions = {
  /** URL to audit. Defaults to `page.url()`. */
  url?: string;

  /** CDP port. Required unless the page was supplied by `lighthouseTest`, which wires this for you. */
  port?: number;

  /** Minimum per-category score required to pass. Defaults to 100 for each named category. */
  thresholds?: LighthouseThresholds;

  /**
   * Save the lighthouse report to disk in the given format(s). Pass a string for one format,
   * an array for several. The file is named with a timestamp unless `reportName` is set.
   */
  saveReport?: LighthouseReportFormat | LighthouseReportFormat[];

  /** Directory to write reports into. Defaults to `<cwd>/lighthouse`. */
  outputDir?: string;

  /** Base file name for saved reports. Defaults to `lighthouse-<timestamp>`. */
  reportName?: string;

  /** Throw on threshold failures (instead of returning `passed: false`). Convenient for tests that should hard-fail. */
  throwOnFail?: boolean;

  /** Lighthouse runner flags. `port` is overridden by the value resolved from `page`/`port`. */
  flags?: LH.Flags;

  /** Custom Lighthouse config. */
  config?: LH.Config;
};

/** Shape returned by {@link audit} and the `lighthouse` fixture. */
export type LighthouseResult = {
  /** True when every threshold passed. */
  passed: boolean;

  /** Per-category integer scores (0–100). */
  scores: Partial<Record<LighthouseCategory, number>>;

  /** Human-readable per-category failure descriptions. Empty when `passed`. */
  failures: string[];

  /** Human-readable per-category pass descriptions. */
  successes: string[];

  /** Absolute paths of reports written when `saveReport` was set. Empty array otherwise. */
  reportPaths: string[];

  /** Full Lighthouse runner result for arbitrary downstream inspection. */
  lhr: LH.Result;
};

/** Signature of the `lighthouse` test fixture. */
export type LighthouseFixture = (options?: LighthouseOptions) => Promise<LighthouseResult>;

/** Fixtures contributed by `lighthouseTest`. */
export type LighthouseTestArgs = {
  lighthouse: LighthouseFixture;
};

/** Worker-scoped fixtures contributed by `lighthouseTest`. */
export type LighthouseWorkerArgs = {
  lighthousePort: number;
};

export type { Page, LH };
