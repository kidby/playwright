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

import * as fs from 'fs';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { cpus } from 'os';

import { calculateSha1, toPosixPath } from 'playwright-core/lib/utils';
import { MultiMap } from 'playwright-core/lib/utils';

import { LastRunReporter } from './lastRun';

import type { Suite, TestCase } from '../common/test';
import type { FullConfigInternal } from '../common/config';


const MAX_WORKER_THREADS = Math.max(1, Math.min(cpus().length - 1, 4));
const FILE_BATCH_SIZE = 20;

const PATTERNS = {
  assertion: /assert|expect|should/g,
  async: /async|await|setTimeout|setInterval|Promise/g,
  errorHandling: /try\s*{|catch\s*\(|finally\s*{/g,
  network: /fetch\(|axios\.|http\./,
  worker: /new Worker\(|child_process/
};

//
// Types
//
export type TestGroup = {
  workerHash: string;
  requireFile: string;
  repeatEachIndex: number;
  projectId: string;
  tests: TestCase[];
};

export type FileMetadata = { size: number; complexity: number };

type WorkerMessage =
  | { type: 'analyzeFile'; filePath: string }
  | { type: 'result'; filePath: string; metadata: FileMetadata };

type Shard = { weight: number; groups: Set<TestGroup> };

class FileCache {
  private _sizes = new Map<string, number>();
  private _complexities = new Map<string, number>();

  getSize(filePath: string): number {
    if (!this._sizes.has(filePath)) {
      try {
        const stats = fs.statSync(filePath);
        this._sizes.set(filePath, stats.size);
      } catch {
        this._sizes.set(filePath, 0);
      }
    }
    return this._sizes.get(filePath)!;
  }

  getComplexity(filePath: string, content?: string): number {
    if (!this._complexities.has(filePath)) {
      try {
        if (!content && this.getSize(filePath) <= 1024 * 1024)
          content = fs.readFileSync(filePath, 'utf8');
        let complexity = 1.0;
        if (content) {
          const asserts = content.match(PATTERNS.assertion);
          if (asserts)
            complexity += Math.min(asserts.length / 100, 0.5);
          const asyncs = content.match(PATTERNS.async);
          if (asyncs)
            complexity += Math.min(asyncs.length / 20, 0.3);
          if (PATTERNS.network.test(content))
            complexity += 0.2;
        }
        this._complexities.set(filePath, complexity);
      } catch {
        this._complexities.set(filePath, 1.0);
      }
    }
    return this._complexities.get(filePath)!;
  }

  clear(): void {
    this._sizes.clear();
    this._complexities.clear();
  }
}

class WorkerPool {
  private _workers: Worker[] = [];
  private _pending = new Map<string, (metadata: FileMetadata) => void>();

  init(): void {
    if (this._workers.length > 0 || !isMainThread)
      return;
    for (let i = 0; i < MAX_WORKER_THREADS; i++) {
      const worker = new Worker(__filename, { workerData: { type: 'fileAnalyzer' } });
      worker.on('message', (msg: WorkerMessage) => {
        if (msg.type === 'result') {
          this._pending.get(msg.filePath)?.(msg.metadata);
          this._pending.delete(msg.filePath);
        }
      });
      this._workers.push(worker);
    }
  }

  analyzeFile(filePath: string): Promise<FileMetadata> {
    if (!this._workers.length)
      this.init();
    return new Promise(resolve => {
      this._pending.set(filePath, resolve);
      const index = this._pending.size % this._workers.length;
      this._workers[index].postMessage({ type: 'analyzeFile', filePath });
    });
  }

  hasWorkers(): boolean {
    return this._workers.length > 0;
  }

  close(): void {
    for (const worker of this._workers)
      worker.terminate().catch(() => {});
    this._workers = [];
  }
}

class TestSharding {
  private _fileCache = new FileCache();
  private _suiteMetrics = new Map<Suite, { depth: number; hookCount: number }>();
  private _groupWeightCache = new Map<TestGroup, number>();

  constructor(private _workerPool?: WorkerPool) {}

  private _populateSuiteMetrics(suite: Suite, depth = 0): { depth: number; hookCount: number } {
    if (this._suiteMetrics.has(suite))
      return this._suiteMetrics.get(suite)!;
    const hooks = suite._hooks?.length || 0;
    let maxDepth = depth, totalHooks = hooks;
    for (const child of suite.suites) {
      const m = this._populateSuiteMetrics(child, depth + 1);
      maxDepth = Math.max(maxDepth, m.depth);
      totalHooks += m.hookCount;
    }
    const metrics = { depth: maxDepth, hookCount: totalHooks };
    this._suiteMetrics.set(suite, metrics);
    return metrics;
  }

  private _getGroupHash(group: TestGroup): string {
    return `${group.workerHash}-${toPosixPath(group.requireFile)}-${group.repeatEachIndex}-${group.projectId}`;
  }

  private _calculateStableHash(group: TestGroup): number {
    const hash = calculateSha1(this._getGroupHash(group));
    return parseInt(hash.substring(0, 8), 16) % 1000;
  }

  getGroupWeight(group: TestGroup, runtimeData?: { [testId: string]: number }): number {
    if (this._groupWeightCache.has(group))
      return this._groupWeightCache.get(group)!;
    const tests = group.tests;
    let weight: number;
    const stableHash = this._calculateStableHash(group);

    if (runtimeData) {
      let total = 0, count = 0;
      for (const t of tests) {
        const d = runtimeData[t.id];
        if (d !== undefined) {
          total += d;
          count++;
        }
      }
      if (count > 0) {
        const avg = total / count;
        weight = total + (tests.length - count) * avg;
        this._groupWeightCache.set(group, weight + stableHash * 0.00001);
        return weight;
      }
    }
    const testCount = tests.length;
    const fileSize = this._fileCache.getSize(group.requireFile);
    const sizeScore = fileSize > 0 ? Math.log(fileSize) * 5 : 0;
    const complexity = this._fileCache.getComplexity(group.requireFile);
    const { hookCount } = this._populateSuiteMetrics(tests[0].parent!);
    weight = testCount * 100 + sizeScore + hookCount * 5;
    weight *= complexity;
    weight += stableHash * 0.001;
    this._groupWeightCache.set(group, weight);
    return weight;
  }

  createGroup(test: TestCase): TestGroup {
    return {
      workerHash: test._workerHash,
      requireFile: test._requireFile,
      repeatEachIndex: test.repeatEachIndex,
      projectId: test._projectId,
      tests: []
    };
  }

  async createTestGroups(projectSuite: Suite, expectedParallelism: number): Promise<TestGroup[]> {
    const allTests = [...projectSuite.allTests()];
    const uniqueFiles = new Set<string>();
    for (const t of allTests)
      uniqueFiles.add(t._requireFile);
    if (this._workerPool?.hasWorkers()) {
      await Promise.all([...uniqueFiles].map(f => this._workerPool!.analyzeFile(f).catch(() => this._fileCache.getComplexity(f))));
    } else {
      for (const f of uniqueFiles)
        this._fileCache.getComplexity(f);
    }
    this._populateSuiteMetrics(projectSuite);

    // Group tests by worker hash in a deterministic order.
    const groupsByWorker = new MultiMap<string, TestCase>();
    for (const test of allTests)
      groupsByWorker.set(test._workerHash, test);
    const result: TestGroup[] = [];

    // Sort worker hashes to ensure a predictable order.
    for (const workerHash of [...groupsByWorker.keys()].sort()) {
      const tests = groupsByWorker.get(workerHash);
      // Group by file. We will keep a "general" group (for tests not in parallel)
      // and a map for parallel groups keyed by the test's parent title (or fallback to test id).
      const groupsByFile = new Map<string, { general: TestGroup, parallel: Map<string, TestGroup> }>();

      for (const test of tests) {
        let entry = groupsByFile.get(test._requireFile);
        if (!entry) {
          entry = {
            general: this.createGroup(test),
            parallel: new Map<string, TestGroup>()
          };
          groupsByFile.set(test._requireFile, entry);
        }
        // Decide whether the test is in parallel mode.
        if (test.parent && test.parent._parallelMode === 'parallel') {
          // Use parent.title as key; fallback to test.id.
          const key = test.parent.title || test.id;
          let pg = entry.parallel.get(key);
          if (!pg) {
            pg = this.createGroup(test);
            entry.parallel.set(key, pg);
          }
          pg.tests.push(test);
        } else {
          entry.general.tests.push(test);
        }
      }

      // Add groups into the result. Sort tests within each group to guarantee consistency.
      for (const entry of groupsByFile.values()) {
        if (entry.general.tests.length > 0) {
          entry.general.tests.sort((a, b) => a.id.localeCompare(b.id));
          result.push(entry.general);
        }
        // Sort the parallel groups by the key (or first test id) for deterministic order.
        for (const pg of Array.from(entry.parallel.values()).sort((a, b) =>
          a.tests[0].id.localeCompare(b.tests[0].id)
        )) {
          pg.tests.sort((a, b) => a.id.localeCompare(b.id));
          result.push(pg);
        }
      }
    }
    return result;
  }

  createShards(testGroups: TestGroup[], numShards: number, runtimeData?: { [testId: string]: number }): Shard[] {
    const shards: Shard[] = Array.from({ length: numShards }, () => ({ weight: 0, groups: new Set<TestGroup>() }));
    if (testGroups.length <= numShards) {
      testGroups.forEach((grp, i) => {
        const w = this.getGroupWeight(grp, runtimeData);
        shards[i].groups.add(grp);
        shards[i].weight = w;
      });
      return shards;
    }
    // Sort groups first by descending weight and then by file name as a secondary criterion.
    const sorted = [...testGroups].sort((a, b) => {
      const diff = this.getGroupWeight(b, runtimeData) - this.getGroupWeight(a, runtimeData);
      return diff !== 0 ? diff : a.requireFile.localeCompare(b.requireFile);
    });
    for (const grp of sorted) {
      // Assign each group to the shard with the smallest current weight.
      let idx = 0;
      for (let i = 1; i < shards.length; i++) {
        if (shards[i].weight < shards[idx].weight)
          idx = i;
      }
      const w = this.getGroupWeight(grp, runtimeData);
      shards[idx].groups.add(grp);
      shards[idx].weight += w;
    }
    this._refineShards(shards, runtimeData);
    return shards;
  }

  private _refineShards(shards: Shard[], runtimeData?: { [testId: string]: number }): void {
    if (shards.length <= 1)
      return;
    shards.sort((a, b) => b.weight - a.weight);
    const pairs = Math.min(3, Math.floor(shards.length / 2));
    for (let i = 0; i < pairs; i++) {
      const heavy = shards[i], light = shards[shards.length - 1 - i];
      const diff = heavy.weight - light.weight;
      if (diff <= 0)
        continue;
      for (const grp of heavy.groups) {
        const w = this.getGroupWeight(grp, runtimeData);
        if (w < diff * 0.8) {
          heavy.groups.delete(grp);
          heavy.weight -= w;
          light.groups.add(grp);
          light.weight += w;
          break;
        }
      }
    }
  }

  async filterForShard(shard: { total: number; current: number }, testGroups: TestGroup[], config: FullConfigInternal): Promise<Set<TestGroup>> {
    this._groupWeightCache.clear();
    const uniqueFiles = new Set<string>();
    testGroups.forEach(grp => uniqueFiles.add(grp.requireFile));
    await this.processFiles([...uniqueFiles]);
    const lastRunReporter = new LastRunReporter(config);
    const lastRun = await lastRunReporter.lastRunInfo();
    const runtimeData = lastRun?.testDurations;
    const shardsArr = this.createShards(testGroups, shard.total, runtimeData);
    shardsArr.sort((a, b) => a.weight - b.weight);
    return shardsArr[shard.current - 1].groups;
  }

  async processFiles(files: string[]): Promise<void> {
    if (files.length < FILE_BATCH_SIZE || !this._workerPool?.hasWorkers()) {
      for (const f of files)
        this._fileCache.getComplexity(f);
      return;
    }
    const batchSize = 50;
    for (let i = 0; i < files.length; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      await Promise.all(batch.map(async f => {
        try {
          await this._workerPool!.analyzeFile(f);
        } catch {
          this._fileCache.getComplexity(f);
        }
      }));
    }
  }

  clearCaches(): void {
    this._fileCache.clear();
    this._suiteMetrics.clear();
    this._groupWeightCache.clear();
  }
}

function setupWorker(): void {
  if (isMainThread || !parentPort)
    return;
  parentPort.on('message', (msg: WorkerMessage) => {
    if (msg.type === 'analyzeFile') {
      const { filePath } = msg;
      try {
        const stats = fs.statSync(filePath);
        const size = stats.size;
        let complexity = 1.0;
        if (size <= 1024 * 1024) {
          const content = fs.readFileSync(filePath, 'utf8');
          const asserts = content.match(/assert|expect|should/g);
          if (asserts)
            complexity += Math.min(asserts.length / 100, 0.5);
          const asyncs = content.match(/async|await|setTimeout|setInterval|Promise/g);
          if (asyncs)
            complexity += Math.min(asyncs.length / 20, 0.3);
          if (/fetch\(|axios\.|http\./.test(content))
            complexity += 0.2;
        }
        parentPort!.postMessage({ type: 'result', filePath, metadata: { size, complexity } });
      } catch {
        parentPort!.postMessage({ type: 'result', filePath, metadata: { size: 0, complexity: 1.0 } });
      }
    }
  });
}

if (!isMainThread && workerData?.type === 'fileAnalyzer')
  setupWorker();

export async function createTestGroups(projectSuite: Suite, expectedParallelism: number): Promise<TestGroup[]> {
  const wp = new WorkerPool();
  if (isMainThread && [...projectSuite.allTests()].length > 1000)
    wp.init();
  const sharder = new TestSharding(wp);
  const groups = await sharder.createTestGroups(projectSuite, expectedParallelism);
  wp.close();
  return groups;
}

export async function filterForShard(shard: { total: number; current: number }, testGroups: TestGroup[], config: FullConfigInternal): Promise<Set<TestGroup>> {
  const wp = new WorkerPool();
  const sharder = new TestSharding(wp);
  try {
    return await sharder.filterForShard(shard, testGroups, config);
  } finally {
    wp.close();
  }
}
