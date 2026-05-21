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

const DEFAULT_EVENT_TYPE = 'PlaywrightTestRun';
const INSIGHTS_ENDPOINT = {
  US: (accountId: string) => `https://insights-collector.newrelic.com/v1/accounts/${accountId}/events`,
  EU: (accountId: string) => `https://insights-collector.eu01.nr-data.net/v1/accounts/${accountId}/events`,
};

type Event = Record<string, unknown>;

export type NewRelicReporterOptions = {
  ingestKey?: string;
  accountId?: string;
  region?: 'US' | 'EU';
  eventType?: string;
  flatten?: boolean;
  extraAttributes?: Record<string, string | number | boolean>;
  endpoint?: string;
  dryRun?: boolean;
};

class NewRelicReporter implements ReporterV2 {
  private _options: NewRelicReporterOptions;
  private _events: Event[] = [];
  private _ci: CIMetadata;

  constructor(options: NewRelicReporterOptions = {}) {
    this._options = options;
    this._ci = detectCI();
  }

  version(): 'v2' { return 'v2'; }
  printsToStdio() { return false; }

  onConfigure(_config: FullConfig) {}
  onBegin(_suite: Suite) {}

  onTestEnd(test: TestCase, result: TestResult) {
    this._events.push(this._buildEvent(test, result));
  }

  async onEnd(_result: FullResult) {
    if (this._options.dryRun) {
      // eslint-disable-next-line no-restricted-properties
      process.stderr.write(`[new-relic] dry-run payload:\n${JSON.stringify(this._events, null, 2)}\n`);
      return;
    }
    if (!this._options.ingestKey || !this._options.accountId || !this._events.length)
      return;
    const endpoint = this._options.endpoint
      ?? INSIGHTS_ENDPOINT[this._options.region || 'US'](this._options.accountId);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Api-Key': this._options.ingestKey },
        body: JSON.stringify(this._events),
      });
      if (!response.ok)
        // eslint-disable-next-line no-restricted-properties
        process.stderr.write(`[new-relic] insights responded ${response.status}\n`);
    } catch (e) {
      // eslint-disable-next-line no-restricted-properties
      process.stderr.write(`[new-relic] error: ${(e as Error).message}\n`);
    }
  }

  private _buildEvent(test: TestCase, result: TestResult): Event {
    const event: Event = {
      eventType: this._options.eventType || DEFAULT_EVENT_TYPE,
      timestamp: Math.floor(Date.now() / 1000),
      testTitle: test.title,
      testFullTitle: test.titlePath().slice(1).join(' › '),
      testFile: test.location?.file,
      project: test.parent.project()?.name,
      status: result.status,
      durationMs: result.duration,
      retry: result.retry,
      ciProvider: this._ci.provider,
      ciBranch: this._ci.branch,
      ciSha: this._ci.sha,
      ciRunUrl: this._ci.runUrl,
      ciJob: this._ci.jobName,
      ...this._options.extraAttributes,
    };
    if (result.status === 'passed' || result.status === 'skipped')
      return event;
    const err = result.errors?.[0] || result.error;
    if (!err)
      return event;
    if (this._options.flatten !== false) {
      event.errorMessage = (err.message || '').split('\n')[0] || '';
      event.errorStack = err.stack;
    } else {
      event.errors = result.errors || [err];
    }
    return event;
  }
}

export default NewRelicReporter;
