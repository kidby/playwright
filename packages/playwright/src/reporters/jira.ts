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
  description: string;
  components?: { name: string }[];
};
type JiraIssuePayload = { fields: JiraIssueFields };
type JiraIssue = { key?: string; fields?: { summary?: string } };
type JiraSearchResponse = { issues?: JiraIssue[] };
type JiraAuth = { email: string; token: string };

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
    if (result.status === 'passed' || result.status === 'skipped')
      return;
    // outcome() reflects test-level resolution after retries — only act on terminal failures.
    if (test.outcome() === 'expected')
      return;
    this._failures.push({ test, result });
  }

  async onEnd(_result: FullResult) {
    if (this._disabled)
      return;
    if (!this._options.enabled)
      return;
    if (!this._isConfigured())
      return;

    for (const { test, result } of this._failures) {
      const issue = this._buildIssue(test, result);
      if (this._options.dryRun) {
        // eslint-disable-next-line no-restricted-properties
        process.stderr.write(`[jira] dry-run issue:\n${JSON.stringify(issue, null, 2)}\n`);
        continue;
      }
      const exists = await this._searchExisting(issue.fields.summary).catch(() => undefined);
      if (exists)
        continue;
      await this._createIssue(issue).catch(e =>
        // eslint-disable-next-line no-restricted-properties
        process.stderr.write(`[jira] create failed: ${(e as Error).message}\n`));
    }
  }

  private _isConfigured(): boolean {
    if (this._options.dryRun)
      return true;
    return !!(this._options.baseUrl && this._options.projectKey && this._options.auth);
  }

  private _buildIssue(test: TestCase, result: TestResult): JiraIssuePayload {
    const titlePath = test.titlePath().slice(1).join(' › ');
    // Consumer labels first so they sort first in Jira's UI.
    const labels = [...(this._options.labels || []), REPORTER_LABEL];
    const area = this._options.productAreaMapper?.(test.location?.file || '');
    if (area?.area)
      labels.push(`area:${area.area}`);
    const fields: JiraIssueFields = {
      project: { key: this._options.projectKey! },
      summary: `[Auto] ${titlePath}`,
      issuetype: { name: this._options.issueType || 'Bug' },
      labels,
      description: this._renderDescription(test, result),
    };
    if (area?.component)
      fields.components = [{ name: area.component }];
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
    if (this._options.githubBaseUrl && test.location?.file && this._ci.sha) {
      const rel = test.location.file.replace(/^.*\/(?=packages|tests|src|app|lib)/, '');
      lines.push(`*Source:* ${this._options.githubBaseUrl}/blob/${this._ci.sha}/${rel}#L${test.location?.line ?? 1}`);
    }
    if (err)
      lines.push('', '{code}', (err.message || '').slice(0, DESCRIPTION_BODY_CAP), '{code}');

    return lines.join('\n');
  }

  private async _searchExisting(summary: string): Promise<JiraIssue | undefined> {
    const escapedSummary = summary.replace(/"/g, '\\"');
    const jql = `project = "${this._options.projectKey}" AND summary ~ "${escapedSummary}" AND statusCategory != Done`;
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
