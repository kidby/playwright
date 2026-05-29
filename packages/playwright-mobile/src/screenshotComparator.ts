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

// Wraps Playwright's vendored PNG comparator for the mobile matchers. The
// flow mirrors the web `toHaveScreenshot`: capture, optionally wait for the
// frame to stabilize, then either write the baseline (update mode) or
// diff against it.

import fs from 'fs';
import path from 'path';

import { PNG } from 'pngjs';

export type ImageComparatorOptions = {
  threshold?: number;
  maxDiffPixels?: number;
  maxDiffPixelRatio?: number;
};

export type MobileScreenshotOptions = ImageComparatorOptions & {
  // Outer matcher timeout — gates the whole capture+stabilize+compare flow.
  timeout?: number;
  // Names override the default `${testTitle}-${platform}.png` baseline.
  name?: string | string[];
  // Snapshot write/update mode — wired from the runner. Defaults to
  // 'missing' (write only if absent); 'all' refreshes every baseline.
  updateSnapshots?: 'all' | 'none' | 'missing';
  // Stabilization: keep capturing until two consecutive frames diff under
  // the threshold. Defaults to 2 stable frames at the same `pollMs` cadence
  // as the locator.
  stabilizationFrames?: number;
  pollMs?: number;
  // Hard cap on stabilization — falls back to a single capture once hit.
  // Independent of the matcher's outer timeout, which gates the whole
  // matcher (capture + stabilize + compare).
  stabilizationTimeoutMs?: number;
};

export type StabilizedCapture = (capture: () => Promise<Buffer>, opts: { stabilizationFrames: number; pollMs: number; deadline: number }) => Promise<Buffer>;

// Capture the same surface twice in a row and verify the diff is under
// threshold before committing. Burns the last unstable buffer until either
// stabilization succeeds or the deadline fires (in which case we ship the
// last frame and let the outer compare decide).
export const stabilize: StabilizedCapture = async (capture, opts) => {
  let prev = await capture();
  let stable = 1;
  while (stable < opts.stabilizationFrames) {
    if (Date.now() > opts.deadline)
      return prev;
    await sleep(opts.pollMs);
    const next = await capture();
    const result = compareImageBuffers(next, prev, { threshold: 0 });
    if (result === null)
      stable++;
    else
      stable = 1;
    prev = next;
  }
  return prev;
};

export type CompareResult =
  | { mode: 'pass' }
  | { mode: 'written'; path: string }
  | { mode: 'fail'; message: string; actual: Buffer; expected?: Buffer; diff?: Buffer; actualPath: string; expectedPath?: string; diffPath?: string };

// Resolves an absolute baseline path and runs the compare. The runner is
// expected to pass in `baselineDir` (typically `testInfo.snapshotDir`) so
// the baselines land alongside the test, not in cwd.
export function compareToBaseline(
  baselineDir: string,
  baselineFilename: string,
  actual: Buffer,
  options: MobileScreenshotOptions,
): CompareResult {
  const baselinePath = path.join(baselineDir, baselineFilename);
  const updateMode = options.updateSnapshots ?? 'missing';
  const exists = fs.existsSync(baselinePath);

  if (!exists && updateMode === 'none') {
    return {
      mode: 'fail',
      message: `Baseline image missing: ${baselinePath}\n  Run with --update-snapshots to create it.`,
      actual,
      actualPath: writeArtifact(baselineDir, baselineFilename, 'actual', actual),
    };
  }

  if (!exists || updateMode === 'all') {
    fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
    fs.writeFileSync(baselinePath, actual);
    return { mode: 'written', path: baselinePath };
  }

  const expected = fs.readFileSync(baselinePath);
  const result = compareImageBuffers(actual, expected, {
    threshold: options.threshold,
    maxDiffPixels: options.maxDiffPixels,
    maxDiffPixelRatio: options.maxDiffPixelRatio,
  });
  if (result === null)
    return { mode: 'pass' };

  const actualPath = writeArtifact(baselineDir, baselineFilename, 'actual', actual);
  const expectedPath = writeArtifact(baselineDir, baselineFilename, 'expected', expected);
  const diffPath = result.diff ? writeArtifact(baselineDir, baselineFilename, 'diff', result.diff) : undefined;
  return {
    mode: 'fail',
    message: result.errorMessage,
    actual,
    expected,
    diff: result.diff,
    actualPath,
    expectedPath,
    diffPath,
  };
}

type ComparatorResult = { errorMessage: string; diff?: Buffer } | null;

// Pure-JS PNG comparator. Not as smart as pixelmatch's perceptual metric,
// but sufficient for mobile-screenshot regression testing — sub-pixel
// font drift is rare on the same device/version, and `threshold` lets
// users opt into more tolerance.
//
// Returns `null` on match. On mismatch: `errorMessage` with the diff
// count, `diff` populated with a red-highlight PNG when sizes match.
function compareImageBuffers(actualBuf: Buffer, expectedBuf: Buffer, options: ImageComparatorOptions): ComparatorResult {
  let actual: PNG;
  let expected: PNG;
  try {
    actual = PNG.sync.read(actualBuf);
    expected = PNG.sync.read(expectedBuf);
  } catch (err) {
    return { errorMessage: `Failed to decode PNG: ${(err as Error).message}` };
  }
  if (actual.width !== expected.width || actual.height !== expected.height) {
    return {
      errorMessage: `Image sizes differ: actual ${actual.width}×${actual.height} vs expected ${expected.width}×${expected.height}.`,
    };
  }

  const threshold = options.threshold ?? 0.2;
  const total = actual.width * actual.height;
  const diff = new PNG({ width: actual.width, height: actual.height });
  let diffCount = 0;
  const maxColorDistSq = threshold * threshold * (255 * 255 * 3);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const dr = actual.data[o] - expected.data[o];
    const dg = actual.data[o + 1] - expected.data[o + 1];
    const db = actual.data[o + 2] - expected.data[o + 2];
    const da = actual.data[o + 3] - expected.data[o + 3];
    const distSq = dr * dr + dg * dg + db * db + da * da;
    if (distSq > maxColorDistSq) {
      diffCount++;
      diff.data[o] = 255;
      diff.data[o + 1] = 0;
      diff.data[o + 2] = 0;
      diff.data[o + 3] = 255;
    } else {
      diff.data[o] = expected.data[o];
      diff.data[o + 1] = expected.data[o + 1];
      diff.data[o + 2] = expected.data[o + 2];
      diff.data[o + 3] = 64;
    }
  }
  if (diffCount === 0)
    return null;

  const ratio = diffCount / total;
  const maxDiffPixels = options.maxDiffPixels;
  const maxDiffPixelRatio = options.maxDiffPixelRatio;
  if (maxDiffPixels !== undefined && diffCount <= maxDiffPixels)
    return null;
  if (maxDiffPixelRatio !== undefined && ratio <= maxDiffPixelRatio)
    return null;

  return {
    errorMessage: `Screenshot comparison failed: ${diffCount} pixel(s) differ (ratio ${ratio.toFixed(4)}, threshold ${threshold}).`,
    diff: PNG.sync.write(diff),
  };
}

function writeArtifact(baselineDir: string, baselineFilename: string, kind: 'actual' | 'expected' | 'diff', buf: Buffer): string {
  const base = baselineFilename.replace(/\.png$/i, '');
  const out = path.join(baselineDir, `${base}-${kind}.png`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  return out;
}

// Used by the matcher to derive a stable filename per platform/device.
export function defaultBaselineName(parts: { testTitle: string; platform?: string; deviceName?: string; scaleFactor?: number; override?: string | string[] }): string {
  if (parts.override) {
    const arr = Array.isArray(parts.override) ? parts.override : [parts.override];
    const last = arr[arr.length - 1];
    return /\.png$/i.test(last) ? path.join(...arr) : `${path.join(...arr)}.png`;
  }
  const scaleSeg = parts.scaleFactor && parts.scaleFactor > 0 ? `@${parts.scaleFactor}x` : undefined;
  const segs = [parts.testTitle, parts.platform, parts.deviceName, scaleSeg].filter(Boolean) as string[];
  return `${segs.join('-').replace(/[^A-Za-z0-9._@-]+/g, '-')}.png`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
