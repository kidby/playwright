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

import path from 'path';

import { stripAnsiEscapes } from '@isomorphic/stringUtils';

import type { ReporterV2 } from './reporterV2';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '../../types/testReporter';

const DEFAULT_AREA = 'default';
const AREA_COLUMN_WIDTH = 20;
const TOTALS_COLUMN_WIDTH = 20;

export type ProductAreaInfo = {
  area?: string;
};

export type CatalogReporterOptions = {
  productAreaResolver?: (testFile: string) => ProductAreaInfo | undefined;
  quiet?: boolean;
};

type Bucket = {
  area: string;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  durations: number[];
};

type Stats = { p50: number; p90: number; p95: number };

class CatalogReporter implements ReporterV2 {
  private _config!: FullConfig;
  private _suite!: Suite;
  private _options: CatalogReporterOptions;
  private _byArea = new Map<string, Bucket>();
  private _printedLine = false;

  constructor(options: CatalogReporterOptions = {}) {
    this._options = options;
  }

  version(): 'v2' { return 'v2'; }
  printsToStdio() { return true; }

  onConfigure(config: FullConfig) { this._config = config; }
  onBegin(suite: Suite) { this._suite = suite; }

  onTestEnd(test: TestCase, result: TestResult) {
    const bucket = this._bucketFor(test);
    this._recordOutcome(bucket, test, result);
    if (!this._options.quiet)
      this._printTestLine(test, result);
  }

  async onEnd(result: FullResult) {
    if (this._printedLine)
      // eslint-disable-next-line no-restricted-properties
      process.stdout.write('\n');
    // eslint-disable-next-line no-restricted-properties
    process.stdout.write('Catalog summary\n');
    // eslint-disable-next-line no-restricted-properties
    process.stdout.write('═══════════════\n');
    const buckets = [...this._byArea.values()].sort((a, b) => a.area.localeCompare(b.area));
    for (const b of buckets) {
      const totals = `${b.passed}P ${b.failed}F ${b.flaky}Fk ${b.skipped}S`;
      const stats = computeStats(b.durations);
      // eslint-disable-next-line no-restricted-properties
      process.stdout.write(`  ${b.area.padEnd(AREA_COLUMN_WIDTH)} ${totals.padEnd(TOTALS_COLUMN_WIDTH)} p50=${stats.p50}ms  p90=${stats.p90}ms  p95=${stats.p95}ms\n`);
    }
    // eslint-disable-next-line no-restricted-properties
    process.stdout.write(`\nstatus: ${result.status}\n`);
  }

  private _bucketFor(test: TestCase): Bucket {
    const file = test.location?.file || '';
    const areaKey = this._options.productAreaResolver?.(file)?.area || DEFAULT_AREA;
    let bucket = this._byArea.get(areaKey);
    if (!bucket) {
      bucket = { area: areaKey, passed: 0, failed: 0, flaky: 0, skipped: 0, durations: [] };
      this._byArea.set(areaKey, bucket);
    }
    return bucket;
  }

  private _recordOutcome(bucket: Bucket, test: TestCase, result: TestResult) {
    if (result.status === 'skipped')
      bucket.skipped++;
    else if (test.outcome() === 'flaky' && result.retry > 0)
      bucket.flaky++;
    else if (result.status === 'passed')
      bucket.passed++;
    else
      bucket.failed++;
    bucket.durations.push(result.duration);
  }

  private _printTestLine(test: TestCase, result: TestResult) {
    const icon = result.status === 'passed' ? '✓'
      : result.status === 'skipped' ? '−'
        : test.outcome() === 'flaky' ? '⚠'
          : '✗';
    const title = test.titlePath().slice(1).join(' › ');
    const file = test.location?.file || '';
    const rel = file ? path.relative(this._config.rootDir, file) : '';
    const retryNote = result.retry > 0 ? ` (retry ${result.retry})` : '';
    const errorTag = result.error
      ? `\n     ${stripAnsiEscapes(result.error.message || '').split('\n').find(l => l.trim()) || ''}`
      : '';
    // eslint-disable-next-line no-restricted-properties
    process.stdout.write(`  ${icon}  ${title}  [${rel}]  ${result.duration}ms${retryNote}${errorTag}\n`);
    this._printedLine = true;
  }
}

function computeStats(durations: number[]): Stats {
  if (!durations.length)
    return { p50: 0, p90: 0, p95: 0 };
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.50),
    p90: percentile(sorted, 0.90),
    p95: percentile(sorted, 0.95),
  };
}

function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length)
    return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx];
}

export default CatalogReporter;
