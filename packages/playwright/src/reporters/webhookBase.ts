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

import { detectCI  } from './ciAdapter';
import type { CIMetadata } from './ciAdapter';

import type { ReporterV2 } from './reporterV2';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '../../types/testReporter';

export type WebhookMode = 'per-test' | 'summary' | 'both';

export type WebhookReporterOptions = {
  webhookUrl?: string;
  mode?: WebhookMode;
  branchFilter?: string;
  mention?: string[];
  dryRun?: boolean;
};

export type FailureSummary = {
  test: TestCase;
  result: TestResult;
  errorLine: string;
};

export type WebhookFormatterInput = {
  ci: CIMetadata;
  totals: { passed: number; failed: number; flaky: number; skipped: number };
  failures: FailureSummary[];
  mention?: string[];
  perTest?: { test: TestCase; result: TestResult };
};

export type WebhookFormatter = (input: WebhookFormatterInput) => unknown;

export abstract class WebhookReporterBase implements ReporterV2 {
  protected _config!: FullConfig;
  protected _suite!: Suite;
  protected _options: WebhookReporterOptions;
  private _ci: CIMetadata;
  private _failures: FailureSummary[] = [];
  private _pending: Promise<void>[] = [];
  private _passed = 0;
  private _failed = 0;
  private _flaky = 0;
  private _skipped = 0;

  constructor(options: WebhookReporterOptions = {}) {
    this._options = options;
    this._ci = detectCI();
  }

  abstract reporterName(): string;
  abstract formatSummary(input: WebhookFormatterInput): unknown;
  formatPerTest(input: WebhookFormatterInput): unknown { return this.formatSummary(input); }

  version(): 'v2' { return 'v2'; }
  printsToStdio() { return false; }

  onConfigure(config: FullConfig) { this._config = config; }
  onBegin(suite: Suite) { this._suite = suite; }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === 'passed')
      this._passed++;
    else if (result.status === 'skipped')
      this._skipped++;
    else
      this._failed++;

    if (result.status === 'passed' || result.status === 'skipped')
      return;

    const failure: FailureSummary = { test, result, errorLine: firstErrorLine(result) };
    this._failures.push(failure);

    const mode = this._options.mode ?? 'summary';
    if (mode === 'summary')
      return;
    if (!this._shouldFire())
      return;
    this._pending.push(this._send(this.formatPerTest({
      ci: this._ci,
      totals: this._totals(),
      failures: [failure],
      mention: this._options.mention,
      perTest: { test, result },
    })));
  }

  async onEnd(_result: FullResult) {
    for (const t of this._suite.allTests()) {
      if (t.outcome() === 'flaky')
        this._flaky++;
    }
    await Promise.allSettled(this._pending);
    const mode = this._options.mode ?? 'summary';
    if (mode === 'per-test')
      return;
    if (!this._shouldFire())
      return;
    await this._send(this.formatSummary({
      ci: this._ci,
      totals: this._totals(),
      failures: this._failures,
      mention: this._options.mention,
    }));
  }

  private _totals() {
    return { passed: this._passed, failed: this._failed, flaky: this._flaky, skipped: this._skipped };
  }

  private _shouldFire(): boolean {
    if (!this._options.webhookUrl && !this._options.dryRun)
      return false;
    if (this._options.branchFilter && this._ci.branch !== this._options.branchFilter)
      return false;
    return true;
  }

  private async _send(payload: unknown) {
    if (this._options.dryRun) {
      // eslint-disable-next-line no-restricted-properties
      process.stderr.write(`[${this.reporterName()}] dry-run payload:\n${JSON.stringify(payload, null, 2)}\n`);
      return;
    }
    if (!this._options.webhookUrl)
      return;
    // Reporters must never throw — a flaky webhook should not fail the test run.
    try {
      const response = await fetch(this._options.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok)
        // eslint-disable-next-line no-restricted-properties
        process.stderr.write(`[${this.reporterName()}] webhook responded ${response.status} ${response.statusText}\n`);
    } catch (e) {
      // eslint-disable-next-line no-restricted-properties
      process.stderr.write(`[${this.reporterName()}] webhook error: ${(e as Error).message}\n`);
    }
  }
}

function firstErrorLine(result: TestResult): string {
  const err = result.error || result.errors?.[0];
  if (!err?.message)
    return '';
  return err.message.split('\n').find(l => l.trim().length > 0) ?? '';
}
