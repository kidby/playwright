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

import type { NativeDevice } from './nativeDevice.js';

// Mobile-side trace recorder. Captures a timeline of user-visible actions,
// post-action screenshots, page sources, and the underlying Appium calls
// so a failure can be replayed visually in `mobile-trace.html` (a self-
// contained viewer attached to the Playwright HTML report).
//
// Driven by the standard playwright `trace` config option: when `'on'`,
// `'retain-on-failure'`, etc. matches the current run, the mobile fixture
// instantiates and starts this tracer at session begin, stops at session
// end, and attaches the rendered HTML.

export type MobileTraceEventKind =
  | 'session-start'
  | 'action'
  | 'screenshot'
  | 'page-source'
  | 'appium-call'
  | 'session-end';

export type MobileTraceEvent = {
  ts: number;           // ms since trace start
  kind: MobileTraceEventKind;
  data: Record<string, unknown>;
};

const MAX_SCREENSHOTS = 200;
const SCREENSHOT_MIN_GAP_MS = 150;

// Heuristic: which WebDriver paths represent user-visible actions? After
// these, the trace recorder grabs a screenshot so the timeline shows the
// visual result of the action.
const ACTION_PATH = /\/(click|value|clear|back|forward|displayed|enabled|selected|attribute)\b|\/execute(\/sync)?$/;

export class MobileTrace {
  private readonly _device: NativeDevice;
  private readonly _events: MobileTraceEvent[] = [];
  private _startMs = 0;
  private _screenshotCount = 0;
  private _lastScreenshotTs = -Infinity;
  private _started = false;
  private _stopped = false;
  private _unsubscribe: (() => void) | undefined;

  constructor(device: NativeDevice) {
    this._device = device;
  }

  start(): void {
    if (this._started)
      return;
    this._started = true;
    this._startMs = Date.now();
    this._events.push({
      ts: 0,
      kind: 'session-start',
      data: {
        sessionId: this._device.client.sessionId,
        capabilities: sanitizeCapabilities(this._device.client.capabilities),
      },
    });
    // Hook the Appium client so every WebDriver call lands in the trace.
    this._unsubscribe = this._device.client.subscribeCalls((entry, kind) => {
      const ts = Date.now() - this._startMs;
      this._events.push({
        ts,
        kind: 'appium-call',
        data: { ...entry },
      });
      if (kind === 'action' && entry.status === 'ok')
        void this._maybeCaptureScreenshot(ts);
    });
  }

  recordAction(name: string, args?: unknown): void {
    if (!this._started || this._stopped)
      return;
    this._events.push({
      ts: Date.now() - this._startMs,
      kind: 'action',
      data: { name, args: args === undefined ? undefined : safeJson(args) },
    });
  }

  async recordPageSource(label?: string): Promise<void> {
    if (!this._started || this._stopped)
      return;
    try {
      const xml = await this._device.pageSource();
      if (xml) {
        this._events.push({
          ts: Date.now() - this._startMs,
          kind: 'page-source',
          data: { label, xml: xml.length > 64 * 1024 ? xml.slice(0, 64 * 1024) + '<!-- truncated -->' : xml },
        });
      }
    } catch { /* best-effort */ }
  }

  stop(status?: string): void {
    if (!this._started || this._stopped)
      return;
    this._stopped = true;
    this._unsubscribe?.();
    this._unsubscribe = undefined;
    this._events.push({
      ts: Date.now() - this._startMs,
      kind: 'session-end',
      data: { status },
    });
  }

  isEmpty(): boolean {
    return this._events.length <= 1;
  }

  toJson(): string {
    return JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - this._startMs,
      events: this._events,
    });
  }

  toHtml(): string {
    return buildViewerHtml(this.toJson());
  }

  private async _maybeCaptureScreenshot(ts: number): Promise<void> {
    if (this._screenshotCount >= MAX_SCREENSHOTS)
      return;
    if (ts - this._lastScreenshotTs < SCREENSHOT_MIN_GAP_MS)
      return;
    this._lastScreenshotTs = ts;
    try {
      const png = await this._device.screenshot();
      if (!png?.length)
        return;
      this._screenshotCount++;
      this._events.push({
        ts: Date.now() - this._startMs,
        kind: 'screenshot',
        data: { pngBase64: png.toString('base64'), bytes: png.length },
      });
    } catch { /* screenshots are best-effort */ }
  }
}

export function isActionPath(path: string): boolean {
  return ACTION_PATH.test(path);
}

function safeJson(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function sanitizeCapabilities(caps: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!caps)
    return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(caps)) {
    if (/password|token|key|secret/i.test(k))
      continue;
    out[k] = v;
  }
  return out;
}

function buildViewerHtml(traceJson: string): string {
  // Self-contained viewer. Inlines trace data so the file works offline,
  // opens directly from the Playwright HTML report. No external deps.
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Mobile Trace</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 13px/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; background: #fafafa; color: #111; }
  @media (prefers-color-scheme: dark) { body { background: #0e1116; color: #ddd; } .panel { background: #1a1e25; border-color: #2d333b; } .ev { border-color: #2d333b; } .ev:hover { background: #1f242c; } .ev.selected { background: #2a3140; } .meta { color: #8b949e; } }
  header { padding: 12px 16px; background: linear-gradient(180deg, rgba(0,0,0,0.04), transparent); border-bottom: 1px solid rgba(0,0,0,0.08); display: flex; align-items: baseline; gap: 16px; }
  header h1 { margin: 0; font-size: 14px; font-weight: 600; }
  header .meta { font-size: 12px; opacity: 0.7; }
  main { display: grid; grid-template-columns: minmax(280px, 360px) 1fr; gap: 0; height: calc(100vh - 49px); }
  .timeline { overflow-y: auto; border-right: 1px solid rgba(0,0,0,0.08); }
  .ev { padding: 6px 10px; border-bottom: 1px solid rgba(0,0,0,0.06); cursor: pointer; font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 11px; line-height: 1.4; }
  .ev:hover { background: rgba(0,0,0,0.03); }
  .ev.selected { background: rgba(0, 122, 178, 0.12); border-left: 3px solid #0072B2; padding-left: 7px; }
  .ev .ts { color: #6a737d; margin-right: 8px; }
  .ev .kind { display: inline-block; min-width: 70px; font-weight: 500; }
  .ev.kind-screenshot .kind { color: #2da44e; }
  .ev.kind-action .kind { color: #0072B2; }
  .ev.kind-appium-call .kind { color: #6a737d; }
  .ev.kind-page-source .kind { color: #d29922; }
  .ev.kind-session-start .kind, .ev.kind-session-end .kind { color: #cf222e; font-weight: 600; }
  .ev .err { color: #cf222e; }
  .detail { overflow-y: auto; padding: 16px; }
  .detail h2 { margin: 0 0 8px 0; font-size: 14px; }
  .panel { padding: 12px; margin-bottom: 12px; background: #fff; border: 1px solid rgba(0,0,0,0.08); border-radius: 6px; }
  .screen img { display: block; max-width: 100%; max-height: 70vh; margin: 8px auto; box-shadow: 0 1px 3px rgba(0,0,0,0.15); border-radius: 4px; }
  pre { background: rgba(0,0,0,0.04); padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 11px; line-height: 1.4; max-height: 50vh; }
  @media (prefers-color-scheme: dark) { pre { background: #0d1117; } header { border-color: #2d333b; } .timeline { border-color: #2d333b; } .ev { border-color: #1f242c; } header { background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent); } }
</style>
</head>
<body>
<header>
  <h1>Mobile Trace</h1>
  <span class="meta" id="meta"></span>
</header>
<main>
  <div class="timeline" id="timeline"></div>
  <div class="detail" id="detail"></div>
</main>
<script>
const TRACE = ${traceJson};
const timeline = document.getElementById('timeline');
const detail = document.getElementById('detail');
const meta = document.getElementById('meta');
meta.textContent = TRACE.events.length + ' events · ' + (TRACE.durationMs/1000).toFixed(1) + 's · generated ' + TRACE.generatedAt;

function fmtTs(ms) {
  if (ms < 1000) return ms + 'ms';
  return (ms / 1000).toFixed(2) + 's';
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function summaryFor(e) {
  switch (e.kind) {
    case 'session-start': return 'session ' + (e.data.sessionId || '').slice(0, 8);
    case 'session-end': return 'status: ' + (e.data.status || 'n/a');
    case 'action': return e.data.name + (e.data.args !== undefined ? ' ' + JSON.stringify(e.data.args).slice(0, 60) : '');
    case 'screenshot': return Math.round((e.data.bytes || 0) / 1024) + ' KB';
    case 'page-source': return e.data.label || 'snapshot';
    case 'appium-call': return e.data.method + ' ' + e.data.path + (e.data.status === 'err' ? ' [ERR]' : '');
  }
  return '';
}
function renderDetail(e) {
  let html = '<h2>' + escapeHtml(e.kind) + ' @ ' + fmtTs(e.ts) + '</h2>';
  if (e.kind === 'screenshot') {
    html += '<div class="panel screen"><img src="data:image/png;base64,' + e.data.pngBase64 + '"></div>';
  } else if (e.kind === 'page-source') {
    html += '<div class="panel"><pre>' + escapeHtml(e.data.xml) + '</pre></div>';
  } else if (e.kind === 'appium-call') {
    html += '<div class="panel">';
    html += '<div><strong>' + escapeHtml(e.data.method) + '</strong> <code>' + escapeHtml(e.data.path) + '</code></div>';
    html += '<div>status: <strong class="' + (e.data.status === 'err' ? 'err' : '') + '">' + e.data.status + '</strong></div>';
    if (e.data.err) html += '<pre>' + escapeHtml(e.data.err) + '</pre>';
    html += '</div>';
  } else {
    html += '<div class="panel"><pre>' + escapeHtml(JSON.stringify(e.data, null, 2)) + '</pre></div>';
  }
  detail.innerHTML = html;
}
TRACE.events.forEach((e, i) => {
  const row = document.createElement('div');
  row.className = 'ev kind-' + e.kind;
  row.innerHTML = '<span class="ts">' + fmtTs(e.ts) + '</span><span class="kind">' + e.kind + '</span><span>' + escapeHtml(summaryFor(e)) + '</span>';
  row.onclick = () => {
    document.querySelectorAll('.ev.selected').forEach(x => x.classList.remove('selected'));
    row.classList.add('selected');
    renderDetail(e);
  };
  timeline.appendChild(row);
});
// Auto-select the first screenshot or the first session event
const first = TRACE.events.findIndex(e => e.kind === 'screenshot');
const sel = first >= 0 ? first : 0;
if (TRACE.events.length) {
  const row = timeline.children[sel];
  row.classList.add('selected');
  renderDetail(TRACE.events[sel]);
}
</script>
</body>
</html>`;
}
