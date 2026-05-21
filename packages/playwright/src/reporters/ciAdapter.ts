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

export type CIProvider = 'circleci' | 'github-actions' | 'gitlab' | 'buildkite' | 'jenkins' | 'unknown';

export type CIMetadata = {
  provider: CIProvider;
  branch?: string;
  sha?: string;
  runUrl?: string;
  jobName?: string;
  prNumber?: string;
  prUrl?: string;
  buildNumber?: string;
  repo?: string;
};

export function detectCI(): CIMetadata {
  if (env('CIRCLECI'))
    return circleci();
  if (env('GITHUB_ACTIONS'))
    return githubActions();
  if (env('GITLAB_CI'))
    return gitlab();
  if (env('BUILDKITE'))
    return buildkite();
  if (env('JENKINS_URL'))
    return jenkins();
  return { provider: 'unknown' };
}

function env(key: string): string | undefined {
  const v = process.env[key];
  return v && v.length ? v : undefined;
}

function circleci(): CIMetadata {
  const user = env('CIRCLE_PROJECT_USERNAME');
  const repo = env('CIRCLE_PROJECT_REPONAME');
  return {
    provider: 'circleci',
    branch: env('CIRCLE_BRANCH'),
    sha: env('CIRCLE_SHA1'),
    runUrl: env('CIRCLE_BUILD_URL'),
    jobName: env('CIRCLE_JOB'),
    buildNumber: env('CIRCLE_BUILD_NUM'),
    prNumber: env('CIRCLE_PR_NUMBER'),
    prUrl: env('CIRCLE_PULL_REQUEST'),
    repo: user && repo ? `${user}/${repo}` : undefined,
  };
}

function githubActions(): CIMetadata {
  const repo = env('GITHUB_REPOSITORY');
  const serverUrl = env('GITHUB_SERVER_URL') || 'https://github.com';
  const runId = env('GITHUB_RUN_ID');
  // PR refs look like 'refs/pull/123/merge'.
  const prMatch = (env('GITHUB_REF') || '').match(/^refs\/pull\/(\d+)\//);
  return {
    provider: 'github-actions',
    branch: env('GITHUB_HEAD_REF') || env('GITHUB_REF_NAME'),
    sha: env('GITHUB_SHA'),
    runUrl: repo && runId ? `${serverUrl}/${repo}/actions/runs/${runId}` : undefined,
    jobName: env('GITHUB_JOB') || env('GITHUB_WORKFLOW'),
    buildNumber: env('GITHUB_RUN_NUMBER'),
    prNumber: prMatch?.[1],
    prUrl: prMatch && repo ? `${serverUrl}/${repo}/pull/${prMatch[1]}` : undefined,
    repo,
  };
}

function gitlab(): CIMetadata {
  const mrProject = env('CI_MERGE_REQUEST_PROJECT_URL');
  const mrId = env('CI_MERGE_REQUEST_IID');
  return {
    provider: 'gitlab',
    branch: env('CI_COMMIT_REF_NAME'),
    sha: env('CI_COMMIT_SHA'),
    runUrl: env('CI_JOB_URL'),
    jobName: env('CI_JOB_NAME'),
    buildNumber: env('CI_PIPELINE_ID'),
    prNumber: mrId,
    prUrl: mrProject && mrId ? `${mrProject}/-/merge_requests/${mrId}` : undefined,
    repo: env('CI_PROJECT_PATH'),
  };
}

function buildkite(): CIMetadata {
  const pr = env('BUILDKITE_PULL_REQUEST');
  return {
    provider: 'buildkite',
    branch: env('BUILDKITE_BRANCH'),
    sha: env('BUILDKITE_COMMIT'),
    runUrl: env('BUILDKITE_BUILD_URL'),
    jobName: env('BUILDKITE_LABEL'),
    buildNumber: env('BUILDKITE_BUILD_NUMBER'),
    prNumber: pr && pr !== 'false' ? pr : undefined,
    repo: env('BUILDKITE_REPO'),
  };
}

function jenkins(): CIMetadata {
  return {
    provider: 'jenkins',
    branch: env('GIT_BRANCH') || env('BRANCH_NAME'),
    sha: env('GIT_COMMIT'),
    runUrl: env('BUILD_URL'),
    jobName: env('JOB_NAME'),
    buildNumber: env('BUILD_NUMBER'),
  };
}
