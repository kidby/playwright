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

import type { ReporterV2 } from './reporterV2';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '../../types/testReporter';

const DEFAULT_TEST_KEY_PATTERN = '\\[([A-Z]+-\\d+)\\]';

type XrayOAuthCredentials = { clientId: string; clientSecret: string };
type XrayTokenCredentials = { token: string };
type XrayAuth = XrayOAuthCredentials | XrayTokenCredentials;
type XrayStatus = 'PASSED' | 'FAILED' | 'TODO' | 'EXECUTING';
type XrayTestResult = { testKey: string; status: XrayStatus; comment?: string };

export type XrayReporterOptions = {
  baseUrl?: string;
  auth?: XrayAuth;
  testPlan?: string;
  testExecutionKey?: string;
  testKeyPattern?: string;
  dryRun?: boolean;
};

class XrayReporter implements ReporterV2 {
  private _options: XrayReporterOptions;
  private _results: XrayTestResult[] = [];
  private _keyRegex: RegExp;

  constructor(options: XrayReporterOptions = {}) {
    this._options = options;
    this._keyRegex = new RegExp(options.testKeyPattern || DEFAULT_TEST_KEY_PATTERN);
  }

  version(): 'v2' { return 'v2'; }
  printsToStdio() { return false; }

  onConfigure(_config: FullConfig) {}
  onBegin(_suite: Suite) {}

  onTestEnd(test: TestCase, result: TestResult) {
    const match = test.title.match(this._keyRegex) || test.titlePath().join(' ').match(this._keyRegex);
    if (!match)
      return;
    this._results.push({
      testKey: match[1] || match[0],
      status: toXrayStatus(result.status),
      comment: result.error?.message?.split('\n')[0],
    });
  }

  async onEnd(_result: FullResult) {
    if (!this._results.length)
      return;
    const payload = {
      info: {
        ...(this._options.testPlan && { testPlanKey: this._options.testPlan }),
        ...(this._options.testExecutionKey && { testExecutionKey: this._options.testExecutionKey }),
      },
      tests: this._results,
    };
    if (this._options.dryRun) {
      // eslint-disable-next-line no-restricted-properties
      process.stderr.write(`[xray] dry-run payload:\n${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    if (!this._options.baseUrl || !this._options.auth)
      return;
    try {
      const response = await fetch(`${this._options.baseUrl}/api/v2/import/execution`, {
        method: 'POST',
        headers: { ...(await this._authHeaders(this._options.auth)), 'content-type': 'application/json' },
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

export default XrayReporter;
