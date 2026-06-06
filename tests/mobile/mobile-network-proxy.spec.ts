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

test.describe('MobileNetworkProxy Integration and Load Tests', () => {
  let proxy: MobileNetworkProxy;
  let proxyPort: number;

  test.beforeEach(async () => {
    // Start proxy
    proxy = new MobileNetworkProxy();
    proxyPort = await proxy.start();
  });

  test.afterEach(async () => {
    await proxy.stop();
  });

  test('HTTP forwarding and event emission', async () => {
    // 1. Start a mock HTTP target server
    const targetRequests: { method: string; url: string; body: string }[] = [];
    const targetServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        targetRequests.push({ method: req.method || 'GET', url: req.url || '/', body });
        res.writeHead(200, { 'Content-Type': 'text/plain', 'x-custom-res-header': 'hello' });
        res.end('echo: ' + body);
      });
    });

    await new Promise<void>(resolve => targetServer.listen(0, '127.0.0.1', resolve));
    const targetPort = (targetServer.address() as net.AddressInfo).port;

    // 2. Setup proxy events listening
    const events: { event: string; data: any }[] = [];
    proxy.on('requestWillBeSent', data => events.push({ event: 'requestWillBeSent', data }));
    proxy.on('responseReceived', data => events.push({ event: 'responseReceived', data }));
    proxy.on('loadingFinished', data => events.push({ event: 'loadingFinished', data }));

    try {
      // 3. Make client request through the proxy
      const responsePromise = new Promise<{ status: number; headers: any; body: string }>((resolve, reject) => {
        const clientReq = http.request({
          host: '127.0.0.1',
          port: proxyPort,
          path: `http://127.0.0.1:${targetPort}/some/path?query=1`,
          method: 'POST',
          headers: {
            'Host': `127.0.0.1:${targetPort}`,
            'Content-Type': 'application/json'
          }
        }, res => {
          let body = '';
          res.on('data', chunk => body += chunk.toString());
          res.on('end', () => {
            resolve({
              status: res.statusCode || 0,
              headers: res.headers,
              body
            });
          });
        });

        clientReq.on('error', reject);
        clientReq.write(JSON.stringify({ ping: 'pong' }));
        clientReq.end();
      });

      const response = await responsePromise;

      // 4. Verify client response
      expect(response.status).toBe(200);
      expect(response.headers['x-custom-res-header']).toBe('hello');
      expect(response.body).toBe('echo: {"ping":"pong"}');

      // 5. Verify target server request received
      expect(targetRequests.length).toBe(1);
      expect(targetRequests[0]).toEqual({
        method: 'POST',
        url: `http://127.0.0.1:${targetPort}/some/path?query=1`,
        body: '{"ping":"pong"}'
      });

      // 6. Verify event sequence and payloads
      expect(events.length).toBe(3);

      const requestWillBeSent = events.find(e => e.event === 'requestWillBeSent')?.data;
      const responseReceived = events.find(e => e.event === 'responseReceived')?.data;
      const loadingFinished = events.find(e => e.event === 'loadingFinished')?.data;

      expect(requestWillBeSent).toBeDefined();
      expect(responseReceived).toBeDefined();
      expect(loadingFinished).toBeDefined();

      // IDs should match
      const reqId = requestWillBeSent.requestId;
      expect(responseReceived.requestId).toBe(reqId);
      expect(loadingFinished.requestId).toBe(reqId);

      // Timestamps should be logical
      expect(responseReceived.timestamp).toBeGreaterThanOrEqual(requestWillBeSent.timestamp);
      expect(loadingFinished.timestamp).toBeGreaterThanOrEqual(responseReceived.timestamp);

      expect(requestWillBeSent.request.url).toBe(`http://127.0.0.1:${targetPort}/some/path?query=1`);
      expect(requestWillBeSent.request.method).toBe('POST');
      expect(requestWillBeSent.request.postData).toBe('{"ping":"pong"}');
      expect(responseReceived.response.status).toBe(200);
      expect(responseReceived.response.headers['x-custom-res-header']).toBe('hello');
      expect(responseReceived.response.mimeType).toBe('text/plain');
    } finally {
      await new Promise<void>(resolve => targetServer.close(() => resolve()));
    }
  });

  test('HTTPS connection tunneling (CONNECT method)', async () => {
    // 1. Start a mock TCP target server (acting as the HTTPS server)
    const targetPayloads: Buffer[] = [];
    const tcpTargetServer = net.createServer(socket => {
      socket.on('data', data => {
        targetPayloads.push(data);
        socket.write(Buffer.concat([Buffer.from('ECHO: '), data]));
      });
    });

    await new Promise<void>(resolve => tcpTargetServer.listen(0, '127.0.0.1', resolve));
    const tcpTargetPort = (tcpTargetServer.address() as net.AddressInfo).port;

    try {
      // 2. Establish connection to proxy and perform CONNECT handshake
      const clientSocket = net.connect(proxyPort, '127.0.0.1');

      const handshakePromise = new Promise<string>((resolve, reject) => {
        let responseStr = '';
        clientSocket.on('data', data => {
          responseStr += data.toString();
          if (responseStr.includes('\r\n\r\n')) {
            clientSocket.removeAllListeners('data');
            resolve(responseStr);
          }
        });
        clientSocket.on('error', reject);
      });

      // Send CONNECT request
      clientSocket.write(
        `CONNECT 127.0.0.1:${tcpTargetPort} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${tcpTargetPort}\r\n` +
        `Proxy-Connection: Keep-Alive\r\n` +
        `\r\n`
      );

      const handshakeResponse = await handshakePromise;
      expect(handshakeResponse).toContain('HTTP/1.1 200 Connection Established');
      expect(handshakeResponse).toContain('Proxy-agent: Node.js-Proxy');

      // 3. Send data over tunnel
      const replyPromise = new Promise<string>((resolve, reject) => {
        clientSocket.on('data', data => {
          resolve(data.toString());
        });
        clientSocket.on('error', reject);
      });

      clientSocket.write('hello tunnel data');

      const reply = await replyPromise;
      expect(reply).toBe('ECHO: hello tunnel data');
      expect(targetPayloads[0].toString()).toBe('hello tunnel data');

      clientSocket.end();
    } finally {
      await new Promise<void>(resolve => tcpTargetServer.close(() => resolve()));
    }
  });

  test('Concurrent handling of multiple proxy connections/requests under load', async () => {
    const CONCURRENT_COUNT = 50;

    // 1. Start mock HTTP target server
    const targetServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('echo: ' + body);
      });
    });

    await new Promise<void>(resolve => targetServer.listen(0, '127.0.0.1', resolve));
    const targetPort = (targetServer.address() as net.AddressInfo).port;

    // Keep track of all emitted proxy events to ensure they match correctly without cross-talk
    const requestWillBeSentEvents = new Map<string, any>();
    const responseReceivedEvents = new Map<string, any>();
    const loadingFinishedEvents = new Map<string, any>();

    proxy.on('requestWillBeSent', data => requestWillBeSentEvents.set(data.requestId, data));
    proxy.on('responseReceived', data => responseReceivedEvents.set(data.requestId, data));
    proxy.on('loadingFinished', data => loadingFinishedEvents.set(data.requestId, data));

    try {
      const promises = Array.from({ length: CONCURRENT_COUNT }).map((_, index) => {
        return new Promise<void>((resolve, reject) => {
          // Add small random delay to simulate realistic load concurrency interleaving
          setTimeout(() => {
            const reqBody = JSON.stringify({ reqIndex: index });
            const clientReq = http.request({
              host: '127.0.0.1',
              port: proxyPort,
              path: `http://127.0.0.1:${targetPort}/concurrent?id=${index}`,
              method: 'POST',
              headers: {
                'Host': `127.0.0.1:${targetPort}`,
                'Content-Type': 'application/json'
              }
            }, res => {
              let resBody = '';
              res.on('data', chunk => resBody += chunk.toString());
              res.on('end', () => {
                try {
                  expect(res.statusCode).toBe(200);
                  expect(resBody).toBe('echo: ' + reqBody);
                  resolve();
                } catch (e) {
                  reject(e);
                }
              });
            });

            clientReq.on('error', reject);
            clientReq.write(reqBody);
            clientReq.end();
          }, Math.random() * 50);
        });
      });

      await Promise.all(promises);

      // Verify events logic under concurrency
      expect(requestWillBeSentEvents.size).toBe(CONCURRENT_COUNT);
      expect(responseReceivedEvents.size).toBe(CONCURRENT_COUNT);
      expect(loadingFinishedEvents.size).toBe(CONCURRENT_COUNT);

      // Verify that every request has a complete event cycle without mixing matching IDs
      for (const reqId of requestWillBeSentEvents.keys()) {
        const reqEvent = requestWillBeSentEvents.get(reqId);
        const resEvent = responseReceivedEvents.get(reqId);
        const finEvent = loadingFinishedEvents.get(reqId);

        expect(resEvent).toBeDefined();
        expect(finEvent).toBeDefined();

        expect(resEvent.timestamp).toBeGreaterThanOrEqual(reqEvent.timestamp);
        expect(finEvent.timestamp).toBeGreaterThanOrEqual(resEvent.timestamp);

        // Verify the payload of the request matches
        expect(reqEvent.request.url).toContain(`/concurrent?id=`);
      }
    } finally {
      await new Promise<void>(resolve => targetServer.close(() => resolve()));
    }
  });

  test('Concurrent HTTPS connection tunneling under load', async () => {
    const CONCURRENT_COUNT = 20;

    // Start a mock TCP target server
    const tcpTargetServer = net.createServer(socket => {
      socket.on('data', data => {
        socket.write(Buffer.concat([Buffer.from('ECHO: '), data]));
      });
    });

    await new Promise<void>(resolve => tcpTargetServer.listen(0, '127.0.0.1', resolve));
    const tcpTargetPort = (tcpTargetServer.address() as net.AddressInfo).port;

    try {
      const promises = Array.from({ length: CONCURRENT_COUNT }).map((_, index) => {
        return new Promise<void>((resolve, reject) => {
          setTimeout(async () => {
            try {
              const clientSocket = net.connect(proxyPort, '127.0.0.1');

              const handshakePromise = new Promise<string>((resolveHS, rejectHS) => {
                let responseStr = '';
                clientSocket.on('data', data => {
                  responseStr += data.toString();
                  if (responseStr.includes('\r\n\r\n')) {
                    clientSocket.removeAllListeners('data');
                    resolveHS(responseStr);
                  }
                });
                clientSocket.on('error', rejectHS);
              });

              clientSocket.write(
                `CONNECT 127.0.0.1:${tcpTargetPort} HTTP/1.1\r\n` +
                `Host: 127.0.0.1:${tcpTargetPort}\r\n` +
                `\r\n`
              );

              const handshakeResponse = await handshakePromise;
              expect(handshakeResponse).toContain('HTTP/1.1 200 Connection Established');

              const replyPromise = new Promise<string>((resolveData, rejectData) => {
                clientSocket.on('data', data => {
                  resolveData(data.toString());
                });
                clientSocket.on('error', rejectData);
              });

              const payload = `payload-${index}`;
              clientSocket.write(payload);

              const reply = await replyPromise;
              expect(reply).toBe(`ECHO: ${payload}`);

              clientSocket.end();
              resolve();
            } catch (e) {
              reject(e);
            }
          }, Math.random() * 50);
        });
      });

      await Promise.all(promises);
    } finally {
      await new Promise<void>(resolve => tcpTargetServer.close(() => resolve()));
    }
  });

  test('IPv6 Host forwarding', async () => {
    const targetRequests: { method: string; url: string; body: string }[] = [];
    const targetServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        targetRequests.push({ method: req.method || 'GET', url: req.url || '/', body });
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ipv6-echo: ' + body);
      });
    });

    await new Promise<void>(resolve => targetServer.listen(0, '::1', resolve));
    const targetPort = (targetServer.address() as net.AddressInfo).port;

    try {
      const responsePromise = new Promise<{ status: number; body: string }>((resolve, reject) => {
        const clientReq = http.request({
          host: '127.0.0.1',
          port: proxyPort,
          path: `http://[::1]:${targetPort}/ipv6-path`,
          method: 'POST',
          headers: {
            'Host': `[::1]:${targetPort}`,
            'Content-Type': 'application/json'
          }
        }, res => {
          let body = '';
          res.on('data', chunk => body += chunk.toString());
          res.on('end', () => {
            resolve({
              status: res.statusCode || 0,
              body
            });
          });
        });

        clientReq.on('error', reject);
        clientReq.write('hello-ipv6');
        clientReq.end();
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(response.body).toBe('ipv6-echo: hello-ipv6');
      expect(targetRequests.length).toBe(1);
      expect(targetRequests[0].body).toBe('hello-ipv6');
    } finally {
      await new Promise<void>(resolve => targetServer.close(() => resolve()));
    }
  });

  test('IPv6 CONNECT tunneling', async () => {
    const targetPayloads: Buffer[] = [];
    const tcpTargetServer = net.createServer(socket => {
      socket.on('data', data => {
        targetPayloads.push(data);
        socket.write(Buffer.concat([Buffer.from('IPV6-ECHO: '), data]));
      });
    });

    await new Promise<void>(resolve => tcpTargetServer.listen(0, '::1', resolve));
    const tcpTargetPort = (tcpTargetServer.address() as net.AddressInfo).port;

    try {
      const clientSocket = net.connect(proxyPort, '127.0.0.1');

      const handshakePromise = new Promise<string>((resolve, reject) => {
        let responseStr = '';
        clientSocket.on('data', data => {
          responseStr += data.toString();
          if (responseStr.includes('\r\n\r\n')) {
            clientSocket.removeAllListeners('data');
            resolve(responseStr);
          }
        });
        clientSocket.on('error', reject);
      });

      clientSocket.write(
        `CONNECT [::1]:${tcpTargetPort} HTTP/1.1\r\n` +
        `Host: [::1]:${tcpTargetPort}\r\n` +
        `\r\n`
      );

      const handshakeResponse = await handshakePromise;
      expect(handshakeResponse).toContain('HTTP/1.1 200 Connection Established');

      const replyPromise = new Promise<string>((resolve, reject) => {
        clientSocket.on('data', data => {
          resolve(data.toString());
        });
        clientSocket.on('error', reject);
      });

      clientSocket.write('ipv6-connect-data');

      const reply = await replyPromise;
      expect(reply).toBe('IPV6-ECHO: ipv6-connect-data');
      expect(targetPayloads[0].toString()).toBe('ipv6-connect-data');

      clientSocket.end();
    } finally {
      await new Promise<void>(resolve => tcpTargetServer.close(() => resolve()));
    }
  });

  test('CONNECT to unreachable target returns 502 Bad Gateway', async () => {
    const tempServer = net.createServer();
    await new Promise<void>(resolve => tempServer.listen(0, '127.0.0.1', resolve));
    const unusedPort = (tempServer.address() as net.AddressInfo).port;
    await new Promise<void>(resolve => tempServer.close(() => resolve()));

    const clientSocket = net.connect(proxyPort, '127.0.0.1');

    const handshakePromise = new Promise<string>((resolve, reject) => {
      let responseStr = '';
      clientSocket.on('data', data => {
        responseStr += data.toString();
        if (responseStr.includes('\r\n\r\n') || responseStr.includes('502')) {
          resolve(responseStr);
        }
      });
      clientSocket.on('error', reject);
      clientSocket.on('end', () => resolve(responseStr));
    });

    clientSocket.write(
      `CONNECT 127.0.0.1:${unusedPort} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${unusedPort}\r\n` +
      `\r\n`
    );

    const handshakeResponse = await handshakePromise;
    expect(handshakeResponse).toContain('HTTP/1.1 502 Bad Gateway');
    
    const clientEndedPromise = new Promise<void>((resolve) => {
      if (clientSocket.destroyed)
        resolve();
      else
        clientSocket.on('close', () => resolve());
    });
    await clientEndedPromise;
  });

  test('CONNECT socket leak test - client socket close destroys target socket', async () => {
    let targetSocket: net.Socket | undefined;
    const tcpTargetServer = net.createServer(socket => {
      targetSocket = socket;
      socket.on('data', () => {});
    });

    await new Promise<void>(resolve => tcpTargetServer.listen(0, '127.0.0.1', resolve));
    const tcpTargetPort = (tcpTargetServer.address() as net.AddressInfo).port;

    try {
      const clientSocket = net.connect(proxyPort, '127.0.0.1');

      const handshakePromise = new Promise<string>((resolve, reject) => {
        let responseStr = '';
        clientSocket.on('data', data => {
          responseStr += data.toString();
          if (responseStr.includes('\r\n\r\n')) {
            clientSocket.removeAllListeners('data');
            resolve(responseStr);
          }
        });
        clientSocket.on('error', reject);
      });

      clientSocket.write(
        `CONNECT 127.0.0.1:${tcpTargetPort} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${tcpTargetPort}\r\n` +
        `\r\n`
      );

      await handshakePromise;

      while (!targetSocket) {
        await new Promise(r => setTimeout(r, 10));
      }

      expect(targetSocket.destroyed).toBe(false);

      clientSocket.destroy();

      const targetDestroyedPromise = new Promise<void>((resolve) => {
        if (targetSocket!.destroyed)
          resolve();
        else
          targetSocket!.on('close', () => resolve());
      });

      await targetDestroyedPromise;
      expect(targetSocket!.destroyed).toBe(true);
    } finally {
      await new Promise<void>(resolve => tcpTargetServer.close(() => resolve()));
    }
  });

  test('CONNECT socket leak test - target socket close destroys client socket', async () => {
    let targetSocket: net.Socket | undefined;
    const tcpTargetServer = net.createServer(socket => {
      targetSocket = socket;
      socket.on('data', () => {});
    });

    await new Promise<void>(resolve => tcpTargetServer.listen(0, '127.0.0.1', resolve));
    const tcpTargetPort = (tcpTargetServer.address() as net.AddressInfo).port;

    try {
      const clientSocket = net.connect(proxyPort, '127.0.0.1');

      const handshakePromise = new Promise<string>((resolve, reject) => {
        let responseStr = '';
        clientSocket.on('data', data => {
          responseStr += data.toString();
          if (responseStr.includes('\r\n\r\n')) {
            clientSocket.removeAllListeners('data');
            resolve(responseStr);
          }
        });
        clientSocket.on('error', reject);
      });

      clientSocket.write(
        `CONNECT 127.0.0.1:${tcpTargetPort} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${tcpTargetPort}\r\n` +
        `\r\n`
      );

      await handshakePromise;

      while (!targetSocket) {
        await new Promise(r => setTimeout(r, 10));
      }

      expect(clientSocket.destroyed).toBe(false);

      targetSocket.destroy();

      const clientDestroyedPromise = new Promise<void>((resolve) => {
        if (clientSocket.destroyed)
          resolve();
        else
          clientSocket.on('close', () => resolve());
      });

      await clientDestroyedPromise;
      expect(clientSocket.destroyed).toBe(true);
    } finally {
      await new Promise<void>(resolve => tcpTargetServer.close(() => resolve()));
    }
  });
});
