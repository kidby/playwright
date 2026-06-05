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

import { expect as baseExpect, test as base } from 'playwright/test';

import { MobileTrace } from './mobileTrace.js';
import { MobileTraceZip } from './mobileTraceZip.js';
import { NativeDevice } from "./nativeDevice.js";
import { mobileMatchers } from './mobileMatchers.js';

import type { AppiumCapabilities } from './appiumClient.js';
import type { DeviceDescriptor } from './nativeDevice.js';
import type { AppiumConfig, PlaywrightTestOptions, PlaywrightWorkerOptions, TestFixture } from 'playwright/test';

export type { AppiumConfig };

// The standard playwright worker options (screenshot/video/trace) drive
// what the mobile fixture captures on each test. Mirrors the web flow:
//   - `screenshot: 'only-on-failure'` → mobile-screenshot + mobile-snapshot
//                                       + error-context attached when the
//                                       test fails.
//   - `screenshot: 'on'`             → same, on every run.
//   - `video: 'retain-on-failure'`   → record always, keep only on failure.
//   - `video: 'on'`                  → record always, always keep.
//   - `trace: 'on'`                  → appium-log attached on every run.
//   - `trace: 'retain-on-failure'`   → appium-log attached on failure.
// All default to `'off'` (matching upstream playwright defaults).
type MobileFixtureArgs = MobileFixtures
    & Pick<PlaywrightTestOptions, 'appium'>
    & Pick<PlaywrightWorkerOptions, 'screenshot' | 'video' | 'trace'>;

// Install web-first assertion matchers on Playwright's `expect`. The `extend`
// call mutates the singleton at runtime *and* returns a `MoreMatchers`-aware
// Expect — we re-export the typed one so consumers get autocomplete.
const extendedExpect = baseExpect.extend(mobileMatchers);

export type MobileFixtures = {
  appiumServerUrl: string;
  capabilities: AppiumCapabilities;
  descriptor: DeviceDescriptor | undefined;
  defaultActionTimeoutMs: number;
  device: NativeDevice;
};

export type MobileTestArgs = MobileFixtures;
export type MobileTestOptions = {
  appiumServerUrl?: string;
  capabilities?: AppiumCapabilities;
  descriptor?: DeviceDescriptor;
  defaultActionTimeoutMs?: number;
};

const DEFAULT_ACTION_TIMEOUT_LOCAL_MS = 20_000;
const DEFAULT_ACTION_TIMEOUT_CI_MS = 30_000;

const requireCapabilitiesFixture: TestFixture<AppiumCapabilities, MobileFixtureArgs> = async ({ appium }, use) => {
  if (appium?.capabilities) {
    await use(appium.capabilities as AppiumCapabilities);
    return;
  }
  throw new Error(
      'mobileTest: `capabilities` fixture not provided. Set `appium.capabilities` in playwright.config.ts use, or call test.use({ capabilities: androidCapabilities({...}) }).',
  );
};

const resolveServerUrl: TestFixture<string, MobileFixtureArgs> = async ({ appium }, use) => {
  await use(appium?.serverUrl ?? process.env.APPIUM_URL ?? 'http://127.0.0.1:4723');
};

export type AttachableTestInfo = {
  status?: string;
  expectedStatus?: string;
  retry?: number;
  attach(name: string, opts: { body: Buffer | string; contentType: string }): Promise<void>;
};

// True when the current test attempt either failed or didn't reach a stable
// state (errored, interrupted, timed out). Retains the previous helper's
// semantics so flaky tests still surface artifacts for each failed attempt.
export function shouldCaptureFailureArtifacts(status: AttachableTestInfo['status']): boolean {
  return status !== 'passed' && status !== 'skipped';
}

// Mirrors `normalizeVideoMode` / `shouldCaptureVideo` / `shouldPreserveVideo`
// from `packages/playwright/src/index.ts` — kept inline so the mobile fixture
// doesn't reach into a non-exported runtime API.
type CaptureMode = 'off' | 'on' | 'only-on-failure' | 'on-first-failure';
type VideoMode = 'off' | 'on' | 'retain-on-failure' | 'on-first-retry' | 'on-all-retries' | 'retain-on-first-failure' | 'retain-on-failure-and-retries';
type TraceMode = 'off' | 'on' | 'retain-on-failure' | 'on-first-retry' | 'on-all-retries' | 'retain-on-first-failure' | 'retain-on-failure-and-retries';

function modeFrom<T extends string>(opt: T | { mode: T } | undefined, fallback: T): T {
  if (opt === undefined)
    return fallback;
  return typeof opt === 'string' ? opt : opt.mode;
}

function shouldCaptureOnFailure(mode: CaptureMode, testInfo: AttachableTestInfo): boolean {
  if (mode === 'on')
    return true;
  const failed = testInfo.status !== undefined && testInfo.status !== 'passed' && testInfo.status !== 'skipped';
  if (mode === 'only-on-failure')
    return failed;
  if (mode === 'on-first-failure')
    return failed && (testInfo.retry ?? 0) === 0;
  return false;
}

function shouldStartVideo(mode: VideoMode, testInfo: AttachableTestInfo): boolean {
  switch (mode) {
    case 'on':
    case 'retain-on-failure':
    case 'retain-on-failure-and-retries':
      return true;
    case 'on-first-retry':
      return (testInfo.retry ?? 0) === 1;
    case 'on-all-retries':
      return (testInfo.retry ?? 0) > 0;
    case 'retain-on-first-failure':
      return (testInfo.retry ?? 0) === 0;
    default:
      return false;
  }
}

function shouldKeepVideo(mode: VideoMode, testInfo: AttachableTestInfo): boolean {
  const failed = testInfo.status !== undefined && testInfo.status !== testInfo.expectedStatus;
  switch (mode) {
    case 'on':
    case 'on-first-retry':
    case 'on-all-retries':
      return true;
    case 'retain-on-failure':
    case 'retain-on-first-failure':
      return failed;
    case 'retain-on-failure-and-retries':
      return failed || (testInfo.retry ?? 0) > 0;
    default:
      return false;
  }
}

function shouldKeepTrace(mode: TraceMode, testInfo: AttachableTestInfo): boolean {
  // Symmetric with shouldKeepVideo — same mode set, same semantics.
  return shouldKeepVideo(mode as unknown as VideoMode, testInfo);
}

function formatMobileErrorContext(pageSource: string): string {
  const truncated = pageSource.length > 64 * 1024 ? pageSource.slice(0, 64 * 1024) + '\n<!-- truncated -->\n' : pageSource;
  return [
    '# Mobile failure context',
    '',
    'Page source at failure (Appium):',
    '',
    '```xml',
    truncated,
    '```',
  ].join('\n');
}

async function attachScreenshotArtifacts(device: NativeDevice, testInfo: AttachableTestInfo): Promise<void> {
  try {
    const png = await device.screenshot();
    if (png?.length)
      await testInfo.attach('mobile-screenshot', { body: png, contentType: 'image/png' });
  } catch { /* best-effort */ }
  try {
    const yaml = await device.snapshot();
    if (yaml)
      await testInfo.attach('mobile-snapshot', { body: yaml, contentType: 'application/x-yaml' });
  } catch { /* best-effort */ }
  try {
    const pageSource = await device.pageSource();
    if (pageSource) {
      const md = formatMobileErrorContext(pageSource);
      await testInfo.attach('error-context', { body: md, contentType: 'text/markdown' });
    }
  } catch { /* best-effort */ }
}

// Back-compat: keeps the previous always-on capture behaviour available for
// callers that didn't go through the standard playwright config. Equivalent
// to `screenshot: 'only-on-failure'` semantics.
export async function captureFailureArtifacts(device: NativeDevice, testInfo: AttachableTestInfo): Promise<void> {
  await attachScreenshotArtifacts(device, testInfo);
}

// `appium` is declared in `PlaywrightTestOptions` (test.d.ts) as a top-level
// config field, but Playwright's fixture engine only resolves *fixtures*,
// not raw config fields. The `capabilities` fixture below destructures it,
// so we declare it here as an option-fixture with `undefined` default. Users
// override it via `test.use({ appium: { capabilities: ... } })` or by
// providing the `capabilities` fixture directly.
export const mobileTest = base.extend<MobileFixtures & { appium: PlaywrightTestOptions['appium'] }>({
  appium: [undefined, { option: true }] as unknown as PlaywrightTestOptions['appium'],
  appiumServerUrl: [resolveServerUrl, { option: true }],
  capabilities: [requireCapabilitiesFixture, { option: true }],
  descriptor: [undefined, { option: true }],
  defaultActionTimeoutMs: [process.env.CI ? DEFAULT_ACTION_TIMEOUT_CI_MS : DEFAULT_ACTION_TIMEOUT_LOCAL_MS, { option: true }],
  device: async ({ appiumServerUrl, capabilities, descriptor, defaultActionTimeoutMs, screenshot, video, trace }, use, testInfo) => {
    const screenshotMode = modeFrom(screenshot as CaptureMode | { mode: CaptureMode } | undefined, 'off');
    const videoMode = modeFrom(video as VideoMode | { mode: VideoMode } | undefined, 'off');
    const traceMode = modeFrom(trace as TraceMode | { mode: TraceMode } | undefined, 'off');

    const device = await NativeDevice.start(appiumServerUrl, capabilities, { descriptor });
    device.defaultActionTimeoutMs = defaultActionTimeoutMs;

    // Start screen recording only when the configured video mode wants it on
    // this run. Best-effort: drivers without recording support fall through
    // silently and the test still runs.
    let videoRecording = false;
    if (shouldStartVideo(videoMode, testInfo)) {
      try {
        await device.startScreenRecording();
        videoRecording = true;
      } catch { /* recording unsupported */ }
    }

    // Mobile trace recorders: both formats run in parallel when the `trace`
    // mode wants this run captured.
    //   - MobileTrace     → self-contained `mobile-trace.html` (Option 1)
    //   - MobileTraceZip  → Playwright-format `.zip` that opens in
    //                       `npx playwright show-trace` (Option 2)
    // Both attach so users can pick: the .html for quick offline review,
    // the .zip for full Playwright trace-viewer integration.
    let tracer: MobileTrace | undefined;
    let zipTracer: MobileTraceZip | undefined;
    if (shouldStartVideo(traceMode as unknown as VideoMode, testInfo)) {
      tracer = new MobileTrace(device);
      tracer.start();
      zipTracer = new MobileTraceZip(device);
      zipTracer.start(typeof testInfo === 'object' && testInfo !== null && 'title' in testInfo ? String((testInfo as { title?: unknown }).title) : undefined);
    }

    try {
      await use(device);
    } finally {
      // Stop the tracers first so a final page-source snapshot lands in the
      // trace before any teardown shifts the device state.
      if (tracer) {
        await tracer.recordPageSource('teardown').catch(() => undefined);
        tracer.stop(testInfo.status);
      }
      if (zipTracer) {
        await zipTracer.recordPageSource('teardown').catch(() => undefined);
        if (testInfo.status && testInfo.status !== testInfo.expectedStatus)
          zipTracer.recordError(`Test ${testInfo.status}`);
        zipTracer.stop();
      }

      // Screenshot/snapshot/error-context: per the standard `screenshot` mode.
      if (shouldCaptureOnFailure(screenshotMode, testInfo))
        await attachScreenshotArtifacts(device, testInfo);

      // Video: per the standard `video` mode. Stop the recording always (so
      // the device doesn't keep buffering), but only attach when the mode
      // says we should preserve it.
      if (videoRecording) {
        try {
          const mp4 = await device.stopScreenRecording();
          if (shouldKeepVideo(videoMode, testInfo) && mp4?.length)
            await testInfo.attach('video', { body: mp4, contentType: 'video/mp4' });
        } catch { /* stop failures shouldn't block teardown */ }
      }

      // Appium log + mobile trace viewer: per the standard `trace` mode.
      // The WebDriver call log is the closest mobile-side analogue to
      // playwright's tracing surface; the trace viewer adds a visual
      // timeline of screenshots + actions for replay.
      if (shouldKeepTrace(traceMode, testInfo)) {
        try {
          const logText = device.client.formatLog();
          if (logText)
            await testInfo.attach('appium-log', { body: logText, contentType: 'text/plain' });
        } catch { /* best-effort */ }
        if (tracer && !tracer.isEmpty()) {
          try {
            await testInfo.attach('mobile-trace.html', { body: tracer.toHtml(), contentType: 'text/html' });
          } catch { /* best-effort */ }
        }
        if (zipTracer && !zipTracer.isEmpty()) {
          try {
            const zipBytes = await zipTracer.build();
            await testInfo.attach('mobile-trace.zip', { body: zipBytes, contentType: 'application/zip' });
          } catch { /* best-effort */ }
        }
      }

      await device.stop().catch(() => undefined);
    }
  },
});

export const expect = extendedExpect;
