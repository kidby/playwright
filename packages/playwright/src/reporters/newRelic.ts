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
import { detectCI  } from './ciAdapter.js';
import { shouldRunForBranch } from './branchFilter.js';

import type { BranchFilterOptions } from './branchFilter.js';
import type { CIMetadata } from './ciAdapter.js';

import type { ReporterV2 } from './reporterV2.js';
import type { FullConfig, FullResult, Suite, TestCase, TestResult } from '../../types/testReporter';

const DEFAULT_EVENT_TYPE = 'PlaywrightTestRun';
const INSIGHTS_ENDPOINT = {
  US: (accountId: string) => `https://insights-collector.newrelic.com/v1/accounts/${accountId}/events`,
  EU: (accountId: string) => `https://insights-collector.eu01.nr-data.net/v1/accounts/${accountId}/events`,
};

type Event = Record<string, unknown>;

export type NewRelicEventContext = {
  test: TestCase;
  result: TestResult;
  ci: CIMetadata;
};

export type NewRelicReportProcessorContext = {
  directory: string;
  ci: CIMetadata;
};

export type NewRelicReporterOptions = BranchFilterOptions & {
  ingestKey?: string;
  accountId?: string;
  region?: 'US' | 'EU';
  eventType?: string;
  flatten?: boolean;
  extraAttributes?: Record<string, string | number | boolean>;
  endpoint?: string;
  dryRun?: boolean;
  eventBuilder?: (ctx: NewRelicEventContext) => Event;
  reportProcessors?: Record<string, {
    directory: string;
    tag: string;
    process: (filePath: string, ctx: NewRelicReportProcessorContext) => Promise<Event[]>;
  }>;
  transport?: (events: Event[]) => void | Promise<void>;
  defaultAccountId?: string;
};

class NewRelicReporter implements ReporterV2 {
  private _options: NewRelicReporterOptions;
  private _events: Event[] = [];
  private _tagSet = new Set<string>();
  private _ci: CIMetadata;
  private _disabled: boolean;

  constructor(options: NewRelicReporterOptions = {}) {
    this._options = options;
    this._disabled = !shouldRunForBranch(options);
    this._ci = detectCI();
    preconnect(this._endpoint());
  }

  private _endpoint(): string | undefined {
    if (this._options.endpoint)
      return this._options.endpoint;
    const id = this._options.accountId ?? this._options.defaultAccountId;
    if (!id)
      return undefined;
    return INSIGHTS_ENDPOINT[this._options.region || 'US'](id);
  }

  version(): 'v2' { return 'v2'; }
  printsToStdio() { return false; }

  onConfigure(_config: FullConfig) {}
  onBegin(_suite: Suite) {}

  onTestEnd(test: TestCase, result: TestResult) {
    if (this._disabled)
      return;
    for (const tag of test.tags)
      this._tagSet.add(tag);
    const event = this._options.eventBuilder
      ? this._options.eventBuilder({ test, result, ci: this._ci })
      : this._buildEvent(test, result);
    this._events.push(event);
  }

  async onEnd(_result: FullResult) {
    if (this._disabled)
      return;

    if (this._options.reportProcessors) {
      for (const proc of Object.values(this._options.reportProcessors)) {
        if (!this._tagSet.has(proc.tag))
          continue;
        try {
          const files = await collectJsonFiles(proc.directory);
          for (const filePath of files) {
            const extra = await proc.process(filePath, { directory: proc.directory, ci: this._ci });
            for (const e of extra)
              this._events.push(e);
          }
        } catch (e) {
          // eslint-disable-next-line no-restricted-properties
          process.stderr.write(`[new-relic] processor ${proc.tag} failed: ${(e as Error).message}\n`);
        }
      }
    }

    if (this._options.transport) {
      await this._options.transport(this._events);
      return;
    }
    if (this._options.dryRun) {
      // eslint-disable-next-line no-restricted-properties
      process.stderr.write(`[new-relic] dry-run payload:\n${JSON.stringify(this._events, null, 2)}\n`);
      return;
    }
    if (!this._options.ingestKey || !this._events.length)
      return;
    const endpoint = this._endpoint();
    if (!endpoint)
      return;
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

async function collectJsonFiles(directory: string): Promise<string[]> {
  const { readdir, stat } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      const s = await stat(full);
      if (s.isDirectory())
        await walk(full);
      else if (name.endsWith('.json'))
        out.push(full);
    }
  }
  await walk(directory);
  return out;
}

export default NewRelicReporter;
