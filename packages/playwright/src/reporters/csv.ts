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
import { resolveOutputFile  } from './base.js';
import { shouldRunForBranch } from './branchFilter.js';
import { writeFileAtomic } from './runtimeIO.js';
import type { BranchFilterOptions } from './branchFilter.js';
import type { CommonReporterOptions } from './base.js';

import type { ReporterV2 } from './reporterV2.js';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '../../types/testReporter';

export type CsvColumn = {
  name: string;
  value: (test: TestCase, result: TestResult | undefined) => string;
};

export type CsvReporterOptions = BranchFilterOptions & {
  outputFile?: string;
  outputDir?: string;
  ticketPattern?: string;
  noHeader?: boolean;
  columns?: CsvColumn[];
  cleanTitle?: (title: string) => string;
  unitConverter?: { duration?: (ms: number) => string };
  trailingNewline?: boolean;
  escape?: boolean;
};

const DEFAULT_HEADER = ['file', 'project', 'title', 'fullTitle', 'status', 'durationMs', 'retries', 'ticketId', 'error'] as const;
type DefaultColumn = typeof DEFAULT_HEADER[number];

class CSVReporter implements ReporterV2 {
  private _config!: FullConfig;
  private _suite!: Suite;
  private _resolvedOutputFile: string | undefined;
  private _ticketRegex: RegExp | undefined;
  private _noHeader: boolean;
  private _disabled: boolean;
  private _columns: CsvColumn[] | undefined;
  private _cleanTitle: ((title: string) => string) | undefined;
  private _durationFormat: ((ms: number) => string) | undefined;
  private _trailingNewline: boolean;
  private _escape: boolean;
  private _rows = new Map<string, string>();

  constructor(options: CsvReporterOptions & CommonReporterOptions) {
    this._disabled = !shouldRunForBranch(options);
    this._resolvedOutputFile = resolveOutputFile('CSV', {
      ...options,
      default: { fileName: 'results.csv', outputDir: 'playwright-report' },
    })?.outputFile;
    this._ticketRegex = options.ticketPattern ? new RegExp(options.ticketPattern) : undefined;
    this._noHeader = !!options.noHeader;
    this._columns = options.columns;
    this._cleanTitle = options.cleanTitle;
    this._durationFormat = options.unitConverter?.duration;
    this._trailingNewline = options.trailingNewline ?? true;
    this._escape = options.escape ?? true;
  }

  version(): 'v2' { return 'v2'; }
  printsToStdio() { return !this._disabled && !this._resolvedOutputFile; }

  onConfigure(config: FullConfig) { this._config = config; }
  onBegin(suite: Suite) { this._suite = suite; }

  onTestEnd(test: TestCase, result: TestResult) {
    if (this._disabled)
      return;
    this._rows.set(test.id || test.titlePath().join('|'), this._renderRow(test, result));
  }

  async onEnd(_result: FullResult) {
    if (this._disabled)
      return;
    const lines: string[] = [];
    if (!this._noHeader)
      lines.push(this._headerLine());

    if (this._rows.size > 0) {
      for (const row of this._rows.values())
        lines.push(row);
    } else {
      for (const test of this._suite.allTests())
        lines.push(this._renderRow(test, lastResult(test)));
    }

    const output = lines.join('\n') + (this._trailingNewline ? '\n' : '');
    if (!this._resolvedOutputFile) {
      // eslint-disable-next-line no-restricted-properties
      process.stdout.write(output);
      return;
    }
    try {
      await writeFileAtomic(this._resolvedOutputFile, output);
    } catch (e) {
      // eslint-disable-next-line no-restricted-properties
      process.stderr.write(`[csv] failed to write ${this._resolvedOutputFile}: ${(e as Error).message}\n`);
    }
  }

  private _headerLine(): string {
    const names = this._columns ? this._columns.map(c => c.name) : [...DEFAULT_HEADER];
    return names.map(n => this._escapeValue(n)).join(',');
  }

  private _renderRow(test: TestCase, result: TestResult | undefined): string {
    if (this._columns)
      return this._columns.map(c => this._escapeValue(c.value(test, result) ?? '')).join(',');
    return this._serializeDefaultRow({
      file: relativeFile(test.location?.file, this._config?.rootDir),
      project: test.parent.project()?.name || '',
      title: this._title(test.title),
      fullTitle: test.titlePath().slice(1).map(t => this._title(t)).join(' › '),
      status: result?.status ?? 'unknown',
      durationMs: this._duration(result?.duration ?? 0),
      retries: String(result?.retry ?? 0),
      ticketId: this._extractTicket(test),
      error: result?.error ? errorOneLiner(result.error.message || '') : '',
    });
  }

  private _serializeDefaultRow(row: Record<DefaultColumn, string>): string {
    return DEFAULT_HEADER.map(col => this._escapeValue(row[col])).join(',');
  }

  private _escapeValue(value: string): string {
    if (!this._escape)
      return value ?? '';
    return csvEscape(value ?? '');
  }

  private _title(value: string): string {
    return this._cleanTitle ? this._cleanTitle(value) : value;
  }

  private _duration(ms: number): string {
    return this._durationFormat ? this._durationFormat(ms) : String(ms);
  }

  private _extractTicket(test: TestCase): string {
    if (!this._ticketRegex)
      return '';
    const match = test.title.match(this._ticketRegex) || test.titlePath().join(' ').match(this._ticketRegex);
    return match ? (match[1] ?? match[0] ?? '') : '';
  }
}

function lastResult(test: TestCase): TestResult | undefined {
  return test.results[test.results.length - 1];
}

function relativeFile(file: string | undefined, rootDir: string | undefined): string {
  if (!file)
    return '';
  if (!rootDir)
    return file;
  const rel = path.relative(rootDir, file);
  return rel.startsWith('..') ? file : rel;
}

function errorOneLiner(message: string): string {
  return stripAnsiEscapes(message).split('\n').find(l => l.trim().length > 0) ?? '';
}

// RFC 4180: quote when the field contains comma, quote, CR or LF; escape embedded quotes by doubling.
function csvEscape(value: string): string {
  if (!value)
    return '';
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export default CSVReporter;
