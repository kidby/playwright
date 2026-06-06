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

import { test, expect } from '@playwright/test';
import http from 'http';
import net from 'net';
import { MobileNetworkProxy } from '../../packages/playwright-core/src/server/mobileNetworkProxy';

test.describe('MobileNetworkProxy Concurrency and Stress Tests', () => {
  let proxy: MobileNetworkProxy;
  let proxyPort: number;

  test.beforeEach(async () => {
    proxy = new MobileNetworkProxy();
    proxyPort = await proxy.start();
  });

  test.afterEach(async () => {
    await proxy.stop();
  });

  test('High Concurrency HTTP Forwarding (150+ requests) without cross-talk or timing anomalies', async () => {
    const CONCURRENT_COUNT = 150;
    
    // Track active connection counts on target server
    let targetActiveConnections = 0;
    let maxTargetActiveConnections = 0;

    const targetServer = http.createServer((req, res) => {
      targetActiveConnections++;
      maxTargetActiveConnections = Math.max(maxTargetActiveConnections, targetActiveConnections);

      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        // Small random delay to increase likelihood of race conditions/interleaving
        const delay = Math.random() * 30;
        setTimeout(() => {
          res.writeHead(200, {
            'Content-Type': 'text/plain',
            'x-request-echo-id': req.headers['x-request-id'] || ''
          });
          res.end(`echo: ${body}`);
          targetActiveConnections--;
        }, delay);
      });
    });

    await new Promise<void>(resolve => targetServer.listen(0, '127.0.0.1', resolve));
    const targetPort = (targetServer.address() as net.AddressInfo).port;

    const requestWillBeSentEvents = new Map<string, any>();
    const responseReceivedEvents = new Map<string, any>();
    const loadingFinishedEvents = new Map<string, any>();

    proxy.on('requestWillBeSent', data => {
      if (requestWillBeSentEvents.has(data.requestId)) {
        throw new Error(`Duplicate requestId in requestWillBeSent: ${data.requestId}`);
      }
      requestWillBeSentEvents.set(data.requestId, data);
    });
    proxy.on('responseReceived', data => {
      if (responseReceivedEvents.has(data.requestId)) {
        throw new Error(`Duplicate requestId in responseReceived: ${data.requestId}`);
      }
      responseReceivedEvents.set(data.requestId, data);
    });
    proxy.on('loadingFinished', data => {
      if (loadingFinishedEvents.has(data.requestId)) {
        throw new Error(`Duplicate requestId in loadingFinished: ${data.requestId}`);
      }
      loadingFinishedEvents.set(data.requestId, data);
    });

    try {
      const promises = Array.from({ length: CONCURRENT_COUNT }).map((_, index) => {
        return new Promise<void>((resolve, reject) => {
          const reqBody = JSON.stringify({ index, salt: Math.random() });
          const requestIdStr = `req-id-${index}-${Math.random()}`;

          const clientReq = http.request({
            host: '127.0.0.1',
            port: proxyPort,
            path: `http://127.0.0.1:${targetPort}/stress?id=${index}`,
            method: 'POST',
            headers: {
              'Host': `127.0.0.1:${targetPort}`,
              'Content-Type': 'application/json',
              'x-request-id': requestIdStr
            }
          }, res => {
            let resBody = '';
            res.on('data', chunk => resBody += chunk.toString());
            res.on('end', () => {
              try {
                expect(res.statusCode).toBe(200);
                expect(resBody).toBe(`echo: ${reqBody}`);
                expect(res.headers['x-request-echo-id']).toBe(requestIdStr);
                resolve();
              } catch (e) {
                reject(e);
              }
            });
          });

          clientReq.on('error', reject);
          clientReq.write(reqBody);
          clientReq.end();
        });
      });

      await Promise.all(promises);

      // Verify overall event counts
      expect(requestWillBeSentEvents.size).toBe(CONCURRENT_COUNT);
      expect(responseReceivedEvents.size).toBe(CONCURRENT_COUNT);
      expect(loadingFinishedEvents.size).toBe(CONCURRENT_COUNT);

      // Map proxy request ID to our client request details to check for cross-talk
      const requestMapByUrl = new Map<string, any>();
      for (const [reqId, data] of requestWillBeSentEvents.entries()) {
        const url = data.request.url;
        requestMapByUrl.set(url, { reqId, data });
      }

      // Check all events match up properly and no data has crossed
      for (let index = 0; index < CONCURRENT_COUNT; index++) {
        const expectedUrl = `http://127.0.0.1:${targetPort}/stress?id=${index}`;
        const mapping = requestMapByUrl.get(expectedUrl);
        expect(mapping).toBeDefined();

        const { reqId, data: reqEvent } = mapping;
        const resEvent = responseReceivedEvents.get(reqId);
        const finEvent = loadingFinishedEvents.get(reqId);

        expect(resEvent).toBeDefined();
        expect(finEvent).toBeDefined();

        // Check request event properties
        expect(reqEvent.request.method).toBe('POST');
        expect(reqEvent.request.headers['x-request-id']).toContain(`req-id-${index}-`);
        const parsedBody = JSON.parse(reqEvent.request.postData);
        expect(parsedBody.index).toBe(index);

        // Check response event properties
        expect(resEvent.response.url).toBe(expectedUrl);
        expect(resEvent.response.status).toBe(200);
        expect(resEvent.response.headers['x-request-echo-id']).toBe(reqEvent.request.headers['x-request-id']);

        // Check event timings are correct and sequential
        expect(resEvent.timestamp).toBeGreaterThanOrEqual(reqEvent.timestamp);
        expect(finEvent.timestamp).toBeGreaterThanOrEqual(resEvent.timestamp);
      }

      // Assert concurrency was actually reached
      expect(maxTargetActiveConnections).toBeGreaterThan(10);
    } finally {
      await new Promise<void>(resolve => targetServer.close(() => resolve()));
    }
  });

  test('High Concurrency HTTPS CONNECT Tunneling (100+ tunnels) socket leak & robustness verification', async () => {
    const CONCURRENT_COUNT = 120;

    let activeConnectionsCount = 0;
    let maxActiveConnections = 0;
    const activeSockets = new Set<net.Socket>();

    const tcpTargetServer = net.createServer(socket => {
      activeConnectionsCount++;
      maxActiveConnections = Math.max(maxActiveConnections, activeConnectionsCount);
      activeSockets.add(socket);

      socket.on('data', data => {
        // Small delay to simulate network latency
        setTimeout(() => {
          if (!socket.destroyed) {
            socket.write(Buffer.concat([Buffer.from('ECHO-CONNECT: '), data]));
          }
        }, Math.random() * 20);
      });

      socket.on('close', () => {
        activeConnectionsCount--;
        activeSockets.delete(socket);
      });
      socket.on('error', () => {
        // ignore errors on mock server sockets during teardown
      });
    });

    await new Promise<void>(resolve => tcpTargetServer.listen(0, '127.0.0.1', resolve));
    const tcpTargetPort = (tcpTargetServer.address() as net.AddressInfo).port;

    try {
      const promises = Array.from({ length: CONCURRENT_COUNT }).map((_, index) => {
        return new Promise<void>((resolve, reject) => {
          setTimeout(async () => {
            let clientSocket: net.Socket | null = null;
            try {
              clientSocket = net.connect(proxyPort, '127.0.0.1');

              const handshakePromise = new Promise<string>((resolveHS, rejectHS) => {
                let responseStr = '';
                clientSocket!.on('data', data => {
                  responseStr += data.toString();
                  if (responseStr.includes('\r\n\r\n')) {
                    clientSocket!.removeAllListeners('data');
                    resolveHS(responseStr);
                  }
                });
                clientSocket!.on('error', rejectHS);
              });

              clientSocket.write(
                `CONNECT 127.0.0.1:${tcpTargetPort} HTTP/1.1\r\n` +
                `Host: 127.0.0.1:${tcpTargetPort}\r\n` +
                `\r\n`
              );

              const handshakeResponse = await handshakePromise;
              expect(handshakeResponse).toContain('HTTP/1.1 200 Connection Established');

              const replyPromise = new Promise<string>((resolveData, rejectData) => {
                clientSocket!.on('data', data => {
                  resolveData(data.toString());
                });
                clientSocket!.on('error', rejectData);
              });

              const payload = `stress-payload-${index}-${Math.random()}`;
              clientSocket.write(payload);

              const reply = await replyPromise;
              expect(reply).toBe(`ECHO-CONNECT: ${payload}`);

              clientSocket.end();
              resolve();
            } catch (e) {
              if (clientSocket) {
                clientSocket.destroy();
              }
              reject(e);
            }
          }, Math.random() * 50);
        });
      });

      await Promise.all(promises);

      // Verify that all active connections on target server are closed
      // Give a tiny buffer for socket event loop cleanup
      for (let i = 0; i < 50; i++) {
        if (activeConnectionsCount === 0) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      expect(activeConnectionsCount).toBe(0);
      expect(activeSockets.size).toBe(0);
      expect(maxActiveConnections).toBeGreaterThan(10);
    } finally {
      await new Promise<void>(resolve => tcpTargetServer.close(() => resolve()));
    }
  });

  test('Graceful teardown - no hanging sockets after proxy stop', async () => {
    // Get list of active handles before we run anything
    const getActiveSocketsCount = () => {
      const handles = (process as any)._getActiveHandles ? (process as any)._getActiveHandles() : [];
      return handles.filter((h: any) => h instanceof net.Socket && !h.destroyed).length;
    };

    const initialSockets = getActiveSocketsCount();

    // Start a target server and send requests
    const targetServer = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('done');
    });
    await new Promise<void>(resolve => targetServer.listen(0, '127.0.0.1', resolve));
    const targetPort = (targetServer.address() as net.AddressInfo).port;

    try {
      const clientReq = http.request({
        host: '127.0.0.1',
        port: proxyPort,
        path: `http://127.0.0.1:${targetPort}/`,
        method: 'GET',
        headers: {
          'Host': `127.0.0.1:${targetPort}`
        }
      }, res => {
        res.on('data', () => {});
        res.on('end', () => {});
      });
      await new Promise<void>((resolve, reject) => {
        clientReq.on('response', () => resolve());
        clientReq.on('error', reject);
        clientReq.end();
      });

      // Stop the proxy
      await proxy.stop();

      // Give event loop some time to clean up
      await new Promise(resolve => setTimeout(resolve, 100));

      const finalSockets = getActiveSocketsCount();
      
      // Sockets count should be back to or very close to initial (excluding test runner connections)
      // Since keep-alive agent is destroyed during stop(), free sockets are closed.
      expect(finalSockets - initialSockets).toBeLessThanOrEqual(2); // allowing tiny margin for test runner IPC
    } finally {
      await new Promise<void>(resolve => targetServer.close(() => resolve()));
    }
  });
});
