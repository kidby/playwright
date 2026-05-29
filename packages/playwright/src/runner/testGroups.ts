/**
 * Copyright Microsoft Corporation. All rights reserved.
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

import fs from 'fs';

import { LastRunReporter } from './lastRun.js';
import { filterProjects } from './projectUtils.js';

import type { FullConfigInternal } from '../common/config.js';
import type { test } from '../common/index.js';
import type { LastRunInfo } from './lastRun.js';

export type TestGroup = {
  workerHash: string;
  requireFile: string;
  repeatEachIndex: number;
  projectId: string;
  tests: test.TestCase[];
};

export function createTestGroups(projectSuite: test.Suite, expectedParallelism: number): TestGroup[] {
  // This function groups tests that can be run together.
  // Tests cannot be run together when:
  // - They belong to different projects - requires different workers.
  // - They have a different repeatEachIndex - requires different workers.
  // - They have a different set of worker fixtures in the pool - requires different workers.
  // - They have a different requireFile - reuses the worker, but runs each requireFile separately.
  // - They belong to a parallel suite.

  // Using the map "workerHash -> requireFile -> group" makes us preserve the natural order
  // of worker hashes and require files for the simple cases.
  const groups = new Map<string, Map<string, {
    // Tests that must be run in order are in the same group.
    general: TestGroup,

    // There are 3 kinds of parallel tests:
    // - Tests belonging to parallel suites, without beforeAll/afterAll hooks.
    //   These can be run independently, they are put into their own group, key === test.
    // - Tests belonging to parallel suites, with beforeAll/afterAll hooks.
    //   These should share the worker as much as possible, put into single parallelWithHooks group.
    //   We'll divide them into equally-sized groups later.
    // - Tests belonging to serial suites inside parallel suites.
    //   These should run as a serial group, each group is independent, key === serial suite.
    parallel: Map<test.Suite | test.TestCase, TestGroup>,
    parallelWithHooks: TestGroup,
  }>>();

  const createGroup = (test: test.TestCase): TestGroup => {
    return {
      workerHash: test._workerHash,
      requireFile: test._requireFile,
      repeatEachIndex: test.repeatEachIndex,
      projectId: test._projectId,
      tests: [],
    };
  };

  for (const test of projectSuite.allTests()) {
    let withWorkerHash = groups.get(test._workerHash);
    if (!withWorkerHash) {
      withWorkerHash = new Map();
      groups.set(test._workerHash, withWorkerHash);
    }
    let withRequireFile = withWorkerHash.get(test._requireFile);
    if (!withRequireFile) {
      withRequireFile = {
        general: createGroup(test),
        parallel: new Map(),
        parallelWithHooks: createGroup(test),
      };
      withWorkerHash.set(test._requireFile, withRequireFile);
    }

    // Note that a parallel suite cannot be inside a serial suite. This is enforced in TestType.
    let insideParallel = false;
    let outerMostSequentialSuite: test.Suite | undefined;
    let hasAllHooks = false;
    for (let parent: test.Suite | undefined = test.parent; parent; parent = parent.parent) {
      if (parent._parallelMode === 'serial' || parent._parallelMode === 'default')
        outerMostSequentialSuite = parent;
      insideParallel = insideParallel || parent._parallelMode === 'parallel';
      hasAllHooks = hasAllHooks || parent._hooks.some(hook => hook.type === 'beforeAll' || hook.type === 'afterAll');
    }

    if (insideParallel) {
      if (hasAllHooks && !outerMostSequentialSuite) {
        withRequireFile.parallelWithHooks.tests.push(test);
      } else {
        const key = outerMostSequentialSuite || test;
        let group = withRequireFile.parallel.get(key);
        if (!group) {
          group = createGroup(test);
          withRequireFile.parallel.set(key, group);
        }
        group.tests.push(test);
      }
    } else {
      withRequireFile.general.tests.push(test);
    }
  }

  const result: TestGroup[] = [];
  for (const withWorkerHash of groups.values()) {
    for (const withRequireFile of withWorkerHash.values()) {
      // Tests without parallel mode should run serially as a single group.
      if (withRequireFile.general.tests.length)
        result.push(withRequireFile.general);

      // Parallel test groups without beforeAll/afterAll can be run independently.
      result.push(...withRequireFile.parallel.values());

      // Tests with beforeAll/afterAll should try to share workers as much as possible.
      const parallelWithHooksGroupSize = Math.ceil(withRequireFile.parallelWithHooks.tests.length / expectedParallelism);
      let lastGroup: TestGroup | undefined;
      for (const test of withRequireFile.parallelWithHooks.tests) {
        if (!lastGroup || lastGroup.tests.length >= parallelWithHooksGroupSize) {
          lastGroup = createGroup(test);
          result.push(lastGroup);
        }
        lastGroup.tests.push(test);
      }
    }
  }
  return result;
}

export async function filterForShard(config: FullConfigInternal, weights: number[] | undefined, testGroups: TestGroup[], options: { lastFailedFile?: string } = {}): Promise<Set<TestGroup>> {
  const shard = config.config.shard!;
  const mode = config.shardingMode;
  if (mode === 'round-robin')
    return filterForShardRoundRobin(shard, testGroups);
  if (mode === 'duration-round-robin') {
    const reporter = new LastRunReporter(filterProjects(config.projects, config.configCLIOverrides.projects?.map(p => p.name)), false, options.lastFailedFile);
    const lastRunInfo = await reporter.lastRunInfo();
    return filterForShardRoundRobin(shard, testGroups, lastRunInfo);
  }
  return filterForShardPartition(shard, weights, testGroups);
}

/**
 * Default (legacy) sharding: contiguous slice of ordered tests per shard,
 * optionally weighted via `PWTEST_SHARD_WEIGHTS`. Preserves the fork's
 * previous behavior exactly.
 *
 * ```
 *          [  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12]
 * Shard 1:  ^---------^                                      : [  1, 2, 3 ]
 * Shard 2:              ^---------^                          : [  4, 5, 6 ]
 * Shard 3:                          ^---------^              : [  7, 8, 9 ]
 * Shard 4:                                      ^---------^  : [ 10,11,12 ]
 * ```
 */
function filterForShardPartition(shard: { total: number, current: number }, weights: number[] | undefined, testGroups: TestGroup[]): Set<TestGroup> {
  weights ??= Array.from({ length: shard.total }, () => 1);
  if (weights.length !== shard.total)
    throw new Error(`PWTEST_SHARD_WEIGHTS number of weights must match the shard total of ${shard.total}`);

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  // Note that sharding works based on test groups.
  // This means parallel files will be sharded by single tests,
  // while non-parallel files will be sharded by the whole file.
  //
  // Shards are still balanced by the number of tests, not files,
  // even in the case of non-paralleled files.

  let shardableTotal = 0;
  for (const group of testGroups)
    shardableTotal += group.tests.length;

  // Each shard gets some tests.
  const shardSizes = weights.map(w => Math.floor(w * shardableTotal / totalWeight));
  const remainder = shardableTotal - shardSizes.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remainder; i++) {
    // First few shards get one more test each.
    shardSizes[i % shardSizes.length]++;
  }

  let from = 0;
  for (let i = 0; i < shard.current - 1; i++)
    from += shardSizes[i];
  const to = from + shardSizes[shard.current - 1];

  let current = 0;
  const result = new Set<TestGroup>();
  for (const group of testGroups) {
    // Any test group goes to the shard that contains the first test of this group.
    // So, this shard gets any group that starts at [from; to)
    if (current >= from && current < to)
      result.add(group);
    current += group.tests.length;
  }
  return result;
}

/**
 * Greedy round-robin: sort groups by descending weight (test count, or
 * sum of previous-run durations when `lastRunInfo` is supplied), then
 * assign each group to the shard with the lowest accumulated weight.
 *
 * ```
 *          [  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12]
 * Shard 1:    ^               ^               ^              : [  1, 5, 9 ]
 * Shard 2:        ^               ^               ^          : [  2, 6,10 ]
 * Shard 3:            ^               ^               ^      : [  3, 7,11 ]
 * Shard 4:                ^               ^               ^  : [  4, 8,12 ]
 * ```
 */
function filterForShardRoundRobin(shard: { total: number, current: number }, testGroups: TestGroup[], lastRunInfo?: LastRunInfo): Set<TestGroup> {
  // Weight resolution per test:
  //   1. Known duration from `.last-run.json` if available — best signal.
  //   2. File size (bytes) as a proxy for LOC — heavier files tend to host
  //      heavier tests. Cached per file so we stat each spec at most once.
  // For pure `round-robin` (no last-run info), every test falls through to
  // the file-size fallback, which is still strictly better than counting
  // 1 per test.
  const fileSizeCache = new Map<string, number>();
  const fileSize = (file: string): number => {
    if (!file)
      return 1;
    let size = fileSizeCache.get(file);
    if (size === undefined) {
      try {
        size = fs.statSync(file).size;
      } catch {
        size = 1;
      }
      fileSizeCache.set(file, size);
    }
    return Math.max(1, size);
  };
  const testWeight = (t: test.TestCase): number => {
    const known = lastRunInfo?.testDurations?.[t.id];
    if (known && known > 0)
      return known;
    return fileSize(t.location.file);
  };
  const weight = (group: TestGroup): number => group.tests.reduce((sum, t) => sum + testWeight(t), 0);

  const shardWeights = new Array<number>(shard.total).fill(0);
  const shardSets = Array.from({ length: shard.total }, () => new Set<TestGroup>());

  const sortedGroups = testGroups.slice().sort((a, b) => weight(b) - weight(a));
  for (const group of sortedGroups) {
    // Greedy: append to the currently lightest shard.
    let minIndex = 0;
    for (let i = 1; i < shardWeights.length; i++) {
      if (shardWeights[i] < shardWeights[minIndex])
        minIndex = i;
    }
    shardWeights[minIndex] += weight(group);
    shardSets[minIndex].add(group);
  }

  return shardSets[shard.current - 1];
}
