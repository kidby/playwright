/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
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

import crypto from 'node:crypto';
import yazl from 'yazl';

import type { NativeDevice } from './nativeDevice.js';
import type { SessionLogEntry } from './appiumClient.js';

// Mobile trace recorder that emits a Playwright-format trace.zip. Output
// opens directly in `npx playwright show-trace <file>` and renders in the
// existing trace viewer alongside web traces. Mobile concepts map to the
// closest trace-event types — see the table in README/divergences.
//
// Mapping:
//   session-start         → context-options (sets up the recording header)
//   AppLocator.<action>   → before + after action events
//   screenshot            → screencast-frame + resources/<sha1> PNG blob
//   page-source           → event (carries XML as params for inspection)
//   appium WebDriver call → event
//   error / status        → error event on stop
//
// The zip layout matches what `playwright-core/src/server/trace/recorder/tracing.ts`
// writes: trace.trace (NDJSON), trace.network (empty for mobile), resources/<sha1>.

const TRACE_VERSION = 7;

// Subset of trace event types we emit. Schema matches `packages/trace/src/trace.ts`.
type StackFrame = { file: string; line: number; column: number; function?: string };

type ContextCreatedTraceEvent = {
  version: number;
  type: 'context-options';
  origin: 'testRunner' | 'library';
  browserName: string;
  channel?: string;
  platform: string;
  playwrightVersion?: string;
  wallTime: number;
  monotonicTime: number;
  title?: string;
  options: Record<string, unknown>;
  sdkLanguage?: string;
  testIdAttributeName?: string;
  contextId?: string;
  testTimeout?: number;
};

type BeforeActionTraceEvent = {
  type: 'before';
  callId: string;
  startTime: number;
  title?: string;
  class: string;
  method: string;
  params: Record<string, unknown>;
  stack?: StackFrame[];
  pageId?: string;
};

type AfterActionTraceEvent = {
  type: 'after';
  callId: string;
  endTime: number;
  error?: { name: string; message: string; stack?: string };
};

type EventTraceEvent = {
  type: 'event';
  time: number;
  class: string;
  method: string;
  params: Record<string, unknown>;
  pageId?: string;
};

type ScreencastFrameTraceEvent = {
  type: 'screencast-frame';
  pageId: string;
  sha1: string;
  width: number;
  height: number;
  timestamp: number;
};

type ErrorTraceEvent = {
  type: 'error';
  message: string;
  stack?: StackFrame[];
};

type TraceEvent =
    | ContextCreatedTraceEvent
    | BeforeActionTraceEvent
    | AfterActionTraceEvent
    | EventTraceEvent
    | ScreencastFrameTraceEvent
    | ErrorTraceEvent;

const PAGE_ID = 'mobile-page-1';
const ACTION_PATH = /\/(click|value|clear|back|forward|active)\b|\/execute(\/sync)?$/;

function nowMs(): number {
  return Date.now();
}

export class MobileTraceZip {
  private readonly _device: NativeDevice;
  private readonly _events: TraceEvent[] = [];
  private readonly _resources = new Map<string, Buffer>();  // sha1 → bytes
  private _callId = 0;
  private _startWallTime = 0;
  private _started = false;
  private _stopped = false;
  private _screenshotCount = 0;
  private _lastScreenshotMs = -Infinity;
  private readonly _maxScreenshots = 200;
  private readonly _screenshotMinGapMs = 150;

  constructor(device: NativeDevice) {
    this._device = device;
  }

  private _unsubscribe: (() => void) | undefined;

  start(title?: string): void {
    if (this._started)
      return;
    this._started = true;
    this._startWallTime = nowMs();
    const caps = this._device.client.capabilities ?? {};
    this._events.push({
      version: TRACE_VERSION,
      type: 'context-options',
      origin: 'testRunner',
      browserName: 'mobile',
      platform: (caps as { platformName?: string }).platformName ?? 'mobile',
      wallTime: this._startWallTime,
      monotonicTime: 0,
      title,
      options: sanitizeOptions(caps as Record<string, unknown>),
      sdkLanguage: 'javascript',
      contextId: this._device.client.sessionId ?? 'mobile-session',
    });
    // Subscribe to AppiumClient call stream.
    this._unsubscribe = this._device.client.subscribeCalls((entry, kind) => {
      this._onAppiumCall(entry, kind);
    });
  }

  private _onAppiumCall(entry: SessionLogEntry, kind: 'action' | 'read' | 'session'): void {
    if (!this._started || this._stopped)
      return;
    if (kind === 'action' && entry.status === 'ok') {
      const callId = `appium@${++this._callId}`;
      this._events.push({
        type: 'before',
        callId,
        startTime: entry.ts,
        title: `${entry.method} ${entry.path}`,
        class: 'Appium',
        method: entry.method,
        params: { path: entry.path },
        pageId: PAGE_ID,
      });
      // Treat the call as instantaneous from the trace's POV; after-event
      // follows immediately. Real timing comes from the screenshot frame.
      this._events.push({
        type: 'after',
        callId,
        endTime: entry.ts,
      });
      // Best-effort: schedule a screenshot capture after the action settles.
      void this._maybeCaptureScreenshot(entry.ts);
    } else {
      this._events.push({
        type: 'event',
        time: entry.ts,
        class: 'Appium',
        method: entry.method,
        params: { path: entry.path, status: entry.status, ...(entry.err ? { error: entry.err } : {}) },
        pageId: PAGE_ID,
      });
    }
  }

  recordAction(name: string, args?: unknown): void {
    if (!this._started || this._stopped)
      return;
    const startTime = nowMs() - this._startWallTime;
    const callId = `mobile@${++this._callId}`;
    this._events.push({
      type: 'before',
      callId,
      startTime,
      title: name,
      class: 'AppLocator',
      method: name,
      params: args === undefined ? {} : { args: safeJson(args) },
      pageId: PAGE_ID,
    });
    this._events.push({
      type: 'after',
      callId,
      endTime: startTime,
    });
  }

  async recordPageSource(label?: string): Promise<void> {
    if (!this._started || this._stopped)
      return;
    try {
      const xml = await this._device.pageSource();
      if (!xml)
        return;
      this._events.push({
        type: 'event',
        time: nowMs() - this._startWallTime,
        class: 'Page',
        method: 'pageSource',
        params: { label: label ?? 'snapshot', xml: xml.length > 64 * 1024 ? xml.slice(0, 64 * 1024) + '\n<!-- truncated -->' : xml },
        pageId: PAGE_ID,
      });
    } catch { /* best-effort */ }
  }

  recordError(message: string): void {
    if (!this._started || this._stopped)
      return;
    this._events.push({
      type: 'error',
      message,
    });
  }

  stop(): void {
    if (!this._started || this._stopped)
      return;
    this._stopped = true;
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }

  isEmpty(): boolean {
    return this._events.length <= 1;
  }

  async build(): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const zipFile = new yazl.ZipFile();
      const ndjson = this._events.map(e => JSON.stringify(e)).join('\n') + '\n';
      zipFile.addBuffer(Buffer.from(ndjson, 'utf8'), 'trace.trace');
      // Empty network stream — mobile doesn't capture HTTP traffic at this layer.
      zipFile.addBuffer(Buffer.from('', 'utf8'), 'trace.network');
      for (const [sha1, bytes] of this._resources)
        zipFile.addBuffer(bytes, `resources/${sha1}`);
      const chunks: Buffer[] = [];
      zipFile.outputStream.on('data', (c: Buffer) => chunks.push(c));
      zipFile.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
      zipFile.outputStream.on('error', reject);
      zipFile.end();
    });
  }

  private async _maybeCaptureScreenshot(ts: number): Promise<void> {
    if (this._screenshotCount >= this._maxScreenshots)
      return;
    if (ts - this._lastScreenshotMs < this._screenshotMinGapMs)
      return;
    this._lastScreenshotMs = ts;
    try {
      const png = await this._device.screenshot();
      if (!png?.length)
        return;
      this._screenshotCount++;
      const sha1 = crypto.createHash('sha1').update(png).digest('hex');
      if (!this._resources.has(sha1))
        this._resources.set(sha1, png);
      // Try to derive viewport dimensions from PNG header so the viewer
      // can place the frame correctly. PNG signature (8) + IHDR (4 len + 4 type + 4 width + 4 height).
      let width = 0;
      let height = 0;
      if (png.length >= 24 && png.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
        width = png.readUInt32BE(16);
        height = png.readUInt32BE(20);
      }
      this._events.push({
        type: 'screencast-frame',
        pageId: PAGE_ID,
        sha1,
        width,
        height,
        timestamp: nowMs() - this._startWallTime,
      });
    } catch { /* best-effort */ }
  }
}

function sanitizeOptions(caps: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(caps)) {
    if (/password|token|key|secret/i.test(k))
      continue;
    out[k] = v;
  }
  return out;
}

function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

export function isActionPath(path: string): boolean {
  return ACTION_PATH.test(path);
}
