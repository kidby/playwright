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

import fs from 'fs';
import path from 'path';

import { detectCI  } from './ciAdapter.js';
import { resolveOutputFile  } from './base.js';
import { shouldRunForBranch } from './branchFilter.js';
import { writeFileAtomic } from './runtimeIO.js';
import type { BranchFilterOptions } from './branchFilter.js';
import type { CIMetadata } from './ciAdapter.js';
import type { CommonReporterOptions } from './base.js';

import type { ReporterV2 } from './reporterV2.js';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '../../types/testReporter';

export type ConsoleError = { type: 'error' | 'warning'; message: string; timestamp?: string };
export type NetworkError = { url: string; status: number; method?: string; category: '4xx' | '5xx' | 'timeout' | 'dns' | 'other' };
export type FlakinessData = { failCount: number; passCount: number; flakinessFactor: number; isFlaky: boolean; flakinessPercentage: number };
export type MemoryUsageData = { startRSS: number; endRSS: number; deltaRSS: number; deltaHeap: number; deltaExternal: number; isHighMemory: boolean; possibleLeak: boolean };
export type PerformanceData = { duration: number; isSlowTest: boolean; isVerySlowTest: boolean; deviationFromMedian?: number };
export type SourceContext = { code: string; startLine: number; endLine: number; errorLine: number };

export type AIReporterOptions = BranchFilterOptions & {
  outputDir?: string;
  prompt?: string;
  jsonl?: boolean;
  markdown?: boolean;
  includeConsoleErrorsInPassing?: boolean;
  captureNetworkErrors?: boolean;
  trackMemory?: boolean;
  highMemoryThreshold?: number;
  slowTestThreshold?: number;
  ticketPattern?: string;
  productAreaMapper?: (filePath: string) => string;
  sourceBaseUrl?: string;
  sourceBranch?: string;
  summaryFile?: string;
  briefingFormatter?: (briefing: FailureBriefing) => string;
  summaryBuilder?: (briefings: FailureBriefing[]) => unknown;
  filenameBuilder?: (briefing: FailureBriefing) => string;
  extraFields?: (test: TestCase, result: TestResult, briefing: FailureBriefing) => Record<string, unknown>;
};

const STREAM_CAP = 4000;
const FAILURE_ID_CAP = 200;
const MOBILE_SNAPSHOT_CAP = 8000;
const MOBILE_SNAPSHOT_NAME = 'mobile-snapshot';
const MOBILE_SNAPSHOT_CONTENT_TYPE = 'application/x-yaml';
const DEFAULT_HIGH_MEMORY = 500 * 1024 * 1024;
const DEFAULT_SLOW_TEST = 20_000;

class AIReporter implements ReporterV2 {
  private _config!: FullConfig;
  private _suite!: Suite;
  private _options: AIReporterOptions;
  private _outputDir: string;
  private _ci: CIMetadata;
  private _resolvedPrompt: string | undefined;
  private _disabled: boolean;
  private _ticketRegex: RegExp | undefined;
  private _memory = new Map<string, { start: NodeJS.MemoryUsage; end?: NodeJS.MemoryUsage }>();
  private _logsByTest = new Map<string, string[]>();
  private _currentTestId: string | undefined;
  private _testDurations: number[] = [];

  constructor(options: AIReporterOptions & CommonReporterOptions) {
    this._options = options;
    this._disabled = !shouldRunForBranch(options);
    const configDir = options.configDir ?? process.cwd();
    const resolved = resolveOutputFile('AI', {
      ...options,
      fileName: 'index.md',
      default: { fileName: 'index.md', outputDir: 'playwright-report/ai' },
    });
    this._outputDir = resolved ? path.dirname(resolved.outputFile) : path.resolve(configDir, 'playwright-report/ai');
    this._ci = detectCI();
    this._resolvedPrompt = resolvePrompt(options.prompt, configDir);
    this._ticketRegex = options.ticketPattern ? new RegExp(options.ticketPattern) : /\[(QE-\d+|CON-\d+|AI-\d+)\]/;
  }

  version(): 'v2' { return 'v2'; }
  printsToStdio() { return false; }

  onConfigure(config: FullConfig) { this._config = config; }
  onBegin(suite: Suite) { this._suite = suite; }

  onTestBegin(test: TestCase, _result: TestResult): void {
    const id = testKey(test);
    this._currentTestId = id;
    if (this._options.trackMemory)
      this._memory.set(id, { start: process.memoryUsage() });
    this._logsByTest.set(id, []);
  }

  onStdOut(chunk: string | Buffer, test: TestCase | undefined, _result: TestResult | undefined): void {
    if (!test)
      return;
    const id = testKey(test);
    const arr = this._logsByTest.get(id) ?? [];
    arr.push(chunk.toString());
    this._logsByTest.set(id, arr);
  }

  onStdErr(chunk: string | Buffer, test: TestCase | undefined, _result: TestResult | undefined): void {
    if (!test)
      return;
    const id = testKey(test);
    const arr = this._logsByTest.get(id) ?? [];
    arr.push(`[STDERR] ${chunk.toString()}`);
    this._logsByTest.set(id, arr);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    if (this._disabled)
      return;
    const id = testKey(test);
    if (this._options.trackMemory) {
      const entry = this._memory.get(id);
      if (entry)
        entry.end = process.memoryUsage();
    }
    if (result.duration > 0)
      this._testDurations.push(result.duration);
  }

  async onEnd(_result: FullResult) {
    if (this._disabled)
      return;
    const medianDuration = computeMedian(this._testDurations);
    const briefings: FailureBriefing[] = [];
    for (const test of this._suite.allTests()) {
      const result = test.results[test.results.length - 1];
      if (!result)
        continue;
      const briefing = this._briefFailure(test, result, medianDuration);
      if (!this._shouldEmit(test, result, briefing))
        continue;
      briefings.push(briefing);
    }
    try {
      if (this._options.markdown !== false) {
        for (const f of briefings) {
          const fileName = this._options.filenameBuilder ? this._options.filenameBuilder(f) : `${f.id}.md`;
          const body = this._options.briefingFormatter
            ? this._options.briefingFormatter(f)
            : renderBriefing(f, this._resolvedPrompt);
          await writeFileAtomic(path.join(this._outputDir, fileName), body);
        }
        if (!this._options.briefingFormatter)
          await writeFileAtomic(path.join(this._outputDir, 'index.md'), renderIndex(briefings, this._ci));
      }
      if (this._options.summaryFile !== undefined) {
        const summary = this._options.summaryBuilder
          ? this._options.summaryBuilder(briefings)
          : { totalFailures: briefings.length, failures: briefings };
        await writeFileAtomic(path.join(this._outputDir, this._options.summaryFile), JSON.stringify(summary, null, 2));
      }
      if (this._options.jsonl !== false && !this._options.briefingFormatter) {
        const jsonl = briefings.map(f => JSON.stringify(f)).join('\n') + (briefings.length ? '\n' : '');
        await writeFileAtomic(path.join(this._outputDir, 'failures.jsonl'), jsonl);
      }
    } catch (e) {
      // eslint-disable-next-line no-restricted-properties
      process.stderr.write(`[ai] failed to write report: ${(e as Error).message}\n`);
    }
  }

  private _shouldEmit(test: TestCase, result: TestResult, briefing: FailureBriefing): boolean {
    const outcome = test.outcome();
    if (outcome === 'skipped')
      return false;
    if (outcome === 'unexpected' || outcome === 'flaky')
      return true;
    if (this._options.includeConsoleErrorsInPassing && briefing.hasConsoleErrors)
      return true;
    return false;
  }

  private _briefFailure(test: TestCase, result: TestResult, medianDuration: number): FailureBriefing {
    const titlePath = test.titlePath().slice(1);
    const errors = result.errors?.length ? result.errors : (result.error ? [result.error] : []);
    const attachments = result.attachments || [];
    const id = testKey(test);
    const logs = (this._logsByTest.get(id) || []).join('\n');
    const consoleErrors = extractConsoleErrors(logs);
    const networkErrors = this._options.captureNetworkErrors !== false ? extractNetworkErrors(logs) : [];
    const flakiness = analyzeFlakiness(test);
    const performance = analyzePerformance(result.duration, medianDuration, this._options.slowTestThreshold ?? DEFAULT_SLOW_TEST);
    const memoryUsage = this._options.trackMemory ? analyzeMemory(this._memory.get(id), this._options.highMemoryThreshold ?? DEFAULT_HIGH_MEMORY) : undefined;
    const filePath = test.location?.file ?? '';
    const sourceContext = filePath ? extractSourceContext(filePath, errors[0]) : undefined;
    const productArea = this._options.productAreaMapper ? this._options.productAreaMapper(filePath) : undefined;
    const jiraMatch = this._ticketRegex ? test.title.match(this._ticketRegex) : null;
    const status = result.status === 'timedOut' ? 'timedout' : flakiness.isFlaky ? 'flaky' : 'failed';

    const briefing: FailureBriefing = {
      id: sanitiseId(titlePath.join('--') || test.id),
      title: test.title,
      titlePath,
      file: test.location?.file ? path.relative(this._config.rootDir, test.location.file) : '',
      filePath,
      line: test.location?.line,
      lineNumber: test.location?.line,
      project: test.parent.project()?.name,
      tags: test.tags,
      retry: result.retry,
      retryCount: result.retry,
      durationMs: result.duration,
      duration: result.duration,
      status,
      errorMessage: errors[0]?.message ?? '',
      stackTrace: errors[0]?.stack ?? '',
      errorMessages: errors.map(e => e.message || '').filter(Boolean),
      errorStacks: errors.map(e => e.stack || '').filter(Boolean),
      sourceFrame: errors[0]?.snippet,
      stdout: result.stdout.map(c => typeof c === 'string' ? c : c.toString()).join(''),
      stderr: result.stderr.map(c => typeof c === 'string' ? c : c.toString()).join(''),
      logs,
      attachments: attachments.map(a => ({
        name: a.name,
        contentType: a.contentType,
        path: a.path ? path.relative(this._config.rootDir, a.path) : undefined,
      })),
      mobileSnapshot: readMobileSnapshot(attachments as Attachment[]),
      ci: this._ci,
      consoleErrors,
      hasConsoleErrors: consoleErrors.length > 0,
      networkErrors,
      networkErrorsByCategory: categorizeNetworkErrors(networkErrors),
      flakiness: flakiness.isFlaky ? flakiness : undefined,
      memoryUsage,
      sourceContext,
      productArea,
      performance,
      jiraTicket: jiraMatch ? (jiraMatch[1] ?? jiraMatch[0]) : undefined,
      annotations: test.annotations as FailureBriefing['annotations'],
      browserInfo: test.parent.project()?.name ?? '',
      date: new Date().toISOString(),
      screenshotPath: attachments.find(a => a.name === 'screenshot')?.path,
      videoPath: attachments.find(a => a.name === 'video')?.path,
      tracePath: attachments.find(a => a.name === 'trace')?.path,
    };
    if (this._options.extraFields) {
      const extra = this._options.extraFields(test, result, briefing);
      Object.assign(briefing, extra);
    }
    return briefing;
  }
}

export type FailureBriefing = {
  id: string;
  title: string;
  titlePath: string[];
  file: string;
  filePath: string;
  line?: number;
  lineNumber?: number;
  project?: string;
  tags?: string[];
  retry: number;
  retryCount: number;
  durationMs: number;
  duration: number;
  status: string;
  errorMessage: string;
  stackTrace: string;
  errorMessages: string[];
  errorStacks: string[];
  sourceFrame?: string;
  stdout: string;
  stderr: string;
  logs: string;
  attachments: { name: string; contentType: string; path?: string }[];
  mobileSnapshot?: string;
  ci: CIMetadata;
  consoleErrors: ConsoleError[];
  hasConsoleErrors: boolean;
  networkErrors: NetworkError[];
  networkErrorsByCategory: Record<string, number>;
  flakiness?: FlakinessData;
  memoryUsage?: MemoryUsageData;
  sourceContext?: SourceContext;
  productArea?: string;
  performance: PerformanceData;
  jiraTicket?: string;
  annotations?: ReadonlyArray<{ type: string; description?: string }>;
  browserInfo: string;
  date: string;
  screenshotPath?: string;
  videoPath?: string;
  tracePath?: string;
  [key: string]: unknown;
};

type Attachment = { name: string; contentType: string; body?: Buffer; path?: string };

function testKey(test: TestCase): string {
  return `${test.location?.file ?? ''}:${test.location?.line ?? 0}:${test.title}`;
}

function readMobileSnapshot(attachments: Attachment[]): string | undefined {
  const a = attachments.find(att =>
    att.name === MOBILE_SNAPSHOT_NAME || att.contentType === MOBILE_SNAPSHOT_CONTENT_TYPE,
  );
  if (!a)
    return undefined;
  let text: string | undefined;
  if (a.body)
    text = a.body.toString('utf-8');
  else if (a.path)
    try { text = fs.readFileSync(a.path, 'utf-8'); } catch { return undefined; }
  if (!text)
    return undefined;
  return text.length > MOBILE_SNAPSHOT_CAP
    ? text.slice(0, MOBILE_SNAPSHOT_CAP) + '\n# … truncated\n'
    : text;
}

function resolvePrompt(prompt: string | undefined, configDir: string): string | undefined {
  if (!prompt)
    return undefined;
  const isInline = prompt.includes('\n') || !prompt.endsWith('.md');
  if (isInline)
    return prompt;
  try {
    return fs.readFileSync(path.resolve(configDir, prompt), 'utf-8');
  } catch {
    return undefined;
  }
}

function sanitiseId(s: string): string {
  return s.replace(/[^a-z0-9-_]/gi, '_').slice(0, FAILURE_ID_CAP) || 'test';
}

function computeMedian(values: number[]): number {
  if (!values.length)
    return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function analyzeFlakiness(test: TestCase): FlakinessData {
  let failCount = 0;
  let passCount = 0;
  for (const r of test.results) {
    if (r.status === 'passed')
      passCount++;
    else if (r.status === 'failed' || r.status === 'timedOut')
      failCount++;
  }
  const total = failCount + passCount;
  return {
    failCount,
    passCount,
    flakinessFactor: total,
    isFlaky: passCount > 0 && failCount > 0,
    flakinessPercentage: total > 0 ? (failCount / total) * 100 : 0,
  };
}

function analyzePerformance(duration: number, median: number, slowThreshold: number): PerformanceData {
  return {
    duration,
    isSlowTest: duration > slowThreshold,
    isVerySlowTest: duration > 60_000,
    deviationFromMedian: median > 0 ? ((duration - median) / median) * 100 : undefined,
  };
}

function analyzeMemory(entry: { start: NodeJS.MemoryUsage; end?: NodeJS.MemoryUsage } | undefined, highThreshold: number): MemoryUsageData | undefined {
  if (!entry || !entry.end)
    return undefined;
  const deltaRSS = entry.end.rss - entry.start.rss;
  const deltaHeap = entry.end.heapUsed - entry.start.heapUsed;
  const deltaExternal = entry.end.external - entry.start.external;
  return {
    startRSS: entry.start.rss,
    endRSS: entry.end.rss,
    deltaRSS,
    deltaHeap,
    deltaExternal,
    isHighMemory: deltaRSS > highThreshold,
    possibleLeak: deltaHeap > highThreshold * 0.8,
  };
}

function extractConsoleErrors(logs: string): ConsoleError[] {
  const out: ConsoleError[] = [];
  if (!logs)
    return out;
  for (const line of logs.split('\n')) {
    const timestamp = new Date().toISOString();
    if (line.match(/\b(ERROR|Error|FAIL|Failed|Exception|Uncaught)\b/))
      out.push({ type: 'error', message: line.trim(), timestamp });
    if (line.match(/\b(WARNING|Warning|WARN|Deprecated)\b/))
      out.push({ type: 'warning', message: line.trim(), timestamp });
  }
  return out;
}

function extractNetworkErrors(logs: string): NetworkError[] {
  const out: NetworkError[] = [];
  if (!logs)
    return out;
  for (const line of logs.split('\n')) {
    const statusMatch = line.match(/\b(40[0-9]|50[0-9]|timeout|TIMEOUT|DNS|ECONNREFUSED)\b/i);
    const urlMatch = line.match(/https?:\/\/[^\s)'"]+/);
    const methodMatch = line.match(/\b(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/);
    if (!statusMatch || !urlMatch)
      continue;
    const statusText = statusMatch[1];
    let status = 0;
    let category: NetworkError['category'] = 'other';
    if (/timeout/i.test(statusText)) {
      category = 'timeout';
    } else if (/dns|econnrefused/i.test(statusText)) {
      category = 'dns';
    } else {
      status = parseInt(statusText, 10);
      if (status >= 400 && status < 500)
        category = '4xx';
      else if (status >= 500)
        category = '5xx';
    }
    out.push({ url: urlMatch[0], status, method: methodMatch ? methodMatch[1] : undefined, category });
  }
  return out;
}

function categorizeNetworkErrors(networkErrors: NetworkError[]): Record<string, number> {
  const categories: Record<string, number> = { '4xx': 0, '5xx': 0, timeout: 0, dns: 0, other: 0 };
  for (const e of networkErrors)
    categories[e.category] = (categories[e.category] || 0) + 1;
  return categories;
}

function extractSourceContext(filePath: string, error: { stack?: string } | undefined): SourceContext | undefined {
  if (!error?.stack)
    return undefined;
  const m = error.stack.match(/:(\d+):(\d+)/);
  if (!m)
    return undefined;
  const lineNumber = parseInt(m[1], 10);
  const columnNumber = parseInt(m[2], 10);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const startLine = Math.max(0, lineNumber - 4);
    const endLine = Math.min(lines.length - 1, lineNumber + 3);
    const out: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      const indicator = i === lineNumber - 1 ? '> ' : '  ';
      const lineNum = String(i + 1).padStart(4, ' ');
      out.push(`${indicator}${lineNum} | ${lines[i] || ''}`);
      if (i === lineNumber - 1 && columnNumber > 0) {
        const spaces = ' '.repeat(columnNumber - 1);
        out.push(`     | ${spaces}^`);
      }
    }
    return { code: out.join('\n'), startLine: startLine + 1, endLine: endLine + 1, errorLine: lineNumber };
  } catch {
    return undefined;
  }
}

function renderBriefing(f: FailureBriefing, prompt?: string): string {
  const out = new MarkdownBuilder();
  if (prompt)
    out.line(prompt.trim()).blank();
  out.h1(`Failure: ${f.titlePath.join(' › ')}`).blank();
  out.bullet(`**File:** \`${f.file}${f.line ? `:${f.line}` : ''}\``);
  if (f.project)
    out.bullet(`**Project:** ${f.project}`);
  if (f.tags?.length)
    out.bullet(`**Tags:** ${f.tags.join(', ')}`);
  out.bullet(`**Retry:** ${f.retry}`);
  out.bullet(`**Duration:** ${f.durationMs}ms`);
  out.bullet(`**Status:** ${f.status}`).blank();

  if (f.ci.provider !== 'unknown') {
    out.h2('CI').bullet(`Provider: ${f.ci.provider}`);
    if (f.ci.branch)
      out.bullet(`Branch: \`${f.ci.branch}\``);
    if (f.ci.sha)
      out.bullet(`Commit: \`${f.ci.sha}\``);
    if (f.ci.runUrl)
      out.bullet(`Run: ${f.ci.runUrl}`);
    if (f.ci.prUrl)
      out.bullet(`PR: ${f.ci.prUrl}`);
    out.blank();
  }

  if (f.errorMessages.length) {
    out.h2('Error');
    for (const m of f.errorMessages)
      out.code(m);
    out.blank();
  }

  if (f.sourceFrame)
    out.h2('Source frame').code(f.sourceFrame).blank();

  if (f.errorStacks.length) {
    out.line('<details><summary>Stack traces</summary>').blank();
    for (const s of f.errorStacks)
      out.code(s);
    out.blank().line('</details>').blank();
  }

  if (f.stdout || f.stderr) {
    out.h2('Console output');
    if (f.stdout)
      out.line('**stdout:**').code(trimTo(f.stdout, STREAM_CAP));
    if (f.stderr)
      out.line('**stderr:**').code(trimTo(f.stderr, STREAM_CAP));
    out.blank();
  }

  if (f.mobileSnapshot)
    out.h2('Mobile UI snapshot').line('```yaml').line(f.mobileSnapshot).line('```').blank();

  if (f.attachments.length) {
    out.h2('Artifacts');
    for (const a of f.attachments)
      out.bullet(`${a.name} (${a.contentType})${a.path ? ` — \`${a.path}\`` : ''}`);
    out.blank();
  }

  renderHowToInvestigate(out, f);
  return out.toString();
}

function renderHowToInvestigate(out: MarkdownBuilder, f: FailureBriefing): void {
  out.h2('How to investigate').blank();
  out.line(`Use Playwright's CLI to dig deeper. From the project root:`).blank();
  let step = 1;
  const trace = f.attachments.find(a => a.contentType === 'application/zip' && /trace/i.test(a.name));
  if (trace?.path) {
    out.line(`${step++}. **Inspect the trace** — interactive timeline with screenshots, network, console:`)
        .shellBlock(`npx playwright show-trace ${trace.path}`).blank();
  }
  out.line(`${step++}. **Open the HTML report** for full context across all tests in this run:`)
      .shellBlock('npx playwright show-report').blank();
  out.line(`${step++}. **Reproduce locally** with the same project + grep:`)
      .shellBlock(`npx playwright test ${f.file}${f.project ? ` --project=${f.project}` : ''} --grep ${JSON.stringify(f.title)}`).blank();
  out.line(`${step}. **Generate a selector** for any element involved (uses live recorder):`)
      .shellBlock('npx playwright codegen <url>').blank();
  out.line('Reporter source: `packages/playwright/src/reporters/ai.ts` — read this if the briefing fields below are unclear.');
}

function renderIndex(failures: FailureBriefing[], ci: CIMetadata): string {
  const out = new MarkdownBuilder();
  out.h1('Failure index').blank();
  if (ci.provider !== 'unknown')
    out.line(`Run on **${ci.provider}**${ci.branch ? ` (\`${ci.branch}\`)` : ''}${ci.runUrl ? ` — ${ci.runUrl}` : ''}`).blank();
  out.line(`${failures.length} failure${failures.length === 1 ? '' : 's'}.`).blank();
  if (failures.length === 0)
    return out.line('_No failures._').toString();
  out.line('| # | Title | File | Project |').line('|---|-------|------|---------|');
  failures.forEach((f, i) => {
    out.line(`| ${i + 1} | [${escapeMd(f.titlePath.join(' › '))}](./${f.id}.md) | \`${f.file}\` | ${f.project ?? ''} |`);
  });
  return out.blank().line('Start here, then dive into the linked per-failure briefing. Each briefing ends with a "How to investigate" block listing CLI commands to run.').toString();
}

function trimTo(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}\n... (truncated, ${s.length - max} chars)`;
}

function escapeMd(s: string): string {
  return s.replace(/\|/g, '\\|');
}

class MarkdownBuilder {
  private _lines: string[] = [];
  h1(text: string) { return this.line(`# ${text}`); }
  h2(text: string) { return this.line(`## ${text}`); }
  bullet(text: string) { return this.line(`- ${text}`); }
  line(text: string) { this._lines.push(text); return this; }
  blank() { this._lines.push(''); return this; }
  code(text: string) { return this.line('```').line(text).line('```'); }
  shellBlock(text: string) { return this.line('   ```sh').line(`   ${text}`).line('   ```'); }
  toString() { return this._lines.join('\n') + '\n'; }
}

export default AIReporter;
