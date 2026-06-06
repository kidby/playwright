import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';

// Re-implement the lock logic exactly as in src/audit.ts but parameterized for testing
async function acquireLock(lockDir: string, options: { lockTimeout?: number } = {}) {
  const metaFile = path.join(lockDir, 'metadata.json');
  const lockTimeout = options.lockTimeout ?? 5 * 60 * 1000;

  while (true) {
    try {
      await fs.mkdir(lockDir);
      const metadata = {
        pid: process.pid,
        timestamp: Date.now(),
      };
      await fs.writeFile(metaFile, JSON.stringify(metadata)).catch(() => {});
      return async () => {
        await fs.rm(lockDir, { recursive: true, force: true }).catch(() => {});
      };
    } catch (e: any) {
      if (e.code === 'EEXIST') {
        try {
          let isStale = false;
          try {
            const metaStr = await fs.readFile(metaFile, 'utf8');
            const { pid, timestamp } = JSON.parse(metaStr);
            
            let isProcessRunning = true;
            try {
              process.kill(pid, 0);
            } catch (err: any) {
              if (err.code === 'ESRCH')
                isProcessRunning = false;
            }
            
            if (!isProcessRunning || Date.now() - timestamp > lockTimeout)
              isStale = true;
          } catch (err) {
            const stat = await fs.stat(lockDir);
            if (Date.now() - stat.mtimeMs > lockTimeout)
              isStale = true;
          }

          if (isStale) {
            // Atomic cleanup of stale lock via rename
            const cleanupDir = `${lockDir}.cleanup-${crypto.randomUUID()}`;
            try {
              await fs.rename(lockDir, cleanupDir);
              await fs.rm(cleanupDir, { recursive: true, force: true }).catch(() => {});
            } catch (err) {
              // Ignored - another worker successfully cleaned it up
            }
            continue;
          }
        } catch (err) {
          // Ignore filesystem checks errors
        }
        await new Promise(r => setTimeout(r, 100));
      } else {
        throw e;
      }
    }
  }
}

// Re-implement proxy wrappers exactly as in src/audit.ts
function wrapSession(session: any): any {
  const wildcardListeners = new Set<Function>();
  const sessionId = crypto.randomUUID();

  const handleEvent = (eventData: { method: string; params?: any }) => {
    for (const listener of wildcardListeners) {
      try {
        listener(eventData.method, eventData.params);
      } catch (err) {
        // Suppress callback errors to prevent session crash
      }
    }
  };
  session.on('event', handleEvent);

  session.on('close', () => {
    session.off('event', handleEvent);
  });

  return new Proxy(session, {
    get(target, prop, receiver) {
      if (prop === 'id')
        return () => sessionId;
      if (prop === 'on' || prop === 'addListener') {
        return (event: string | symbol, listener: (...args: any[]) => void) => {
          if (event === '*')
            wildcardListeners.add(listener);
          else
            target.on(event as any, listener);
          return receiver;
        };
      }
      if (prop === 'off' || prop === 'removeListener') {
        return (event: string | symbol, listener: (...args: any[]) => void) => {
          if (event === '*')
            wildcardListeners.delete(listener);
          else
            target.off(event as any, listener);
          return receiver;
        };
      }
      const val = Reflect.get(target, prop, receiver);
      if (typeof val === 'function')
        return val.bind(target);
      return val;
    },
  });
}

function wrapPage(page: any): any {
  return new Proxy(page, {
    get(target, prop, receiver) {
      if (prop === 'target') {
        return () => ({
          createCDPSession: async () => {
            const session = await page.context().newCDPSession(page);
            return wrapSession(session);
          },
        });
      }
      const val = Reflect.get(target, prop, receiver);
      if (typeof val === 'function')
        return val.bind(target);
      return val;
    },
  });
}

test.describe('Challenger - Stress Tests & Verification', () => {
  let server: http.Server;
  let port: number;

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!DOCTYPE html><html><head><title>Challenger Test</title></head><body><h1>Hello</h1></body></html>');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as any).port;
  });

  test.afterAll(() => {
    server.close();
  });

  test('Lock mechanism - concurrency & mutual exclusion stress test', async () => {
    const testLockDir = path.join(os.tmpdir(), `pw-lh-test-lock-${crypto.randomUUID()}`);
    const activeTasks = new Set<number>();
    let maxConcurrent = 0;
    const executionOrder: number[] = [];

    const runWorker = async (id: number) => {
      const release = await acquireLock(testLockDir, { lockTimeout: 10000 });
      
      // Critical Section
      activeTasks.add(id);
      maxConcurrent = Math.max(maxConcurrent, activeTasks.size);
      executionOrder.push(id);
      
      // Verify mutual exclusion
      expect(activeTasks.size).toBe(1);
      
      // Simulate some asynchronous work in the critical section
      await new Promise(resolve => setTimeout(resolve, 50));
      
      activeTasks.delete(id);
      await release();
    };

    // Spawn 15 workers concurrently
    const workers = Array.from({ length: 15 }, (_, i) => runWorker(i));
    await Promise.all(workers);

    expect(maxConcurrent).toBe(1);
    expect(activeTasks.size).toBe(0);
    expect(executionOrder).toHaveLength(15);
    // Cleanup
    await fs.rm(testLockDir, { recursive: true, force: true }).catch(() => {});
  });

  test('Lock mechanism - stale recovery (dead process)', async () => {
    const testLockDir = path.join(os.tmpdir(), `pw-lh-test-lock-dead-proc-${crypto.randomUUID()}`);
    await fs.mkdir(testLockDir, { recursive: true });

    // Find a guaranteed dead PID
    let deadPid = 999999;
    while (true) {
      try {
        process.kill(deadPid, 0);
        deadPid++;
      } catch (err: any) {
        if (err.code === 'ESRCH')
          break;
        deadPid++;
      }
    }

    const metadata = {
      pid: deadPid,
      timestamp: Date.now(),
    };
    await fs.writeFile(path.join(testLockDir, 'metadata.json'), JSON.stringify(metadata));

    // Call acquireLock. It should detect dead process and recover immediately
    const start = Date.now();
    const release = await acquireLock(testLockDir, { lockTimeout: 5000 });
    const duration = Date.now() - start;

    // It should have recovered immediately, definitely in less than 500ms
    expect(duration).toBeLessThan(1000);

    // Verify lock is held by current process now
    const metaStr = await fs.readFile(path.join(testLockDir, 'metadata.json'), 'utf8');
    const newMeta = JSON.parse(metaStr);
    expect(newMeta.pid).toBe(process.pid);

    await release();
    await fs.rm(testLockDir, { recursive: true, force: true }).catch(() => {});
  });

  test('Lock mechanism - stale recovery (active process timeout)', async () => {
    const testLockDir = path.join(os.tmpdir(), `pw-lh-test-lock-active-timeout-${crypto.randomUUID()}`);
    await fs.mkdir(testLockDir, { recursive: true });

    // Set lock metadata to current process (active) but timestamp in the past (stale)
    const metadata = {
      pid: process.pid,
      timestamp: Date.now() - 6000,
    };
    await fs.writeFile(path.join(testLockDir, 'metadata.json'), JSON.stringify(metadata));

    // Call acquireLock with lockTimeout = 5000. It should detect stale timeout and recover immediately.
    const start = Date.now();
    const release = await acquireLock(testLockDir, { lockTimeout: 5000 });
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(1000);

    await release();
    await fs.rm(testLockDir, { recursive: true, force: true }).catch(() => {});
  });

  test('Lock mechanism - stale recovery (corrupted metadata fallback)', async () => {
    const testLockDir = path.join(os.tmpdir(), `pw-lh-test-lock-corrupt-${crypto.randomUUID()}`);
    await fs.mkdir(testLockDir, { recursive: true });

    // Write corrupted non-JSON to metadata.json
    await fs.writeFile(path.join(testLockDir, 'metadata.json'), 'garbage content {not-json}');

    // Set the lock directory's mtime to be in the past (stale)
    const past = new Date(Date.now() - 10000);
    await fs.utimes(testLockDir, past, past);

    // Call acquireLock. It should fail to parse JSON, fall back to stat mtime, see it is stale, and recover.
    const start = Date.now();
    const release = await acquireLock(testLockDir, { lockTimeout: 5000 });
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(1000);

    await release();
    await fs.rm(testLockDir, { recursive: true, force: true }).catch(() => {});
  });

  test('Lock mechanism - wait until active lock becomes stale', async () => {
    const testLockDir = path.join(os.tmpdir(), `pw-lh-test-lock-wait-${crypto.randomUUID()}`);
    await fs.mkdir(testLockDir, { recursive: true });

    // Active process and fresh timestamp (not stale yet)
    const metadata = {
      pid: process.pid,
      timestamp: Date.now(),
    };
    await fs.writeFile(path.join(testLockDir, 'metadata.json'), JSON.stringify(metadata));

    // Call acquireLock with 500ms timeout. It should block and wait until 500ms has elapsed.
    const start = Date.now();
    const release = await acquireLock(testLockDir, { lockTimeout: 500 });
    const duration = Date.now() - start;

    expect(duration).toBeGreaterThanOrEqual(500);

    await release();
    await fs.rm(testLockDir, { recursive: true, force: true }).catch(() => {});
  });

  test('Page and CDPSession proxies - delegation & no state leak', async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port}`);

    // Wrap the page
    const wrappedPage = wrapPage(page);

    // 1. Verify standard functions work
    expect(wrappedPage.url()).toBe(`http://127.0.0.1:${port}/`);
    const content = await wrappedPage.content();
    expect(content).toContain('Challenger Test');

    // 2. Verify target and CDPSession
    const targetObj = wrappedPage.target();
    expect(targetObj).toBeDefined();
    expect(typeof targetObj.createCDPSession).toBe('function');

    const wrappedSession = await targetObj.createCDPSession();
    expect(wrappedSession).toBeDefined();
    expect(typeof wrappedSession.id).toBe('function');
    expect(typeof wrappedSession.id()).toBe('string');

    // 3. Verify event listeners and wildcard emitter
    const receivedEvents: { method: string; params: any }[] = [];
    const wildcardListener = (method: string, params: any) => {
      receivedEvents.push({ method, params });
    };

    // Chainable check
    const chainResult = wrappedSession.on('*', wildcardListener);
    expect(chainResult).toBe(wrappedSession); // Should return the proxy (receiver)

    // Enable Page domain to receive events
    await wrappedSession.send('Page.enable');

    // Trigger some protocol event - navigate the page
    await wrappedPage.goto(`http://127.0.0.1:${port}/?navigate-trigger`);

    // Verify wildcard listener received events
    expect(receivedEvents.length).toBeGreaterThan(0);
    const hasFrameNavigated = receivedEvents.some(ev => ev.method === 'Page.frameNavigated');
    expect(hasFrameNavigated).toBe(true);

    // Verify listenerCount on the underlying raw session
    // The proxy session targets the raw playright session. Let's find it.
    // In wrapSession, session.on('event', handleEvent) was registered on the original session.
    // The original session is the target of the proxy.
    // We can access target via Reflect or if we can get it from the proxy.
    // Wait, the proxy target is `session`. Let's check the listener count on the page's actual CDPSessions.
    // Actually, since we wrapped `session`, let's get the raw session object.
    // We can't directly get it unless we stored it. But we can assert listener count by calling a method on the proxy
    // that delegates to the raw target, e.g. `wrappedSession.listenerCount('event')`.
    // Let's verify `listenerCount` works on the proxy:
    const initialListenerCount = wrappedSession.listenerCount('event');
    expect(initialListenerCount).toBe(1); // The handleEvent listener we added

    // 4. Verify removeListener '*' works
    wrappedSession.off('*', wildcardListener);
    const eventsCountBeforeNav = receivedEvents.length;
    await wrappedPage.goto(`http://127.0.0.1:${port}/?navigate-trigger-2`);
    // Should not receive new events via wildcardListener
    expect(receivedEvents.length).toBe(eventsCountBeforeNav);

    // 5. Verify close / cleanup does not leak event listeners
    // When session emits 'close', it should remove 'event' listener from target
    wrappedSession.emit('close');
    const postCloseListenerCount = wrappedSession.listenerCount('event');
    expect(postCloseListenerCount).toBe(0); // 'handleEvent' listener should have been removed!
  });
});
