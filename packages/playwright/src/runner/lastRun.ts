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
import path from 'path';

import type { FullResult, Suite } from '../../types/testReporter';
import type { config as commonConfig } from '../common/index.js';
import type { ReporterV2 } from '../reporters/reporterV2.js';

export type LastRunInfo = {
  status: FullResult['status'];
  failedTests: string[];
  // Per-test wall-clock duration in ms, summed across attempts. Used by
  // the `duration-round-robin` sharding mode to balance shards by cost.
  testDurations?: { [testId: string]: number };
};

export class LastRunReporter implements ReporterV2 {
  private _lastRunFile: string | undefined;
  private _suite: Suite | undefined;
  private _listMode: boolean;

  constructor(filteredProjects: commonConfig.FullProjectInternal[], listMode?: boolean, lastFailedFileOverride?: string) {
    this._listMode = !!listMode;
    const override = lastFailedFileOverride ?? process.env.PLAYWRIGHT_LAST_RUN_OUTPUT_FILE;
    if (override) {
      this._lastRunFile = path.resolve(process.cwd(), override);
    } else {
      const [project] = filteredProjects;
      if (project)
        this._lastRunFile = path.join(project.project.outputDir, '.last-run.json');
    }
  }

  // The resolved path of the `.last-run.json` file used for this run, or
  // `undefined` if no project / override was supplied. Exposed so the
  // sharding layer can read the same file without re-implementing the
  // resolution logic.
  get lastRunFile(): string | undefined {
    return this._lastRunFile;
  }

  // Reads and parses the `.last-run.json`. Returns undefined when missing
  // or unreadable. Used by `duration-round-robin` sharding to weigh test
  // groups by previous-run duration.
  async lastRunInfo(): Promise<LastRunInfo | undefined> {
    if (!this._lastRunFile)
      return undefined;
    try {
      return JSON.parse(await fs.promises.readFile(this._lastRunFile, 'utf8')) as LastRunInfo;
    } catch {
      return undefined;
    }
  }

  async filterLastFailed(): Promise<string[]> {
    const info = await this.lastRunInfo();
    return info?.failedTests ?? [];
  }

  version(): 'v2' {
    return 'v2';
  }

  printsToStdio() {
    return false;
  }

  onBegin(suite: Suite) {
    this._suite = suite;
  }

  async onEnd(result: FullResult) {
    if (!this._lastRunFile || this._listMode)
      return;
    const allTests = this._suite?.allTests() ?? [];
    const testDurations: { [testId: string]: number } = {};
    for (const t of allTests)
      testDurations[t.id] = t.results.reduce((sum, r) => sum + r.duration, 0);
    const lastRunInfo: LastRunInfo = {
      status: result.status,
      failedTests: allTests.filter(t => !t.ok()).map(t => t.id),
      testDurations,
    };
    await fs.promises.mkdir(path.dirname(this._lastRunFile), { recursive: true });
    await fs.promises.writeFile(this._lastRunFile, JSON.stringify(lastRunInfo, undefined, 2));
  }
}
