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

import { test, expect } from './playwright-test-fixtures';
import { detectCI } from '../../packages/playwright/src/reporters/ciAdapter';

const CI_ENV_VARS = [
  'CIRCLECI', 'CIRCLE_BRANCH', 'CIRCLE_SHA1', 'CIRCLE_BUILD_URL', 'CIRCLE_JOB',
  'CIRCLE_BUILD_NUM', 'CIRCLE_PR_NUMBER', 'CIRCLE_PULL_REQUEST',
  'CIRCLE_PROJECT_USERNAME', 'CIRCLE_PROJECT_REPONAME',
  'GITHUB_ACTIONS', 'GITHUB_REPOSITORY', 'GITHUB_SERVER_URL', 'GITHUB_RUN_ID',
  'GITHUB_HEAD_REF', 'GITHUB_REF_NAME', 'GITHUB_SHA', 'GITHUB_JOB',
  'GITHUB_WORKFLOW', 'GITHUB_RUN_NUMBER', 'GITHUB_REF',
  'GITLAB_CI', 'CI_COMMIT_REF_NAME', 'CI_COMMIT_SHA', 'CI_JOB_URL', 'CI_JOB_NAME',
  'CI_PIPELINE_ID', 'CI_MERGE_REQUEST_IID', 'CI_MERGE_REQUEST_PROJECT_URL',
  'CI_PROJECT_PATH',
  'BUILDKITE', 'BUILDKITE_BRANCH', 'BUILDKITE_COMMIT', 'BUILDKITE_BUILD_URL',
  'BUILDKITE_LABEL', 'BUILDKITE_BUILD_NUMBER', 'BUILDKITE_PULL_REQUEST',
  'BUILDKITE_REPO',
  'JENKINS_URL', 'GIT_BRANCH', 'BRANCH_NAME', 'GIT_COMMIT', 'BUILD_URL',
  'JOB_NAME', 'BUILD_NUMBER',
];

// Each test starts from a clean slate — CI envs leak from the host shell
// (e.g., running in GitHub Actions itself), and tests assume isolation.
function withCleanEnv(set: Record<string, string>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of CI_ENV_VARS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  for (const [k, v] of Object.entries(set))
    process.env[k] = v;
  try {
    fn();
  } finally {
    for (const key of CI_ENV_VARS) {
      if (saved[key] === undefined)
        delete process.env[key];
      else
        process.env[key] = saved[key];
    }
  }
}

test('unknown when no CI env set', async () => {
  withCleanEnv({}, () => {
    const ci = detectCI();
    expect(ci.provider).toBe('unknown');
    expect(ci.branch).toBeUndefined();
  });
});

test('circleci detection', async () => {
  withCleanEnv({
    CIRCLECI: 'true',
    CIRCLE_BRANCH: 'feature/x',
    CIRCLE_SHA1: 'abc123',
    CIRCLE_BUILD_URL: 'https://circleci.com/build/42',
    CIRCLE_JOB: 'test-chromium',
    CIRCLE_BUILD_NUM: '42',
    CIRCLE_PROJECT_USERNAME: 'intellum',
    CIRCLE_PROJECT_REPONAME: 'one-automation',
  }, () => {
    const ci = detectCI();
    expect(ci.provider).toBe('circleci');
    expect(ci.branch).toBe('feature/x');
    expect(ci.sha).toBe('abc123');
    expect(ci.runUrl).toBe('https://circleci.com/build/42');
    expect(ci.jobName).toBe('test-chromium');
    expect(ci.repo).toBe('intellum/one-automation');
  });
});

test('github-actions detection with PR ref', async () => {
  withCleanEnv({
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'intellum/playwright',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_RUN_ID: '7',
    GITHUB_HEAD_REF: 'fix-39562',
    GITHUB_SHA: 'sha-deadbeef',
    GITHUB_JOB: 'unit',
    GITHUB_RUN_NUMBER: '7',
    GITHUB_REF: 'refs/pull/123/merge',
  }, () => {
    const ci = detectCI();
    expect(ci.provider).toBe('github-actions');
    expect(ci.branch).toBe('fix-39562');
    expect(ci.sha).toBe('sha-deadbeef');
    expect(ci.runUrl).toBe('https://github.com/intellum/playwright/actions/runs/7');
    expect(ci.jobName).toBe('unit');
    expect(ci.prNumber).toBe('123');
    expect(ci.prUrl).toBe('https://github.com/intellum/playwright/pull/123');
  });
});

test('gitlab detection', async () => {
  withCleanEnv({
    GITLAB_CI: 'true',
    CI_COMMIT_REF_NAME: 'main',
    CI_COMMIT_SHA: 'cafe',
    CI_JOB_URL: 'https://gitlab.com/x/-/jobs/9',
    CI_JOB_NAME: 'rspec',
    CI_PIPELINE_ID: '5',
    CI_PROJECT_PATH: 'group/proj',
  }, () => {
    const ci = detectCI();
    expect(ci.provider).toBe('gitlab');
    expect(ci.branch).toBe('main');
    expect(ci.repo).toBe('group/proj');
    expect(ci.runUrl).toBe('https://gitlab.com/x/-/jobs/9');
  });
});

test('buildkite detection ignores false PR', async () => {
  withCleanEnv({
    BUILDKITE: 'true',
    BUILDKITE_BRANCH: 'main',
    BUILDKITE_COMMIT: 'sha',
    BUILDKITE_BUILD_URL: 'https://buildkite.com/x/9',
    BUILDKITE_PULL_REQUEST: 'false',
  }, () => {
    const ci = detectCI();
    expect(ci.provider).toBe('buildkite');
    expect(ci.prNumber).toBeUndefined();
  });
});
