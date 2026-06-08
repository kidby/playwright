/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { SdkObject } from './instrumentation';
import { AppiumClient } from './ios/appiumClient';
import type { Progress } from './progress';
import { AppLocator } from './appLocator';
import { MobileNetworkProxy } from './mobileNetworkProxy';
import { URL } from 'url';

export class Appium extends SdkObject {
  constructor(parent: SdkObject) {
    super(parent, 'appium');
  }

  async connect(progress: Progress, params: any): Promise<AppiumDevice> {
    const serverUrl = params.serverUrl || process.env.PLAYWRIGHT_APPIUM_URL;
    if (!serverUrl)
      throw new Error('serverUrl is required to connect to Appium. Pass it explicitly or use autoStart in config.');

    const proxy = new MobileNetworkProxy();
    const port = await progress.race(proxy.start());

    params.capabilities = params.capabilities || {};
    params.capabilities['alwaysMatch'] = params.capabilities['alwaysMatch'] || {};
    params.capabilities['alwaysMatch']['appium:proxy'] = { proxyType: 'manual', httpProxy: `127.0.0.1:${port}` };

    const client = new AppiumClient(serverUrl);
    // Best effort try to connect, if it's already a session we don't need to create one,
    // but the protocol connect takes capabilities. Let's just create one.
    if (params.capabilities)
      await progress.race(client.createSession(params.capabilities));
    
    const device = new AppiumDevice(this, client);
    device.proxy = proxy;

    // Perf 2.10: if MJPEG streaming port is configured, start consuming
    // frames in the background for near-instant screenshots.
    const mjpegPort = params.capabilities?.alwaysMatch?.['appium:mjpegServerPort']
      ?? params.capabilities?.['appium:mjpegServerPort'];
    if (mjpegPort) {
      const serverHost = new URL(serverUrl).hostname;
      device.startMjpegStream(`http://${serverHost}:${mjpegPort}`);
    }

    return device;
  }
}

export class AppiumDevice extends SdkObject {
  private _logPollingInterval: NodeJS.Timeout | undefined;
  public proxy: MobileNetworkProxy | undefined;

  // Perf 2.10 — MJPEG streaming: when `appium:mjpegServerPort` is set in
  // capabilities, we connect to the MJPEG stream and cache the latest frame.
  // `screenshot()` returns the cached frame instantly, avoiding the slow
  // `GET /screenshot` HTTP round-trip.
  private _mjpegFrame: Buffer | null = null;
  private _mjpegAbort: AbortController | null = null;

  constructor(parent: SdkObject, public readonly client: AppiumClient) {
    super(parent, 'appiumDevice');
    this._startLogPolling();
  }

  private _startLogPolling() {
    const isAndroid = this.client.platform === 'Android';
    const logType = isAndroid ? 'logcat' : 'syslog';
    const appIdentifier = (isAndroid ? this.client.capabilities?.['appium:appPackage'] : this.client.capabilities?.['appium:bundleId']) || '';

    this._logPollingInterval = setInterval(async () => {
      if (!this.client.sessionId) return;
      const logs = await this.client.getLogs(logType);
      for (const log of logs) {
        // Basic filtering to reduce noise
        if (appIdentifier && !log.message.includes(appIdentifier as string)) continue;

        let type = 'log';
        const lowerMsg = (log.level + ' ' + log.message).toLowerCase();
        if (lowerMsg.includes('error') || lowerMsg.match(/\be\//)) type = 'error';
        else if (lowerMsg.includes('warn') || lowerMsg.match(/\bw\//)) type = 'warning';
        else if (lowerMsg.includes('info') || lowerMsg.match(/\bi\//)) type = 'info';
        else if (lowerMsg.includes('debug') || lowerMsg.match(/\bd\//)) type = 'debug';

        this.emit('console', {
          type,
          text: log.message,
          location: { url: '', lineNumber: 0, columnNumber: 0 },
          args: [],
          timestamp: log.timestamp || Date.now(),
        });
      }
    }, 1000);
    this._logPollingInterval.unref?.();
  }

  async appLocator(chain: any[], options?: any): Promise<AppLocator> {
    return new AppLocator(this, chain, options);
  }

  /** Start consuming the MJPEG stream from the given URL (fire-and-forget). */
  startMjpegStream(mjpegUrl: string): void {
    this._mjpegAbort = new AbortController();
    this._consumeMjpegStream(mjpegUrl).catch(() => {});
  }

  private async _consumeMjpegStream(url: string): Promise<void> {
    const signal = this._mjpegAbort?.signal;
    while (!signal?.aborted) {
      try {
        const response = await fetch(url, { signal: signal as AbortSignal });
        if (!response.ok || !response.body)
          break;
        // MJPEG streams use multipart/x-mixed-replace with JPEG frames
        // separated by boundary markers. We parse the raw byte stream to
        // extract individual JPEG frames (SOI 0xFFD8 … EOI 0xFFD9).
        const reader = (response.body as any).getReader();
        let buffer = Buffer.alloc(0);
        const JPEG_START = Buffer.from([0xFF, 0xD8]);
        const JPEG_END = Buffer.from([0xFF, 0xD9]);
        while (!signal?.aborted) {
          const { done, value }: { done: boolean; value?: Uint8Array } = await reader.read();
          if (done) break;
          buffer = Buffer.concat([buffer, Buffer.from(value!)]);
          // Extract complete JPEG frames from the buffer.
          while (true) {
            const startIdx = buffer.indexOf(JPEG_START);
            if (startIdx === -1) break;
            const endIdx = buffer.indexOf(JPEG_END, startIdx + 2);
            if (endIdx === -1) break;
            // Extract frame (inclusive of JPEG_END marker).
            this._mjpegFrame = buffer.subarray(startIdx, endIdx + 2);
            buffer = buffer.subarray(endIdx + 2);
          }
          // Prevent unbounded buffer growth.
          if (buffer.length > 10 * 1024 * 1024)
            buffer = buffer.subarray(buffer.length - 1024 * 1024);
        }
      } catch (e: any) {
        if (signal?.aborted) return;
        // Reconnect after a brief delay on transient errors.
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  async screenshot(progress: Progress, params: any): Promise<Buffer> {
    // Perf 2.10: if MJPEG streaming is active and we have a cached frame,
    // return it instantly without an HTTP round-trip to Appium.
    if (this._mjpegFrame)
      return this._mjpegFrame;
    // Fallback: standard Appium screenshot endpoint.
    return this.client.screenshot();
  }

  async request(progress: Progress, params: { method: string, path: string, body?: any }): Promise<{ result?: any }> {
    const result = await progress.race(this.client.request(params.method, params.path, params.body));
    return { result };
  }

  async close(progress: Progress): Promise<void> {
    // Stop MJPEG stream consumer.
    if (this._mjpegAbort) {
      this._mjpegAbort.abort();
      this._mjpegAbort = null;
    }
    if (this._logPollingInterval) clearInterval(this._logPollingInterval);
    if (this.proxy) await progress.race(this.proxy.stop());
    await progress.race(this.client.deleteSession());
  }
}
