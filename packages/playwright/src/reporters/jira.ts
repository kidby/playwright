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

const DESCRIPTION_BODY_CAP = 4000;
const REPORTER_LABEL = 'playwright';

type JiraIssueFields = {
  project: { key: string };
  summary: string;
  issuetype: { name: string };
  labels: string[];
  description: unknown;
  components?: { name: string }[];
  [k: string]: unknown;
};
type JiraIssuePayload = { fields: JiraIssueFields };
type JiraIssue = { key?: string; fields?: { summary?: string } };
type JiraSearchResponse = { issues?: JiraIssue[] };
type JiraAuth = { email: string; token: string };

export type JiraFailureContext = {
  test: TestCase;
  result: TestResult;
  isFlaky: boolean;
  ci: CIMetadata;
};

export type JiraReporterOptions = BranchFilterOptions & {
  baseUrl?: string;
  projectKey?: string;
  auth?: JiraAuth;
  issueType?: string;
  labels?: string[];
  productAreaMapper?: (testFile: string) => { area?: string; component?: string };
  githubBaseUrl?: string;
  enabled?: boolean;
  dryRun?: boolean;
  failedTicketPrefix?: string;
  flakyTicketPrefix?: string;
  summaryBuilder?: (ctx: JiraFailureContext) => string;
  descriptionBuilder?: (ctx: JiraFailureContext) => string | Record<string, unknown>;
  duplicateSearchStrategies?: (ctx: JiraFailureContext, summary: string) => string[];
  componentResolver?: (filePath: string) => string | undefined;
  areaLabelPrefix?: string;
  sourceBaseUrl?: string;
  transport?: (issues: JiraIssuePayload[]) => void | Promise<void>;
};

class JiraReporter implements ReporterV2 {
  private _options: JiraReporterOptions;
  private _ci: CIMetadata;
  private _failures: { test: TestCase; result: TestResult }[] = [];
  private _disabled: boolean;

  constructor(options: JiraReporterOptions = {}) {
    this._options = options;
    this._disabled = !shouldRunForBranch(options);
    this._ci = detectCI();
    preconnect(options.baseUrl);
  }

  version(): 'v2' { return 'v2'; }
  printsToStdio() { return false; }

  onConfigure(_config: FullConfig) {}
  onBegin(_suite: Suite) {}

  onTestEnd(test: TestCase, result: TestResult) {
    if (this._disabled)
      return;
    const outcome = test.outcome();
    if (outcome === 'expected' || outcome === 'skipped')
      return;
    const isLast = result.retry === test.retries;
    if (!isLast && outcome !== 'unexpected')
      return;
    this._failures.push({ test, result });
  }

  async onEnd(_result: FullResult) {
    if (this._disabled)
      return;

    const issues: JiraIssuePayload[] = [];
    for (const { test, result } of this._failures) {
      const isFlaky = test.outcome() === 'flaky';
      issues.push(this._buildIssue(test, result, isFlaky));
    }

    if (this._options.transport) {
      await this._options.transport(issues);
      return;
    }

    if (!this._options.enabled)
      return;
    if (!this._isConfigured())
      return;

    for (const issue of issues) {
      if (this._options.dryRun) {
        // eslint-disable-next-line no-restricted-properties
        process.stderr.write(`[jira] dry-run issue:\n${JSON.stringify(issue, null, 2)}\n`);
        continue;
      }
      const strategies = this._duplicateStrategies(issue.fields.summary);
      let exists: JiraIssue | undefined;
      for (const jql of strategies) {
        exists = await this._searchExisting(jql).catch(() => undefined);
        if (exists)
          break;
      }
      if (exists)
        continue;
      await this._createIssue(issue).catch(e =>
        // eslint-disable-next-line no-restricted-properties
        process.stderr.write(`[jira] create failed: ${(e as Error).message}\n`));
    }
  }

  private _duplicateStrategies(summary: string): string[] {
    const project = this._options.projectKey!;
    const escaped = summary.replace(/"/g, '\\"');
    const ctx = { summary } as unknown as JiraFailureContext;
    if (this._options.duplicateSearchStrategies)
      return this._options.duplicateSearchStrategies(ctx, summary);
    return [`project = "${project}" AND summary ~ "${escaped}" AND statusCategory != Done`];
  }

  private _isConfigured(): boolean {
    if (this._options.dryRun)
      return true;
    return !!(this._options.baseUrl && this._options.projectKey && this._options.auth);
  }

  private _buildIssue(test: TestCase, result: TestResult, isFlaky: boolean): JiraIssuePayload {
    const titlePath = test.titlePath().slice(1).join(' › ');
    const labels = [...(this._options.labels || []), REPORTER_LABEL];
    const area = this._options.productAreaMapper?.(test.location?.file || '');
    const areaPrefix = this._options.areaLabelPrefix ?? 'area:';
    if (area?.area)
      labels.push(`${areaPrefix}${area.area}`);

    const ctx: JiraFailureContext = { test, result, isFlaky, ci: this._ci };

    const summary = this._options.summaryBuilder
      ? this._options.summaryBuilder(ctx)
      : `${isFlaky ? (this._options.flakyTicketPrefix ?? '[Auto-Flaky]') : (this._options.failedTicketPrefix ?? '[Auto]')} ${titlePath}`;

    const description = this._options.descriptionBuilder
      ? this._options.descriptionBuilder(ctx)
      : this._renderDescription(test, result);

    const fields: JiraIssueFields = {
      project: { key: this._options.projectKey ?? '' },
      summary,
      issuetype: { name: this._options.issueType || 'Bug' },
      labels,
      description,
    };

    const componentName = this._options.componentResolver
      ? this._options.componentResolver(test.location?.file || '')
      : area?.component;
    if (componentName)
      fields.components = [{ name: componentName }];

    return { fields };
  }

  private _renderDescription(test: TestCase, result: TestResult): string {
    const err = result.errors?.[0] || result.error;
    const lines: string[] = [];
    lines.push(`*Test:* ${test.titlePath().slice(1).join(' › ')}`);
    lines.push(`*File:* ${test.location?.file}:${test.location?.line ?? '?'}`);
    if (this._ci.runUrl)
      lines.push(`*Run:* ${this._ci.runUrl}`);
    if (this._ci.branch)
      lines.push(`*Branch:* ${this._ci.branch}`);
    if (this._ci.sha)
      lines.push(`*Commit:* ${this._ci.sha}`);
    const sourceBaseUrl = this._options.sourceBaseUrl ?? this._options.githubBaseUrl;
    if (sourceBaseUrl && test.location?.file && this._ci.sha) {
      const rel = test.location.file.replace(/^.*\/(?=packages|tests|src|app|lib)/, '');
      lines.push(`*Source:* ${sourceBaseUrl}/blob/${this._ci.sha}/${rel}#L${test.location?.line ?? 1}`);
    }
    if (err)
      lines.push('', '{code}', (err.message || '').slice(0, DESCRIPTION_BODY_CAP), '{code}');

    return lines.join('\n');
  }

  private async _searchExisting(jql: string): Promise<JiraIssue | undefined> {
    const response = await fetch(`${this._options.baseUrl}/rest/api/3/search/jql`, {
      method: 'POST',
      headers: { ...this._authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ jql, fields: ['summary'], maxResults: 1 }),
    });
    if (!response.ok)
      return undefined;
    const data = await response.json() as JiraSearchResponse;
    return data.issues?.[0];
  }

  private async _createIssue(issue: JiraIssuePayload) {
    const response = await fetch(`${this._options.baseUrl}/rest/api/3/issue`, {
      method: 'POST',
      headers: { ...this._authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(issue),
    });
    if (!response.ok)
      throw new Error(`Jira create responded ${response.status}`);
  }

  private _authHeaders(): Record<string, string> {
    const { email, token } = this._options.auth!;
    return { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` };
  }
}

export default JiraReporter;
