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

// Tests for MobileNetworkProxy — this can be fully tested locally by
// booting the proxy and sending HTTP requests through it to a local
// target server.

import { test, expect } from '@playwright/test';
import * as http from 'http';
import type { AddressInfo } from 'net';

// Inline a minimal version of the proxy for testing since the import
// path goes through playwright-core's internal structure.
import { MobileNetworkProxy } from '../../packages/playwright-core/src/server/mobileNetworkProxy';

let proxy: MobileNetworkProxy;
let proxyPort: number;
let targetServer: http.Server;
let targetPort: number;
let targetRequests: { method: string; url: string; body: string }[];

test.beforeEach(async () => {
  targetRequests = [];

  // Boot a simple target HTTP server that echoes requests back.
  targetServer = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf-8');
    targetRequests.push({ method: req.method || 'GET', url: req.url || '/', body });

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ echo: true, method: req.method, path: req.url, body }));
  });
  await new Promise<void>(resolve => targetServer.listen(0, '127.0.0.1', resolve));
  targetPort = (targetServer.address() as AddressInfo).port;

  // Boot the proxy.
  proxy = new MobileNetworkProxy();
  proxyPort = await proxy.start();
});

test.afterEach(async () => {
  await proxy.stop();
  await new Promise<void>(resolve => targetServer.close(() => resolve()));
});

function proxyFetch(path: string, options: { method?: string; body?: string } = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: `http://127.0.0.1:${targetPort}${path}`,
      method: options.method || 'GET',
      headers: {
        host: `127.0.0.1:${targetPort}`,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 200, body }));
    });
    req.on('error', reject);
    if (options.body)
      req.write(options.body);
    req.end();
  });
}

test('proxy forwards GET requests to target server', async () => {
  const result = await proxyFetch('/api/health');
  expect(result.status).toBe(200);
  const json = JSON.parse(result.body);
  expect(json.echo).toBe(true);
  expect(json.method).toBe('GET');
  expect(json.path).toContain('/api/health');
  expect(targetRequests.length).toBe(1);
});

test('proxy forwards POST requests with body', async () => {
  const payload = JSON.stringify({ user: 'test', action: 'login' });
  const result = await proxyFetch('/api/login', { method: 'POST', body: payload });
  expect(result.status).toBe(200);
  const json = JSON.parse(result.body);
  expect(json.method).toBe('POST');
  expect(json.body).toBe(payload);
});

test('proxy emits requestWillBeSent events', async () => {
  const events: any[] = [];
  proxy.on('requestWillBeSent', (e: any) => events.push(e));

  await proxyFetch('/api/data');

  expect(events.length).toBe(1);
  expect(events[0].requestId).toBeTruthy();
  expect(events[0].request.method).toBe('GET');
  expect(events[0].request.url).toContain('/api/data');
  expect(events[0].timestamp).toBeGreaterThan(0);
  expect(events[0].wallTime).toBeGreaterThan(0);
});

test('proxy emits responseReceived events', async () => {
  const events: any[] = [];
  proxy.on('responseReceived', (e: any) => events.push(e));

  await proxyFetch('/api/status');

  expect(events.length).toBe(1);
  expect(events[0].response.status).toBe(200);
  expect(events[0].response.url).toContain('/api/status');
  expect(events[0].response.mimeType).toContain('application/json');
});

test('proxy emits loadingFinished events', async () => {
  const events: any[] = [];
  proxy.on('loadingFinished', (e: any) => events.push(e));

  await proxyFetch('/api/done');

  // loadingFinished fires after the response body is fully received.
  await new Promise(r => setTimeout(r, 100)); // small delay for pipe to finish
  expect(events.length).toBe(1);
  expect(events[0].requestId).toBeTruthy();
  expect(events[0].timestamp).toBeGreaterThan(0);
});

test('proxy correlates request/response/finish by requestId', async () => {
  const sent: any[] = [];
  const received: any[] = [];
  const finished: any[] = [];
  proxy.on('requestWillBeSent', (e: any) => sent.push(e));
  proxy.on('responseReceived', (e: any) => received.push(e));
  proxy.on('loadingFinished', (e: any) => finished.push(e));

  await proxyFetch('/api/correlated');
  await new Promise(r => setTimeout(r, 100));

  expect(sent.length).toBe(1);
  expect(received.length).toBe(1);
  expect(finished.length).toBe(1);

  // All three events share the same requestId
  expect(sent[0].requestId).toBe(received[0].requestId);
  expect(sent[0].requestId).toBe(finished[0].requestId);
});

test('proxy handles multiple concurrent requests', async () => {
  const events: any[] = [];
  proxy.on('requestWillBeSent', (e: any) => events.push(e));

  await Promise.all([
    proxyFetch('/api/a'),
    proxyFetch('/api/b'),
    proxyFetch('/api/c'),
  ]);

  expect(events.length).toBe(3);
  const urls = events.map((e: any) => e.request.url);
  expect(urls.some((u: string) => u.includes('/api/a'))).toBe(true);
  expect(urls.some((u: string) => u.includes('/api/b'))).toBe(true);
  expect(urls.some((u: string) => u.includes('/api/c'))).toBe(true);
});

test('proxy returns 500 for unreachable targets', async () => {
  // Point at a port that's not listening.
  const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: proxyPort,
      path: `http://127.0.0.1:1/unreachable`,
      method: 'GET',
      headers: { host: '127.0.0.1:1' },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode || 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
  expect(result.status).toBe(500);
});
