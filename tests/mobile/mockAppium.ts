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

// Tiny HTTP server that pretends to be an Appium 2.x endpoint. Used by the
// @playwright/mobile unit tests so we can exercise the W3C client end-to-end
// without an Android emulator or iOS simulator. Records every received
// request so tests can assert on the wire shape directly.

import http from 'http';
import type { AddressInfo } from 'net';

const W3C_ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

export type RecordedRequest = {
  method: string;
  path: string;
  body: any;
};

export type MockResponder = (req: RecordedRequest) => { status?: number; body?: any } | undefined;

export type MockAppium = {
  url: string;
  requests: RecordedRequest[];
  // Set a per-test custom responder. Return undefined to fall through to
  // the default behaviour (echoes a no-op { value: null } for unknown paths).
  setResponder(fn: MockResponder | undefined): void;
  // Inject a canned element id that findElement returns next.
  setNextElementId(id: string): void;
  close(): Promise<void>;
};

export async function startMockAppium(): Promise<MockAppium> {
  const requests: RecordedRequest[] = [];
  let responder: MockResponder | undefined;
  let nextElementId: string | undefined;
  let elementCounter = 0;

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req)
      chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf-8');
    let body: any = undefined;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    }
    const recorded: RecordedRequest = { method: req.method || 'GET', path: req.url || '/', body };
    requests.push(recorded);

    const custom = responder?.(recorded);
    if (custom) {
      res.statusCode = custom.status ?? 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(custom.body ?? {}));
      return;
    }

    // Default handlers — enough to mirror happy-path Appium for the W3C
    // endpoints AppiumClient actually calls.
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');

    if (req.method === 'POST' && req.url === '/session') {
      res.end(JSON.stringify({ value: { sessionId: 'mock-session-1', capabilities: body.capabilities?.alwaysMatch } }));
      return;
    }
    if (req.method === 'DELETE' && /^\/session\/[^/]+$/.test(req.url!)) {
      res.end(JSON.stringify({ value: null }));
      return;
    }
    if (req.method === 'POST' && /\/element$/.test(req.url!)) {
      const id = nextElementId ?? `el-${++elementCounter}`;
      nextElementId = undefined;
      res.end(JSON.stringify({ value: { [W3C_ELEMENT_KEY]: id } }));
      return;
    }
    if (req.method === 'POST' && /\/elements$/.test(req.url!)) {
      res.end(JSON.stringify({
        value: [
          { [W3C_ELEMENT_KEY]: `el-${++elementCounter}` },
          { [W3C_ELEMENT_KEY]: `el-${++elementCounter}` },
        ],
      }));
      return;
    }
    if (req.method === 'GET' && /\/text$/.test(req.url!)) {
      res.end(JSON.stringify({ value: 'sample text' }));
      return;
    }
    if (req.method === 'GET' && /\/attribute\//.test(req.url!)) {
      res.end(JSON.stringify({ value: 'attr-value' }));
      return;
    }
    if (req.method === 'GET' && /\/displayed$/.test(req.url!)) {
      res.end(JSON.stringify({ value: true }));
      return;
    }
    if (req.method === 'GET' && /\/window\/rect$/.test(req.url!)) {
      res.end(JSON.stringify({ value: { width: 390, height: 844, x: 0, y: 0 } }));
      return;
    }
    if (req.method === 'GET' && /\/screenshot$/.test(req.url!)) {
      res.end(JSON.stringify({ value: Buffer.from('PNG-bytes').toString('base64') }));
      return;
    }
    if (req.method === 'GET' && /\/contexts$/.test(req.url!)) {
      res.end(JSON.stringify({ value: ['NATIVE_APP', 'WEBVIEW_chrome'] }));
      return;
    }
    if (req.method === 'GET' && /\/context$/.test(req.url!)) {
      res.end(JSON.stringify({ value: 'NATIVE_APP' }));
      return;
    }
    if (req.method === 'POST' && /\/execute\/sync$/.test(req.url!)) {
      res.end(JSON.stringify({ value: null }));
      return;
    }

    res.end(JSON.stringify({ value: null }));
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  return {
    url,
    requests,
    setResponder(fn) { responder = fn; },
    setNextElementId(id) { nextElementId = id; },
    close: () =>
      new Promise<void>(resolve => server.close(() => resolve())),
  };
}
