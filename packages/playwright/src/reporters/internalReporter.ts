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

import { monotonicTime } from '@isomorphic/time';

import { internalScreen, prepareErrorStack, relativeFilePath } from './base.js';
import { Multiplexer } from './multiplexer.js';
import { test as testNs } from '../common/index.js';
import * as babel from '../transform/babelBundle.js';
import { wrapReporterAsV2 } from './reporterV2.js';

import type { AnyReporter, ReporterV2 } from './reporterV2.js';
import type { FullConfig, FullResult, TestCase, TestError, TestResult, TestStep, WorkerInfo } from '../../types/testReporter';


export class InternalReporter implements ReporterV2 {
  private _reporter: ReporterV2;
  private _didBegin = false;
  private _config!: FullConfig;
  private _startTime: Date | undefined;
  private _monotonicStartTime: number | undefined;

  constructor(reporters: AnyReporter[]) {
    this._reporter = new Multiplexer(reporters.map(wrapReporterAsV2));
  }

  version(): 'v2' {
    return 'v2';
  }

  onConfigure(config: FullConfig) {
    this._config = config;
    this._startTime = new Date();
    this._monotonicStartTime = monotonicTime();
    this._reporter.onConfigure?.(config);
  }

  onBegin(suite: testNs.Suite) {
    this._didBegin = true;
    this._reporter.onBegin?.(suite);
  }

  onTestBegin(test: TestCase, result: TestResult) {
    this._reporter.onTestBegin?.(test, result);
  }

  onStdOut(chunk: string | Buffer, test?: TestCase, result?: TestResult) {
    this._reporter.onStdOut?.(chunk, test, result);
  }

  onStdErr(chunk: string | Buffer, test?: TestCase, result?: TestResult) {
    this._reporter.onStdErr?.(chunk, test, result);
  }

  async onTestPaused(test: TestCase, result: TestResult) {
    this._addSnippetToTestErrors(test, result);
    return await this._reporter.onTestPaused?.(test, result);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    this._addSnippetToTestErrors(test, result);
    this._reporter.onTestEnd?.(test, result);
  }

  async onEnd(result: { status: FullResult['status'] }) {
    if (!this._didBegin) {
      // onBegin was not reported, emit it.
      this.onBegin(new testNs.Suite('', 'root'));
    }
    return await this._reporter.onEnd?.({
      ...result,
      startTime: this._startTime!,
      duration: monotonicTime() - this._monotonicStartTime!,
    });
  }

  async onExit() {
    await this._reporter.onExit?.();
  }

  onError(error: TestError, workerInfo?: WorkerInfo) {
    addLocationAndSnippetToError(this._config, error);
    this._reporter.onError?.(error, workerInfo);
  }

  onStepBegin(test: TestCase, result: TestResult, step: TestStep) {
    this._reporter.onStepBegin?.(test, result, step);
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep) {
    this._addSnippetToStepError(test, step);
    this._reporter.onStepEnd?.(test, result, step);
  }

  printsToStdio() {
    return this._reporter.printsToStdio ? this._reporter.printsToStdio() : true;
  }

  private _addSnippetToTestErrors(test: TestCase, result: TestResult) {
    for (const error of result.errors)
      addLocationAndSnippetToError(this._config, error, test.location.file);
  }

  private _addSnippetToStepError(test: TestCase, step: TestStep) {
    if (step.error)
      addLocationAndSnippetToError(this._config, step.error, test.location.file);
  }
}

// Bench (June 2026): without these caches, codeframe generation was ~40% of
// orchestrator CPU on a 127-test Bun bench — `readFileSync` 13.7% + the
// newline-split inside `babel.codeFrameColumns` 25.7%. The same source files
// + same locations get re-formatted for every error at every step. Three
// bounded caches keep the universe of unique entries small (a typical run
// touches <500 files / <2k unique locations) while preventing unbounded
// growth in long sessions.
const SOURCE_FILE_CACHE_LIMIT = 1024;
const REALPATH_CACHE_LIMIT = 1024;
const CODE_FRAME_CACHE_LIMIT = 4096;
const _sourceFileCache = new Map<string, string | null>();
const _realpathCache = new Map<string, string | null>();
const _codeFrameCache = new Map<string, string>();

function readSourceCached(file: string): string | null {
  const hit = _sourceFileCache.get(file);
  if (hit !== undefined)
    return hit;
  let value: string | null;
  try {
    value = fs.readFileSync(file, 'utf8');
  } catch {
    value = null;
  }
  if (_sourceFileCache.size >= SOURCE_FILE_CACHE_LIMIT)
    _sourceFileCache.clear();
  _sourceFileCache.set(file, value);
  return value;
}

function realpathCached(file: string): string | null {
  const hit = _realpathCache.get(file);
  if (hit !== undefined)
    return hit;
  let value: string | null;
  try {
    value = fs.realpathSync(file);
  } catch {
    value = null;
  }
  if (_realpathCache.size >= REALPATH_CACHE_LIMIT)
    _realpathCache.clear();
  _realpathCache.set(file, value);
  return value;
}

function codeFrameCached(source: string, location: { file: string; line: number; column?: number }): string {
  const key = `${location.file}:${location.line}:${location.column ?? 0}`;
  const hit = _codeFrameCache.get(key);
  if (hit !== undefined)
    return hit;
  const value = babel.codeFrameColumns(source, { start: location }, { highlightCode: true });
  if (_codeFrameCache.size >= CODE_FRAME_CACHE_LIMIT)
    _codeFrameCache.clear();
  _codeFrameCache.set(key, value);
  return value;
}

export function addLocationAndSnippetToError(config: FullConfig, error: TestError, file?: string) {
  if (error.stack && !error.location)
    error.location = prepareErrorStack(error.stack).location;
  const location = error.location;
  if (!location)
    return;

  if (!!error.snippet)
    return;

  // Defer the codeframe formatting until a reporter actually reads
  // `error.snippet`. The dispatcher pre-generated snippets on every
  // step-end / test-end even when the active reporter (e.g. `null` or `json`)
  // never touched them — bench (June 2026) showed this was ~40% of
  // orchestrator CPU under Bun on a passing 127-test workload. Reporters
  // that DO format error output (line, list, html, etc.) pay the same one-
  // shot cost on first read; the result is then memoized via defineProperty.
  Object.defineProperty(error, 'snippet', {
    configurable: true,
    enumerable: true,
    get: () => {
      const value = buildSnippet(config, location, file);
      Object.defineProperty(error, 'snippet', { value, configurable: true, enumerable: true, writable: true });
      return value;
    },
    set: (value: string | undefined) => {
      Object.defineProperty(error, 'snippet', { value, configurable: true, enumerable: true, writable: true });
    },
  });
}

function buildSnippet(config: FullConfig, location: { file: string; line: number; column?: number }, file: string | undefined): string | undefined {
  const source = readSourceCached(location.file);
  if (source === null)
    return undefined;
  try {
    const tokens = [];
    const codeFrame = codeFrameCached(source, location);
    // Convert /var/folders to /private/var/folders on Mac.
    if (!file || realpathCached(file) !== location.file) {
      tokens.push(internalScreen.colors.gray(`   at `) + `${relativeFilePath(internalScreen, config, location.file)}:${location.line}`);
      tokens.push('');
    }
    tokens.push(codeFrame);
    return tokens.join('\n');
  } catch (e) {
    // Failed to format codeframe — that's ok.
    return undefined;
  }
}
