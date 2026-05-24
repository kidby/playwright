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

import { WebhookReporterBase } from './webhookBase.js';
import type { WebhookFormatterInput, WebhookReporterOptions } from './webhookBase.js';

export type SlackReporterOptions = WebhookReporterOptions;

class SlackReporter extends WebhookReporterBase {
  reporterName() { return 'slack'; }

  formatSummary(input: WebhookFormatterInput) {
    const { ci, totals, failures, mention, perTest } = input;
    const branchSuffix = ci.branch ? ` on \`${ci.branch}\`` : '';
    const headline = perTest
      ? `:x: Test failed${branchSuffix}`
      : totals.failed
        ? `:rotating_light: ${plural(totals.failed, 'test')} failed${branchSuffix}`
        : `:white_check_mark: ${plural(totals.passed, 'test')} passed${branchSuffix}`;

    const mentionLine = mention?.length && totals.failed
      ? mention.map(m => m.startsWith('<') ? m : `<@${m}>`).join(' ') + '\n'
      : '';

    const ciLines: string[] = [];
    if (ci.jobName)
      ciLines.push(`*Job:* ${ci.jobName}`);
    if (ci.runUrl)
      ciLines.push(`*Run:* <${ci.runUrl}|view>`);
    if (ci.prUrl && ci.prNumber)
      ciLines.push(`*PR:* <${ci.prUrl}|#${ci.prNumber}>`);
    if (ci.sha)
      ciLines.push(`*Commit:* \`${ci.sha.substring(0, 7)}\``);

    const totalsLine = perTest
      ? ''
      : `\n${totals.passed} passed, ${totals.failed} failed, ${totals.flaky} flaky, ${totals.skipped} skipped`;

    const visible = failures.slice(0, 10);
    const failureLines = visible.map(f => {
      const title = f.test.titlePath().slice(1).join(' › ');
      return `• ${title}\n  \`${f.errorLine.slice(0, 200).replace(/`/g, "'")}\``;
    });

    const text = [
      mentionLine + headline,
      ciLines.join(' · '),
      totalsLine,
      failureLines.length ? '\n*Failures:*\n' + failureLines.join('\n') : '',
      failures.length > visible.length ? `\n…and ${failures.length - visible.length} more` : '',
    ].filter(Boolean).join('\n');

    return { text };
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

export default SlackReporter;
