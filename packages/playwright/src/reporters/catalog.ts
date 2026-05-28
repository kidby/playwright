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

import { msToString } from '@isomorphic/formatUtils';
import { stripAnsiEscapes } from '@isomorphic/stringUtils';
import { getAsBooleanFromENV } from '@utils/env';

import { TerminalReporter } from './base.js';

import type { CommonReporterOptions, TerminalReporterOptions } from './base.js';
import type { FullResult, Suite, TestCase, TestError, TestResult } from '../../types/testReporter';

const DOES_NOT_SUPPORT_UTF8 = process.platform === 'win32'
  && process.env.TERM_PROGRAM !== 'vscode'
  && !process.env.WT_SESSION;

const SPINNER = DOES_NOT_SUPPORT_UTF8 ? ['>', ')', 'v', '<'] : ['|', '/', '-', '\\'];

const POSITIVE_MARK   = DOES_NOT_SUPPORT_UTF8 ? 'ok' : '✓';
const NEGATIVE_MARK   = DOES_NOT_SUPPORT_UTF8 ? 'x'  : '✘';
const TIMEDOUT_MARK   = 'T';
const SKIPPED_MARK    = '-';
const INTERRUPTED_MARK = '!';

const DEFAULT_AREA = 'default';
const AREA_COLUMN_WIDTH = 20;
const TOTALS_COLUMN_WIDTH = 20;
const DEFAULT_JIRA_PATTERN = /\[([A-Z]+-\d+)]/;
const DEFAULT_SLOW_TEST_MS = 20_000;
const HIGH_MEMORY_BYTES = 500 * 1024 * 1024;
const DURATION_REGRESSION = 0.1;
const INSIGHTS_BOX_MAX_WIDTH = 100;
const INSIGHTS_BOX_MIN_WIDTH = 60;

export type ProductAreaInfo = {
  area?: string;
};

export type CatalogReporterLinks = {
  jira?: string;
  source?: string;
  extras?: Record<string, string>;
};

export type CatalogReporterOptions = {
  productAreaResolver?: (testFile: string) => ProductAreaInfo | undefined;
  jira?: { baseUrl: string; ticketPattern?: RegExp };
  sourceBaseUrl?: string;
  linkResolver?: (test: TestCase) => CatalogReporterLinks | undefined;
  printFailuresInline?: boolean;
  slowTestThresholdMs?: number;
  showInsights?: boolean;
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

type MemoryDelta = { rss: number; heapUsed: number; external: number };

class CatalogReporter extends TerminalReporter {
  private _catalogOptions: CatalogReporterOptions;
  private _byArea = new Map<string, Bucket>();
  private _testRows = new Map<TestCase, number>();
  private _resultIndex = new Map<TestResult, string>();
  private _lastRow = 0;
  private _lastColumn = 0;
  private _needNewLine = false;
  private _spinnerIndex = 0;
  private _failureIndex = 0;
  private _previousDuration?: number;
  private _ticketPattern: RegExp;
  private _printFailuresInline: boolean;
  private _quiet: boolean;
  private _showInsights: boolean;
  private _slowThresholdMs: number;
  private _trackMemory: boolean;
  private _testMemory = new Map<string, { start: NodeJS.MemoryUsage; delta?: MemoryDelta }>();
  private _highMemoryTests: Array<{ test: TestCase; delta: MemoryDelta }> = [];
  private _printedAnyTestLine = false;

  constructor(options: CatalogReporterOptions & CommonReporterOptions & TerminalReporterOptions = {} as CommonReporterOptions) {
    super(options);
    this._catalogOptions = options;
    this._ticketPattern = options.jira?.ticketPattern ?? DEFAULT_JIRA_PATTERN;
    this._printFailuresInline = options.printFailuresInline !== false;
    this._quiet = getAsBooleanFromENV('PLAYWRIGHT_CATALOG_QUIET', options.quiet);
    this._showInsights = options.showInsights !== false;
    this._slowThresholdMs = options.slowTestThresholdMs ?? DEFAULT_SLOW_TEST_MS;
    this._trackMemory = getAsBooleanFromENV('PLAYWRIGHT_CATALOG_TRACK_MEMORY', false);
  }

  printsToStdio(): boolean {
    return true;
  }

  override onBegin(suite: Suite) {
    super.onBegin(suite);
    const startingMessage = this.generateStartingMessage();
    if (startingMessage) {
      this.writeLine(startingMessage);
      this.writeLine(this.screen.colors.dim('  Started at: ') + new Date().toUTCString());
      this.writeLine('');
    }

    const projects = new Map<string, number>();
    for (const t of suite.allTests()) {
      const proj = t.parent.project()?.name;
      if (proj)
        projects.set(proj, (projects.get(proj) ?? 0) + 1);
    }
    if (projects.size > 1) {
      this.writeLine(this.screen.colors.bold('Projects:'));
      for (const [name, count] of projects)
        this.writeLine('  ' + this.screen.colors.cyan(name) + this.screen.colors.dim(`: ${count} test${count === 1 ? '' : 's'}`));
      this.writeLine('');
    }
  }

  onTestBegin(test: TestCase, result: TestResult) {
    const index = String(this._resultIndex.size + 1);
    this._resultIndex.set(result, index);

    if (this._trackMemory)
      this._testMemory.set(this._testKey(test), { start: process.memoryUsage() });

    if (this._quiet || !this.screen.isTTY)
      return;

    this._maybeWriteNewLine();
    this._testRows.set(test, this._lastRow);
    const spinner = SPINNER[this._spinnerIndex];
    this._spinnerIndex = (this._spinnerIndex + 1) % SPINNER.length;
    const prefix = this._testPrefix(index, this.screen.colors.cyan(spinner));
    const line = this.screen.colors.dim(this.formatTestTitle(test)) + this._retrySuffix(result);
    this._appendLine(line, prefix);
  }

  override onStdOut(chunk: string | Buffer, test?: TestCase, result?: TestResult) {
    super.onStdOut(chunk, test, result);
    this._dumpToStdio(chunk, this.screen.stdout);
  }

  override onStdErr(chunk: string | Buffer, test?: TestCase, result?: TestResult) {
    super.onStdErr(chunk, test, result);
    this._dumpToStdio(chunk, this.screen.stderr);
  }

  private _dumpToStdio(chunk: string | Buffer, stream: NodeJS.WriteStream) {
    if (this.config.quiet || this._quiet)
      return;
    const text = chunk.toString('utf-8');
    this._updateLineCountForOutput(text);
    stream.write(chunk);
  }

  override onTestEnd(test: TestCase, result: TestResult) {
    super.onTestEnd(test, result);
    this._recordOutcome(test, result);
    this._captureMemory(test);

    if (!this._quiet)
      this._renderTestLine(test, result);

    const isFailure = result.status !== 'skipped' && result.status !== test.expectedStatus;
    if (this._printFailuresInline && isFailure)
      this._printInlineFailure(test);

    if (result.status === 'passed' && result.duration > this._slowThresholdMs) {
      this._maybeWriteNewLine();
      this.writeLine('  ' + this.screen.colors.yellow(`${INTERRUPTED_MARK} Slow test (${msToString(result.duration)})`));
    }

    this._surfaceConsoleErrors(result);
  }

  private _renderTestLine(test: TestCase, result: TestResult) {
    const index = this._resultIndex.get(result) || String(this._resultIndex.size + 1);
    const { mark, titleStyler } = this._statusStyle(test, result);

    let text = titleStyler(this.formatTestTitle(test)) + this._retrySuffix(result);
    if (result.status !== 'skipped') {
      const durStr = msToString(result.duration);
      const coloredDur = this._colorDuration(result.duration, durStr);
      text += ' ' + this.screen.colors.dim('(') + coloredDur + this.screen.colors.dim(')');
      this._previousDuration = result.duration;
    }

    const prefix = this._testPrefix(index, mark);

    if (this.screen.isTTY && this._testRows.has(test)) {
      this._updateLine(this._testRows.get(test)!, text, prefix);
      this._maybeWriteNewLine();
    } else {
      this._maybeWriteNewLine();
      this._appendLine(text, prefix);
    }
    this._printedAnyTestLine = true;

    this._printLinkLines(test);
    this._printMemoryLine(test);
  }

  private _printLinkLines(test: TestCase) {
    const links = this._resolveLinks(test);
    if (links.jira)
      this.writeLine('     ' + this.screen.colors.blue(links.jira));
    if (links.source)
      this.writeLine('     ' + this.screen.colors.dim(links.source));
    if (links.extras) {
      for (const [k, v] of Object.entries(links.extras))
        this.writeLine('     ' + this.screen.colors.dim(`${k}: `) + v);
    }
  }

  private _printMemoryLine(test: TestCase) {
    if (!this._trackMemory)
      return;
    const info = this._testMemory.get(this._testKey(test));
    if (!info?.delta)
      return;
    const { rss, heapUsed } = info.delta;
    this.writeLine('     ' + this.screen.colors.dim(`Memory: RSS ${formatBytes(rss)} | Heap ${formatBytes(heapUsed)}`));
    if (rss > HIGH_MEMORY_BYTES) {
      this.writeLine('     ' + this.screen.colors.yellow(`${INTERRUPTED_MARK} High memory usage`));
      this._highMemoryTests.push({ test, delta: info.delta });
    }
  }

  private _printInlineFailure(test: TestCase) {
    this._maybeWriteNewLine();
    const message = '\n' + this.formatFailure(test, ++this._failureIndex) + '\n';
    this._updateLineCountForOutput(message);
    this.screen.stdout.write(message);
  }

  private _surfaceConsoleErrors(result: TestResult) {
    const attachment = result.attachments?.find(a => a.name === 'console-errors.txt');
    if (!attachment?.body)
      return;
    const content = attachment.body.toString();
    this._maybeWriteNewLine();
    this.writeLine('     ' + this.screen.colors.yellow(`${INTERRUPTED_MARK} Console errors detected:`));
    for (const line of content.split('\n')) {
      if (line.trim())
        this.writeLine('       ' + this.screen.colors.yellow(line));
    }
  }

  private _captureMemory(test: TestCase) {
    if (!this._trackMemory)
      return;
    const info = this._testMemory.get(this._testKey(test));
    if (!info?.start)
      return;
    const end = process.memoryUsage();
    info.delta = {
      rss: end.rss - info.start.rss,
      heapUsed: end.heapUsed - info.start.heapUsed,
      external: end.external - info.start.external,
    };
  }

  override onError(error: TestError): void {
    super.onError(error);
    this._maybeWriteNewLine();
    const message = this.formatError(error).message + '\n';
    this._updateLineCountForOutput(message);
    this.screen.stdout.write(message);
  }

  override async onEnd(result: FullResult) {
    await super.onEnd(result);
    const { colors, stdout } = this.screen;

    if (this._printedAnyTestLine)
      stdout.write('\n');

    this._printAreaSummary();

    if (this._showInsights)
      this._printInsightsBox();

    this._printFlakyBlock();
    this._printHighMemoryBlock();

    stdout.write('\n');
    this.epilogue(!this._printFailuresInline);

    const statusColor = result.status === 'passed' ? colors.green
      : (result.status === 'failed' || result.status === 'timedout') ? colors.red
        : colors.yellow;
    stdout.write(`\nstatus: ${statusColor(result.status)}\n`);

    // Best-effort terminal bell so the user knows we're done.
    if (this.screen.isTTY)
      stdout.write('\x07');
  }

  private _printAreaSummary() {
    const { colors, stdout } = this.screen;
    stdout.write(colors.bold('Catalog summary') + '\n');
    stdout.write(colors.dim('═══════════════') + '\n');
    const buckets = [...this._byArea.values()].sort((a, b) => a.area.localeCompare(b.area));
    for (const b of buckets) {
      const totals = [
        b.passed > 0 ? colors.green(`${b.passed}P`) : colors.dim(`${b.passed}P`),
        b.failed > 0 ? colors.red(`${b.failed}F`) : colors.dim(`${b.failed}F`),
        b.flaky > 0 ? colors.yellow(`${b.flaky}Fk`) : colors.dim(`${b.flaky}Fk`),
        b.skipped > 0 ? colors.cyan(`${b.skipped}S`) : colors.dim(`${b.skipped}S`),
      ].join(' ');
      const stats = computeStats(b.durations);
      stdout.write(
          `  ${colors.bold(b.area).padEnd(AREA_COLUMN_WIDTH + ansiOverhead(colors.bold(b.area)))} ` +
          `${totals.padEnd(TOTALS_COLUMN_WIDTH + ansiOverhead(totals))} ` +
          colors.dim(`p50=${stats.p50}ms  p90=${stats.p90}ms  p95=${stats.p95}ms`) +
          '\n',
      );
    }
  }

  private _printInsightsBox() {
    const all = [...this._byArea.values()].flatMap(b => b.durations);
    if (!all.length)
      return;
    const { colors, stdout } = this.screen;
    const avg = all.reduce((a, b) => a + b, 0) / all.length;
    const median = percentile([...all].sort((a, b) => a - b), 0.5);
    const sorted = [...all].sort((a, b) => a - b);
    const p90 = percentile(sorted, 0.9);
    const p95 = percentile(sorted, 0.95);
    const variance = all.reduce((acc, cur) => acc + (cur - avg) ** 2, 0) / all.length;
    const stdDev = Math.sqrt(variance);
    const total = all.reduce((a, b) => a + b, 0);

    const width = Math.max(INSIGHTS_BOX_MIN_WIDTH, Math.min(this.screen.ttyWidth || INSIGHTS_BOX_MAX_WIDTH, INSIGHTS_BOX_MAX_WIDTH));
    if (this.screen.ttyWidth && this.screen.ttyWidth < INSIGHTS_BOX_MIN_WIDTH) {
      this._printInsightsPlain({ total, avg, median, p90, p95, variance, stdDev });
      return;
    }
    const horizontal = (ch: string) => colors.blue(ch.repeat(width - 1));
    const row = (text: string) => {
      const visible = stripAnsiEscapes(text).length;
      const pad = Math.max(0, width - visible - 2);
      return colors.blue('│') + ' ' + text + ' '.repeat(pad) + colors.blue('│');
    };

    stdout.write('\n' + colors.blue('┌') + horizontal('─') + colors.blue('┐') + '\n');
    stdout.write(row(colors.bold('Performance & Resource Metrics')) + '\n');
    stdout.write(colors.blue('├') + horizontal('─') + colors.blue('┤') + '\n');
    stdout.write(row(colors.bold('Runtime: ') + `Total ${msToString(total)} | Avg ${msToString(avg)} | Median ${msToString(median)}`) + '\n');
    stdout.write(row(colors.bold('Spread:  ') + `Variance ${variance.toFixed(0)} ms² | Std Dev ${msToString(stdDev)}`) + '\n');
    stdout.write(row(colors.bold('Percentiles: ') + `P90 ${msToString(p90)} | P95 ${msToString(p95)}`) + '\n');

    const insights = this._collectInsights({ median, p95 });
    stdout.write(colors.blue('├') + horizontal('─') + colors.blue('┤') + '\n');
    if (!insights.length) {
      stdout.write(row(colors.bold('Insights: ') + colors.green('All metrics within normal ranges.')) + '\n');
    } else {
      stdout.write(row(colors.bold('Insights')) + '\n');
      for (const insight of insights)
        stdout.write(row(colors.yellow('  • ' + insight)) + '\n');
    }
    stdout.write(colors.blue('└') + horizontal('─') + colors.blue('┘') + '\n');
  }

  private _printInsightsPlain(m: { total: number; avg: number; median: number; p90: number; p95: number; variance: number; stdDev: number }) {
    const { colors, stdout } = this.screen;
    stdout.write('\n' + colors.bold('Performance & Resource Metrics') + '\n');
    stdout.write(`  Total ${msToString(m.total)} | Avg ${msToString(m.avg)} | Median ${msToString(m.median)}\n`);
    stdout.write(`  Variance ${m.variance.toFixed(0)} ms² | Std Dev ${msToString(m.stdDev)}\n`);
    stdout.write(`  P90 ${msToString(m.p90)} | P95 ${msToString(m.p95)}\n`);
  }

  private _collectInsights(m: { median: number; p95: number }): string[] {
    const insights: string[] = [];
    if (m.median > 0 && m.p95 > 3 * m.median)
      insights.push('Test duration variance is high (P95 > 3× median).');
    if (this._trackMemory) {
      const mem = process.memoryUsage();
      if (mem.rss > HIGH_MEMORY_BYTES)
        insights.push(`High overall memory usage (RSS ${formatBytes(mem.rss)}).`);
      if (mem.heapTotal > 0 && mem.heapUsed / mem.heapTotal > 0.9)
        insights.push('Heap utilization >90%. GC pressure may affect performance.');
      if (this._highMemoryTests.length > 0)
        insights.push(`${this._highMemoryTests.length} tests exceeded ${formatBytes(HIGH_MEMORY_BYTES)} RSS delta.`);
    }
    return insights;
  }

  private _printFlakyBlock() {
    const flaky = this.generateSummary().flaky;
    if (!flaky.length)
      return;
    const { colors, stdout } = this.screen;
    stdout.write('\n' + colors.yellow(`${INTERRUPTED_MARK} Found ${flaky.length} flaky test${flaky.length === 1 ? '' : 's'}:`) + '\n');
    for (const test of flaky) {
      stdout.write('  ' + colors.yellow(this.formatTestTitle(test)) + '\n');
      const rel = path.relative(this.config.rootDir, test.location?.file || '');
      if (rel)
        stdout.write('    ' + colors.dim(rel + ':' + test.location?.line) + '\n');
      const links = this._resolveLinks(test);
      if (links.jira)
        stdout.write('    ' + colors.blue(links.jira) + '\n');
      if (links.source)
        stdout.write('    ' + colors.dim(links.source) + '\n');
    }
  }

  private _printHighMemoryBlock() {
    if (!this._trackMemory || !this._highMemoryTests.length)
      return;
    const { colors, stdout } = this.screen;
    stdout.write('\n' + colors.yellow(`${INTERRUPTED_MARK} High memory tests (>${formatBytes(HIGH_MEMORY_BYTES)} RSS):`) + '\n');
    for (const { test, delta } of this._highMemoryTests) {
      stdout.write('  ' + colors.yellow(this.formatTestTitle(test)) + colors.dim(` (RSS ${formatBytes(delta.rss)}, Heap ${formatBytes(delta.heapUsed)})`) + '\n');
      const rel = path.relative(this.config.rootDir, test.location?.file || '');
      if (rel)
        stdout.write('    ' + colors.dim(rel + ':' + test.location?.line) + '\n');
    }
  }

  private _recordOutcome(test: TestCase, result: TestResult) {
    const bucket = this._bucketFor(test);
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

  private _bucketFor(test: TestCase): Bucket {
    const file = test.location?.file || '';
    const areaKey = this._catalogOptions.productAreaResolver?.(file)?.area || DEFAULT_AREA;
    let bucket = this._byArea.get(areaKey);
    if (!bucket) {
      bucket = { area: areaKey, passed: 0, failed: 0, flaky: 0, skipped: 0, durations: [] };
      this._byArea.set(areaKey, bucket);
    }
    return bucket;
  }

  private _resolveLinks(test: TestCase): CatalogReporterLinks {
    const override = this._catalogOptions.linkResolver?.(test);
    if (override)
      return override;
    const links: CatalogReporterLinks = {};
    if (this._catalogOptions.jira) {
      const ticket = this._extractTicket(test.title) ?? this._extractTicket(test.titlePath().join(' '));
      if (ticket)
        links.jira = joinUrl(this._catalogOptions.jira.baseUrl, ticket);
    }
    if (this._catalogOptions.sourceBaseUrl && test.location?.file) {
      const rel = path.relative(this.config.rootDir, test.location.file);
      if (rel)
        links.source = joinUrl(this._catalogOptions.sourceBaseUrl, rel) + '#L' + test.location.line;
    }
    return links;
  }

  private _extractTicket(title: string): string | undefined {
    const m = title.match(this._ticketPattern);
    return m ? m[1] : undefined;
  }

  private _statusStyle(test: TestCase, result: TestResult): { mark: string; titleStyler: (s: string) => string } {
    const { colors } = this.screen;
    if (result.status === 'skipped')
      return { mark: colors.cyan(SKIPPED_MARK), titleStyler: colors.cyan };
    if (result.status === 'interrupted')
      return { mark: colors.yellow(INTERRUPTED_MARK), titleStyler: colors.yellow };
    if (result.status === 'timedOut')
      return { mark: colors.red(TIMEDOUT_MARK), titleStyler: colors.red };
    const positive = result.status === test.expectedStatus;
    return positive
      ? { mark: colors.green(POSITIVE_MARK), titleStyler: (s: string) => s }
      : { mark: colors.red(NEGATIVE_MARK), titleStyler: colors.red };
  }

  private _colorDuration(duration: number, formatted: string): string {
    const { colors } = this.screen;
    if (this._previousDuration === undefined || this._previousDuration === 0)
      return colors.dim(formatted);
    const change = (duration - this._previousDuration) / this._previousDuration;
    if (change > DURATION_REGRESSION)
      return colors.red(formatted);
    return colors.dim(formatted);
  }

  private _testKey(test: TestCase): string {
    return test.titlePath().join(' › ');
  }

  private _testPrefix(index: string, statusMark: string): string {
    const statusMarkLength = stripAnsiEscapes(statusMark).length;
    const indexLength = Math.ceil(Math.log10(this.totalTestCount + 1));
    return '  ' + statusMark + ' '.repeat(Math.max(1, 3 - statusMarkLength)) + this.screen.colors.dim(index.padStart(indexLength) + ' ');
  }

  private _retrySuffix(result: TestResult): string {
    return result.retry ? this.screen.colors.yellow(` (retry #${result.retry})`) : '';
  }

  private _maybeWriteNewLine() {
    if (this._needNewLine) {
      this._needNewLine = false;
      this.screen.stdout.write('\n');
      ++this._lastRow;
      this._lastColumn = 0;
    }
  }

  private _updateLineCountForOutput(text: string) {
    this._needNewLine = text[text.length - 1] !== '\n';
    if (!this.screen.ttyWidth)
      return;
    for (const ch of text) {
      if (ch === '\n') {
        this._lastColumn = 0;
        ++this._lastRow;
        continue;
      }
      ++this._lastColumn;
      if (this._lastColumn > this.screen.ttyWidth) {
        this._lastColumn = 0;
        ++this._lastRow;
      }
    }
  }

  private _appendLine(text: string, prefix: string) {
    const line = prefix + this.fitToScreen(text, prefix);
    if (process.env.PW_TEST_DEBUG_REPORTERS) {
      this.screen.stdout.write('#' + this._lastRow + ' : ' + line + '\n');
    } else {
      this.screen.stdout.write(line);
      this.screen.stdout.write('\n');
    }
    ++this._lastRow;
    this._lastColumn = 0;
  }

  private _updateLine(row: number, text: string, prefix: string) {
    const line = prefix + this.fitToScreen(text, prefix);
    if (process.env.PW_TEST_DEBUG_REPORTERS)
      this.screen.stdout.write('#' + row + ' : ' + line + '\n');
    else
      this._updateLineForTTY(row, line);
  }

  private _updateLineForTTY(row: number, line: string) {
    if (row !== this._lastRow)
      this.screen.stdout.write(`[${this._lastRow - row}A`);
    this.screen.stdout.write('[2K[0G');
    this.screen.stdout.write(line);
    if (row !== this._lastRow)
      this.screen.stdout.write(`[${this._lastRow - row}E`);
  }
}

function ansiOverhead(s: string): number {
  return s.length - stripAnsiEscapes(s).length;
}

function computeStats(durations: number[]): Stats {
  if (!durations.length)
    return { p50: 0, p90: 0, p95: 0 };
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
  };
}

function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length)
    return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx];
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes))
    return '0 B';
  const abs = Math.abs(bytes);
  if (abs < 1024)
    return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (Math.abs(value) >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(2)} ${units[i]}`;
}

function joinUrl(base: string, suffix: string): string {
  if (!base)
    return suffix;
  if (base.endsWith('/'))
    return base + suffix;
  return base + '/' + suffix;
}

export default CatalogReporter;
