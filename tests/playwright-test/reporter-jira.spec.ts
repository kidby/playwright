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

import { test, expect } from './playwright-test-fixtures.js';
import { lastDryRunPayload } from './dry-run-helpers.js';

test('does nothing unless enabled: true (opt-in default)', async ({ runInlineTest }) => {
  // Tickets in CI surprise teams that happen to inherit this reporter list,
  // so the reporter is OFF unless the consumer explicitly flips `enabled`.
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = { reporter: [['jira', {
        dryRun: true,
        projectKey: 'QE',
        baseUrl: 'https://x.atlassian.net',
        auth: { email: 'a', token: 'b' },
      }]] };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('fails', () => { throw new Error('x'); });
    `,
  });
  expect(result.exitCode).toBe(1);
  expect(result.output).not.toContain('[jira]');
});

test('builds a Bug issue with consumer labels + playwright tag', async ({ runInlineTest }) => {
  const result = await runInlineTest({
    'playwright.config.ts': `
      module.exports = { reporter: [['jira', {
        dryRun: true,
        enabled: true,
        projectKey: 'QE',
        baseUrl: 'https://x.atlassian.net',
        auth: { email: 'a', token: 'b' },
        labels: ['nightly'],
      }]] };
    `,
    'a.spec.ts': `
      import { test, expect } from '@playwright/test';
      test('fails', () => { throw new Error('boom!'); });
    `,
  });
  expect(result.exitCode).toBe(1);
  const issue = lastDryRunPayload(result.output, 'jira');
  expect(issue.fields.project.key).toBe('QE');
  expect(issue.fields.issuetype.name).toBe('Bug');
  expect(issue.fields.labels).toContain('nightly');
  expect(issue.fields.labels).toContain('playwright');
  expect(issue.fields.summary).toContain('fails');
  expect(issue.fields.description).toContain('boom!');
});
