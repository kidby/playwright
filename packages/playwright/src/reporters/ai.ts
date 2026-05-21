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

import { detectCI  } from './ciAdapter';
import { resolveOutputFile  } from './base';
import type { CIMetadata } from './ciAdapter';
import type { CommonReporterOptions } from './base';

import type { ReporterV2 } from './reporterV2';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '../../types/testReporter';

export type AIReporterOptions = {
  outputDir?: string;
  prompt?: string;
  jsonl?: boolean;
  markdown?: boolean;
};

const STREAM_CAP = 4000;
const FAILURE_ID_CAP = 200;

class AIReporter implements ReporterV2 {
  private _config!: FullConfig;
  private _suite!: Suite;
  private _options: AIReporterOptions;
  private _outputDir: string;
  private _ci: CIMetadata;
  private _resolvedPrompt: string | undefined;

  constructor(options: AIReporterOptions & CommonReporterOptions) {
    this._options = options;
    const configDir = options.configDir ?? process.cwd();
    const resolved = resolveOutputFile('AI', {
      ...options,
      fileName: 'index.md',
      default: { fileName: 'index.md', outputDir: 'playwright-report/ai' },
    });
    this._outputDir = resolved ? path.dirname(resolved.outputFile) : path.resolve(configDir, 'playwright-report/ai');
    this._ci = detectCI();
    this._resolvedPrompt = resolvePrompt(options.prompt, configDir);
  }

  version(): 'v2' { return 'v2'; }
  printsToStdio() { return false; }

  onConfigure(config: FullConfig) { this._config = config; }
  onBegin(suite: Suite) { this._suite = suite; }

  async onEnd(_result: FullResult) {
    const failures: FailureBriefing[] = [];
    for (const test of this._suite.allTests()) {
      const result = test.results[test.results.length - 1];
      if (!result)
        continue;
      const outcome = test.outcome();
      if (outcome === 'expected' || outcome === 'skipped')
        continue;
      failures.push(this._briefFailure(test, result));
    }
    try {
      fs.mkdirSync(this._outputDir, { recursive: true });
      if (this._options.markdown !== false) {
        for (const f of failures)
          fs.writeFileSync(path.join(this._outputDir, `${f.id}.md`), renderBriefing(f, this._resolvedPrompt), 'utf-8');
        fs.writeFileSync(path.join(this._outputDir, 'index.md'), renderIndex(failures, this._ci), 'utf-8');
      }
      if (this._options.jsonl !== false) {
        const jsonl = failures.map(f => JSON.stringify(f)).join('\n') + (failures.length ? '\n' : '');
        fs.writeFileSync(path.join(this._outputDir, 'failures.jsonl'), jsonl, 'utf-8');
      }
    } catch (e) {
      // eslint-disable-next-line no-restricted-properties
      process.stderr.write(`[ai] failed to write report: ${(e as Error).message}\n`);
    }
  }

  private _briefFailure(test: TestCase, result: TestResult): FailureBriefing {
    const titlePath = test.titlePath().slice(1);
    const errors = result.errors?.length ? result.errors : (result.error ? [result.error] : []);
    return {
      id: sanitiseId(titlePath.join('--') || test.id),
      title: test.title,
      titlePath,
      file: test.location?.file ? path.relative(this._config.rootDir, test.location.file) : '',
      line: test.location?.line,
      project: test.parent.project()?.name,
      tags: test.tags,
      retry: result.retry,
      durationMs: result.duration,
      status: result.status,
      errorMessages: errors.map(e => e.message || '').filter(Boolean),
      errorStacks: errors.map(e => e.stack || '').filter(Boolean),
      sourceFrame: errors[0]?.snippet,
      stdout: result.stdout.map(c => typeof c === 'string' ? c : c.toString()).join(''),
      stderr: result.stderr.map(c => typeof c === 'string' ? c : c.toString()).join(''),
      attachments: (result.attachments || []).map(a => ({
        name: a.name,
        contentType: a.contentType,
        path: a.path ? path.relative(this._config.rootDir, a.path) : undefined,
      })),
      ci: this._ci,
    };
  }
}

type FailureBriefing = {
  id: string;
  title: string;
  titlePath: string[];
  file: string;
  line?: number;
  project?: string;
  tags?: string[];
  retry: number;
  durationMs: number;
  status: string;
  errorMessages: string[];
  errorStacks: string[];
  sourceFrame?: string;
  stdout: string;
  stderr: string;
  attachments: { name: string; contentType: string; path?: string }[];
  ci: CIMetadata;
};

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

  if (f.attachments.length) {
    out.h2('Artifacts');
    for (const a of f.attachments)
      out.bullet(`${a.name} (${a.contentType})${a.path ? ` — \`${a.path}\`` : ''}`);
    out.blank();
  }

  renderHowToInvestigate(out, f);
  return out.toString();
}

// CLI hand-off block — the distinguishing feature of this reporter.
// Phrased as direct instructions to the LLM consuming the briefing.
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
