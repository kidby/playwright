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

import { WebhookReporterBase   } from './webhookBase';
import type { WebhookFormatterInput, WebhookReporterOptions } from './webhookBase';

export type IntellumSocialReporterOptions = WebhookReporterOptions;

class IntellumSocialReporter extends WebhookReporterBase {
  reporterName() { return 'intellum-social'; }

  formatSummary(input: WebhookFormatterInput) {
    const { ci, totals, failures, perTest } = input;
    return {
      kind: perTest ? 'test-failure' : 'test-run',
      title: perTest
        ? `Failed: ${perTest.test.titlePath().slice(1).join(' › ')}`
        : `Test run: ${totals.passed} passed, ${totals.failed} failed`,
      body: failures.slice(0, 25).map(f => ({
        path: f.test.titlePath().slice(1),
        error: f.errorLine,
        retries: f.result.retry,
        durationMs: f.result.duration,
      })),
      meta: {
        provider: ci.provider,
        branch: ci.branch,
        sha: ci.sha,
        runUrl: ci.runUrl,
        jobName: ci.jobName,
        prNumber: ci.prNumber,
        prUrl: ci.prUrl,
        repo: ci.repo,
        totals,
      },
    };
  }
}

export default IntellumSocialReporter;
