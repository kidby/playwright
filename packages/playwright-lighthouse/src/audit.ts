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

import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  LighthouseCategory,
  LighthouseOptions,
  LighthouseReportFormat,
  LighthouseResult,
  LighthouseThresholds,
  Page,
} from './types.js';
import type * as LH from 'lighthouse/types/lh.js';

const DEFAULT_THRESHOLDS: Required<LighthouseThresholds> = {
  performance: 100,
  accessibility: 100,
  'best-practices': 100,
  seo: 100,
  pwa: 100,
};

const PAGE_PORT = Symbol.for('@playwright/lighthouse.port');
type PageWithPort = Page & { [PAGE_PORT]?: number };

/** Internal — used by the fixture to bind a CDP port to a page. */
export function attachPort(page: Page, port: number): void {
  (page as PageWithPort)[PAGE_PORT] = port;
}

/**
 * Run a Lighthouse audit against a Playwright page.
 *
 * The page must be running in a Chromium instance launched with `--remote-debugging-port`.
 * When using the `lighthouseTest` fixture, the port is wired automatically. Otherwise pass
 * `options.port` explicitly.
 */
export async function audit(page: Page, options: LighthouseOptions = {}): Promise<LighthouseResult> {
  const port = options.port ?? (page as PageWithPort)[PAGE_PORT];
  if (!port)
    throw new Error('@playwright/lighthouse: a CDP port is required. Pass `port` explicitly or use the `lighthouseTest` fixture.');

  const url = options.url ?? page.url();
  if (!url || url === 'about:blank')
    throw new Error('@playwright/lighthouse: page has no URL yet — call `await page.goto(...)` before auditing.');

  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;

  const { default: lighthouseRun } = await import('lighthouse');
  const flags: LH.Flags = { disableStorageReset: true, ...(options.flags ?? {}), port };
  if (!flags.onlyCategories)
    flags.onlyCategories = Object.keys(thresholds);

  const runnerResult = await lighthouseRun(url, flags, options.config);
  if (!runnerResult)
    throw new Error('@playwright/lighthouse: lighthouse returned no result');

  const scores = scoreCategories(runnerResult.lhr);
  const { failures, successes } = compare(thresholds, scores);
  const reportPaths = options.saveReport ? await writeReports(runnerResult.lhr, options) : [];

  const result: LighthouseResult = {
    passed: failures.length === 0,
    scores,
    failures,
    successes,
    reportPaths,
    lhr: runnerResult.lhr,
  };

  if (!result.passed && options.throwOnFail)
    throw new Error(`@playwright/lighthouse: thresholds not met\n  ${failures.join('\n  ')}`);

  return result;
}

function scoreCategories(lhr: LH.Result): Partial<Record<LighthouseCategory, number>> {
  const scores: Partial<Record<LighthouseCategory, number>> = {};
  for (const key of Object.keys(lhr.categories)) {
    const category = key as LighthouseCategory;
    const raw = lhr.categories[category]?.score;
    if (raw !== null && raw !== undefined)
      scores[category] = Math.round(raw * 100);
  }
  return scores;
}

function compare(thresholds: LighthouseThresholds, scores: Partial<Record<LighthouseCategory, number>>) {
  const failures: string[] = [];
  const successes: string[] = [];
  for (const key of Object.keys(thresholds)) {
    const category = key as LighthouseCategory;
    const threshold = thresholds[category];
    const score = scores[category];
    if (threshold === undefined || score === undefined)
      continue;
    if (score < threshold)
      failures.push(`${category}: scored ${score}, expected >= ${threshold}`);
    else
      successes.push(`${category}: scored ${score} (>= ${threshold})`);
  }
  return { failures, successes };
}

async function writeReports(lhr: LH.Result, options: LighthouseOptions): Promise<string[]> {
  const directory = options.outputDir ?? path.join(process.cwd(), 'lighthouse');
  const name = options.reportName ?? `lighthouse-${Date.now()}`;
  const formats: LighthouseReportFormat[] = Array.isArray(options.saveReport)
    ? options.saveReport
    : [options.saveReport!];

  const { ReportGenerator } = await import('lighthouse/report/generator/report-generator.js');
  await fs.mkdir(directory, { recursive: true });
  const paths: string[] = [];
  for (const format of formats) {
    const body = ReportGenerator.generateReport(lhr, format);
    const filePath = path.join(directory, `${name}.${format}`);
    await fs.writeFile(filePath, body as string);
    paths.push(filePath);
  }
  return paths;
}
