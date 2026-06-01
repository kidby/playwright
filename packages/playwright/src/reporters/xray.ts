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

import { preconnect } from '@utils/bunPreconnect';
import { shouldRunForBranch } from './branchFilter.js';

import type { BranchFilterOptions } from './branchFilter.js';
import type { ReporterV2 } from './reporterV2.js';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '../../types/testReporter';

const DEFAULT_TEST_KEY_PATTERN = '\\[(\\w+-\\d+)\\]';

type XrayOAuthCredentials = { clientId: string; clientSecret: string };
type XrayTokenCredentials = { token: string };
type XrayAuth = XrayOAuthCredentials | XrayTokenCredentials;
type XrayStatus = 'PASSED' | 'FAILED' | 'TODO' | 'EXECUTING';
type XrayTestEntry = { testKey: string; status: string; comment?: string; [k: string]: unknown };

export type XrayTestEntryContext = {
  testKey: string;
  test: TestCase;
  results: TestResult[];
};

export type XrayReporterOptions = BranchFilterOptions & {
  baseUrl?: string;
  auth?: XrayAuth;
  testPlan?: string;
  testExecutionKey?: string;
  testKeyPattern?: string;
  dryRun?: boolean;
  deduplicateByTestKey?: boolean;
  executionInfoBuilder?: (config: FullConfig | undefined) => Record<string, unknown>;
  testEntryBuilder?: (ctx: XrayTestEntryContext) => Record<string, unknown> | null;
  writeLocalResultFile?: string;
  authProvider?: () => Promise<Record<string, string>>;
};

class XrayReporter implements ReporterV2 {
  private _options: XrayReporterOptions;
  private _config: FullConfig | undefined;
  private _entries: XrayTestEntry[] = [];
  private _byKey = new Map<string, { test: TestCase; results: TestResult[] }>();
  private _keyRegex: RegExp;
  private _disabled: boolean;

  constructor(options: XrayReporterOptions = {}) {
    this._options = options;
    this._disabled = !shouldRunForBranch(options);
    this._keyRegex = new RegExp(options.testKeyPattern || DEFAULT_TEST_KEY_PATTERN);
    preconnect(options.baseUrl);
  }

  version(): 'v2' { return 'v2'; }
  printsToStdio() { return false; }

  onConfigure(config: FullConfig) { this._config = config; }
  onBegin(_suite: Suite) {}

  onTestEnd(test: TestCase, result: TestResult) {
    if (this._disabled)
      return;
    const match = test.title.match(this._keyRegex) || test.titlePath().join(' ').match(this._keyRegex);
    if (!match)
      return;
    const testKey = match[1] || match[0];

    if (this._options.deduplicateByTestKey) {
      const existing = this._byKey.get(testKey);
      if (existing)
        existing.results.push(result);
      else
        this._byKey.set(testKey, { test, results: [result] });
      return;
    }

    if (this._options.testEntryBuilder) {
      const entry = this._options.testEntryBuilder({ testKey, test, results: [result] });
      if (entry)
        this._entries.push(entry as XrayTestEntry);
      return;
    }

    this._entries.push({
      testKey,
      status: toXrayStatus(result.status),
      comment: result.error?.message?.split('\n')[0],
    });
  }

  async onEnd(_result: FullResult) {
    if (this._disabled)
      return;

    if (this._options.deduplicateByTestKey) {
      const builder = this._options.testEntryBuilder ?? defaultDedupBuilder;
      for (const [testKey, { test, results }] of this._byKey) {
        const entry = builder({ testKey, test, results });
        if (entry)
          this._entries.push(entry as XrayTestEntry);
      }
    }

    if (!this._entries.length)
      return;

    const info = this._options.executionInfoBuilder
      ? this._options.executionInfoBuilder(this._config)
      : {
        ...(this._options.testPlan && { testPlanKey: this._options.testPlan }),
        ...(this._options.testExecutionKey && { testExecutionKey: this._options.testExecutionKey }),
      };

    const payload: Record<string, unknown> = {};
    if (info && Object.keys(info).length > 0)
      payload.info = info;
    payload.tests = this._entries;

    if (this._options.writeLocalResultFile) {
      const { writeFileAtomic } = await import('./runtimeIO.js');
      try {
        await writeFileAtomic(this._options.writeLocalResultFile, JSON.stringify(payload, null, 2));
      } catch (e) {
        // eslint-disable-next-line no-restricted-properties
        process.stderr.write(`[xray] failed to write ${this._options.writeLocalResultFile}: ${(e as Error).message}\n`);
      }
    }

    if (this._options.dryRun) {
      // eslint-disable-next-line no-restricted-properties
      process.stderr.write(`[xray] dry-run payload:\n${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    if (!this._options.baseUrl)
      return;
    if (!this._options.auth && !this._options.authProvider)
      return;
    try {
      const headers = this._options.authProvider
        ? await this._options.authProvider()
        : await this._authHeaders(this._options.auth!);
      const response = await fetch(`${this._options.baseUrl}/api/v2/import/execution`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok)
        // eslint-disable-next-line no-restricted-properties
        process.stderr.write(`[xray] import responded ${response.status}\n`);
    } catch (e) {
      // eslint-disable-next-line no-restricted-properties
      process.stderr.write(`[xray] error: ${(e as Error).message}\n`);
    }
  }

  private async _authHeaders(auth: XrayAuth): Promise<Record<string, string>> {
    if ('token' in auth)
      return { Authorization: `Bearer ${auth.token}` };
    const response = await fetch(`${this._options.baseUrl}/api/v2/authenticate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: auth.clientId, client_secret: auth.clientSecret }),
    });
    if (!response.ok)
      throw new Error(`xray auth ${response.status}`);
    const token = (await response.text()).replace(/"/g, '');
    return { Authorization: `Bearer ${token}` };
  }
}

function toXrayStatus(status: TestResult['status']): XrayStatus {
  if (status === 'passed')
    return 'PASSED';
  if (status === 'skipped')
    return 'TODO';
  return 'FAILED';
}

function defaultDedupBuilder(ctx: XrayTestEntryContext): XrayTestEntry {
  const last = ctx.results[ctx.results.length - 1];
  return {
    testKey: ctx.testKey,
    status: toXrayStatus(last?.status ?? 'failed'),
    comment: last?.error?.message?.split('\n')[0],
  };
}

export default XrayReporter;
