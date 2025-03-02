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

import { calculateSha1 } from 'playwright-core/lib/utils';

import { LastRunReporter } from './lastRun';
import { getFileSize } from '../util';

import type { Suite, TestCase } from '../common/test';
import type { FullConfigInternal } from '../common/config';

export type TestGroup = {
  workerHash: string;
  requireFile: string;
  repeatEachIndex: number;
  projectId: string;
  tests: TestCase[];
};

type Shard = {
  weight: number;
  groups: Set<TestGroup>;
};

function getActiveTests(tests: TestCase[]): TestCase[] {
  return tests.filter(test => !(test.expectedStatus === 'skipped'));
}

class TestBalancer {
  private _fileSizeCache = new Map<string, number>();
  private _weightCache = new Map<TestGroup, number>();

  private _getFileSize(filePath: string): number {
    if (!this._fileSizeCache.has(filePath)) {
      const size = getFileSize(filePath);
      this._fileSizeCache.set(filePath, size);
    }
    return this._fileSizeCache.get(filePath)!;
  }

  getGroupWeight(group: TestGroup, runtimeData?: { [testId: string]: number }): number {
    if (this._weightCache.has(group))
      return this._weightCache.get(group)!;

    const activeTests = getActiveTests(group.tests);

    if (activeTests.length === 0) {
      const minWeight = 0.1;
      this._weightCache.set(group, minWeight);
      return minWeight;
    }

    if (runtimeData) {
      let totalRuntime = 0;
      let count = 0;
      for (const test of activeTests) {
        const duration = runtimeData[test.id];
        if (duration !== undefined) {
          totalRuntime += duration;
          count++;
        }
      }
      if (count > 0) {
        const avgRuntime = totalRuntime / count;
        const weight = totalRuntime + (activeTests.length - count) * avgRuntime;
        this._weightCache.set(group, weight);
        return weight;
      }
    }

    const fileSize = this._getFileSize(group.requireFile);
    let weight = activeTests.length * 100;

    if (fileSize > 0)
      weight += Math.log(fileSize) * 5;

    // Add a small hash factor for stability
    const hashStr = calculateSha1(group.workerHash + group.requireFile);
    const hashFactor = (parseInt(hashStr.substring(0, 8), 16) % 1000) / 10000;
    weight += hashFactor;

    this._weightCache.set(group, weight);
    return weight;
  }

  createShards(
    testGroups: TestGroup[],
    numShards: number,
    runtimeData?: { [testId: string]: number }
  ): Shard[] {
    const shards: Shard[] = Array.from({ length: numShards }, () => ({ weight: 0, groups: new Set<TestGroup>() }));

    if (testGroups.length <= numShards) {
      testGroups.forEach((group, i) => {
        shards[i].groups.add(group);
        shards[i].weight = this.getGroupWeight(group, runtimeData);
      });
      return shards;
    }

    const sortedGroups = [...testGroups].sort((a, b) =>
      this.getGroupWeight(b, runtimeData) - this.getGroupWeight(a, runtimeData));

    for (const group of sortedGroups) {
      const lightestShard = shards.reduce((prev, curr) =>
        (curr.weight < prev.weight ? curr : prev));
      const weight = this.getGroupWeight(group, runtimeData);
      lightestShard.groups.add(group);
      lightestShard.weight += weight;
    }

    return shards;
  }

  async balanceShards(
    shard: { total: number; current: number },
    testGroups: TestGroup[],
    fullConfigInternal: FullConfigInternal
  ): Promise<Set<TestGroup>> {
    this._weightCache.clear();

    const lastRunReporter = new LastRunReporter(fullConfigInternal);
    const lastRunInfo = await lastRunReporter.lastRunInfo();
    const runtimeData = lastRunInfo?.testDurations;

    const shards = this.createShards(testGroups, shard.total, runtimeData);
    shards.sort((a, b) => a.weight - b.weight);

    return shards[shard.current - 1].groups;
  }

  clearCaches(): void {
    this._fileSizeCache.clear();
    this._weightCache.clear();
  }
}

function simpleFilterForShard(shard: { total: number; current: number }, testGroups: TestGroup[]): Set<TestGroup> {
  // Note that sharding works based on test groups.
  // This means parallel files will be sharded by single tests,
  // while non-parallel files will be sharded by the whole file.

  let shardableTotal = 0;
  for (const group of testGroups)
    shardableTotal += group.tests.length; // Count ALL tests, including skipped ones

  // Each shard gets some tests.
  const shardSize = Math.floor(shardableTotal / shard.total);
  // First few shards get one more test each.
  const extraOne = shardableTotal - shardSize * shard.total;

  const currentShard = shard.current - 1; // Make it zero-based for calculations.
  const from = shardSize * currentShard + Math.min(extraOne, currentShard);
  const to = from + shardSize + (currentShard < extraOne ? 1 : 0);

  let current = 0;
  const result = new Set<TestGroup>();
  for (const group of testGroups) {
    // Any test group goes to the shard that contains the first test of this group.
    // So, this shard gets any group that starts at [from; to)
    if (current >= from && current < to)
      result.add(group);
    current += group.tests.length; // Count ALL tests, including skipped ones
  }
  return result;
}

export function createTestGroups(projectSuite: Suite, expectedParallelism: number): TestGroup[] {
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
    parallel: Map<Suite | TestCase, TestGroup>,
    parallelWithHooks: TestGroup,
  }>>();

  const createGroup = (test: TestCase): TestGroup => ({
    workerHash: test._workerHash,
    requireFile: test._requireFile,
    repeatEachIndex: test.repeatEachIndex,
    projectId: test._projectId,
    tests: [],
  });

  for (const test of projectSuite.allTests()) {
    if (!groups.has(test._workerHash))
      groups.set(test._workerHash, new Map());
    const byFile = groups.get(test._workerHash)!;

    if (!byFile.has(test._requireFile)) {
      byFile.set(test._requireFile, {
        general: createGroup(test),
        parallel: new Map(),
        parallelWithHooks: createGroup(test),
      });
    }
    const groupSet = byFile.get(test._requireFile)!;

    let insideParallel = false;
    let outerSequentialSuite: Suite | undefined;
    let hasHooks = false;
    for (let parent: Suite | undefined = test.parent; parent; parent = parent.parent) {
      if (parent._parallelMode === 'serial' || parent._parallelMode === 'default')
        outerSequentialSuite = parent;
      insideParallel ||= parent._parallelMode === 'parallel';
      hasHooks ||= parent._hooks.some(hook => hook.type === 'beforeAll' || hook.type === 'afterAll');
    }

    if (insideParallel) {
      if (hasHooks && !outerSequentialSuite) {
        groupSet.parallelWithHooks.tests.push(test);
      } else {
        const key = outerSequentialSuite || test;
        if (!groupSet.parallel.has(key))
          groupSet.parallel.set(key, createGroup(test));
        groupSet.parallel.get(key)!.tests.push(test);
      }
    } else {
      groupSet.general.tests.push(test);
    }
  }

  const result: TestGroup[] = [];
  for (const byFile of groups.values()) {
    for (const groupSet of byFile.values()) {

      if (groupSet.general.tests.length)
        result.push(groupSet.general);

      result.push(...groupSet.parallel.values());

      const groupSize = Math.ceil(groupSet.parallelWithHooks.tests.length / expectedParallelism);
      let currentGroup: TestGroup | undefined;
      for (const test of groupSet.parallelWithHooks.tests) {
        if (!currentGroup || currentGroup.tests.length >= groupSize) {
          currentGroup = createGroup(test);
          result.push(currentGroup);
        }
        currentGroup.tests.push(test);
      }
    }
  }
  return result;
}

export async function filterForShard(
  shard: { total: number; current: number },
  testGroups: TestGroup[],
  fullConfigInternal?: FullConfigInternal
): Promise<Set<TestGroup>> {
  if (fullConfigInternal?.config.testBalancing === 'weight') {

    const hasSpecialCliFlag = fullConfigInternal.cliArgs?.some(arg =>
      arg === '--last-failed' ||
      arg === '--fully-parallel');

    if (!hasSpecialCliFlag) {
      const testBalancer = new TestBalancer();
      return await testBalancer.balanceShards(shard, testGroups, fullConfigInternal);
    }
  }

  return simpleFilterForShard(shard, testGroups);
}
