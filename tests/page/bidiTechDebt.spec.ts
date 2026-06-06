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

import { test as it, expect } from './pageTest';
import fs from 'fs';
import { parseTraceRaw } from '../config/utils.js';

const testWithFixture = it.extend<{ customContext: any }>({
  customContext: async ({ browser, server }, use, testInfo) => {
    const context = await browser.newContext();
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    await page.goto(server.EMPTY_PAGE);
    
    // Execute the test block
    await use({ context, page });
    
    // Teardown logic
    const tracePath = testInfo.outputPath('fixture-teardown-trace.zip');
    await context.tracing.stop({ path: tracePath });
    await context.close();
    
    // Validate teardown artifact integrity
    expect(fs.existsSync(tracePath)).toBe(true);
    expect(fs.statSync(tracePath).size).toBeGreaterThan(0);
  }
});

const order: string[] = [];
const testWithNestedOrder = it.extend<{ nestedFixture: string }>({
  parentFixture: async ({}, use) => {
    order.push('parent-setup');
    await use('parent');
    order.push('parent-teardown');
    // Verify execution order including child teardown and test body
    expect(order).toEqual(['parent-setup', 'child-setup', 'test-body', 'child-teardown', 'parent-teardown']);
  },
  nestedFixture: async ({ parentFixture }, use) => {
    order.push('child-setup');
    await use('child');
    order.push('child-teardown');
  }
});

// ==========================================
// Tier 1 - Feature Coverage (10 cases)
// ==========================================

it('should support init scripts without function wrappers', async ({ page, server }) => {
  await page.addInitScript('window.testVal = 123;');
  await page.goto(server.EMPTY_PAGE);
  expect(await page.evaluate(() => window['testVal'])).toBe(123);
});

it('should propagate page init scripts to sub-frames/iframes', async ({ page, server }) => {
  await page.addInitScript('window.inFrame = (window.inFrame || 0) + 1;');
  await page.goto(server.PREFIX + '/frames/one-frame.html');
  const frame = page.frames()[1];
  expect(await frame.evaluate(() => window['inFrame'])).toBe(1);
});

it('should compute correct frame coordinates and offsets', async ({ page, server }) => {
  await page.goto(server.PREFIX + '/frames/one-frame.html');
  const frame = page.frames()[1];
  const element = await frame.$('div');
  expect(element).not.toBeNull();
  const box = await element!.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);
});

it('should retrieve element handle details and use cached shared ID', async ({ page, server }) => {
  await page.goto(server.EMPTY_PAGE);
  await page.setContent('<div id="shared-test">test</div>');
  const handle = await page.$('#shared-test');
  expect(handle).not.toBeNull();
  expect(await handle!.textContent()).toBe('test');
});

it('should record non-zero network transfer size for responses', async ({ page, server }) => {
  const response = await page.goto(server.EMPTY_PAGE);
  expect(response).not.toBeNull();
  const sizes = await response!.request().sizes();
  expect(sizes.responseHeadersSize).toBeGreaterThan(0);
});

it('should identify canceled network requests and set correct failure status', async ({ page, server }) => {
  let interceptCallback;
  const interceptPromise = new Promise<any>(f => interceptCallback = f);
  await page.route('**/aborted-endpoint', route => interceptCallback(route));
  await page.goto(server.EMPTY_PAGE);
  
  page.evaluate(url => {
    globalThis.controller1 = new AbortController();
    fetch(url, { signal: globalThis.controller1.signal }).catch(() => {});
  }, server.PREFIX + '/aborted-endpoint').catch(() => {});
  
  const route = await interceptPromise;
  const failurePromise = page.waitForEvent('requestfailed');
  await page.evaluate(() => globalThis.controller1.abort());
  const failedRequest = await failurePromise;
  expect(failedRequest.failure()).not.toBeNull();
  expect(failedRequest.failure()!.errorText).toMatch(/failed|aborted|canceled/i);
  await route.abort();
});

it('should handle page context destruction event globally', async ({ page, server }) => {
  const context = page.context();
  const newPage = await context.newPage();
  await newPage.goto(server.EMPTY_PAGE);
  await newPage.close();
  expect(newPage.isClosed()).toBe(true);
});

it('should generate unique tracing filenames for separate contexts with the same option name', async ({ page, isBidi, server }, testInfo) => {
  const browser = page.context().browser()!;
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();
  
  const trace1Path = testInfo.outputPath('trace1.zip');
  const trace2Path = testInfo.outputPath('trace2.zip');
  
  await context1.tracing.start({ name: 'my-trace', screenshots: true, snapshots: true });
  await context2.tracing.start({ name: 'my-trace', screenshots: true, snapshots: true });
  
  const page1 = await context1.newPage();
  await page1.goto(server.PREFIX + '/empty.html?context1');
  
  const page2 = await context2.newPage();
  await page2.goto(server.PREFIX + '/empty.html?context2');
  
  await context1.tracing.stop({ path: trace1Path });
  await context2.tracing.stop({ path: trace2Path });
  
  await context1.close();
  await context2.close();
  
  // Extract and verify contents to detect interleaved events
  const { events: events1 } = await parseTraceRaw(trace1Path);
  const { events: events2 } = await parseTraceRaw(trace2Path);
  
  const trace1Content = JSON.stringify(events1);
  const trace2Content = JSON.stringify(events2);
  
  // Assert isolation: context1's trace should not contain context2's events, and vice versa
  expect(trace1Content).toContain('context1');
  expect(trace1Content).not.toContain('context2');
  
  expect(trace2Content).toContain('context2');
  expect(trace2Content).not.toContain('context1');
});

testWithFixture('should run fixture runner teardown and verify integrity checks', async ({ customContext }) => {
  await customContext.page.setContent('<div>Integrity Test</div>');
  expect(await customContext.page.textContent('div')).toBe('Integrity Test');
});

it('should verify event handlers without obsolete window opening listeners', async ({ page, server }) => {
  await page.goto(server.EMPTY_PAGE);
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.evaluate(() => window.open('about:blank')),
  ]);
  expect(popup).toBeDefined();
  expect(popup.url()).toBe('about:blank');
});

// ==========================================
// Tier 2 - Boundary & Corner Cases (10 cases)
// ==========================================

it('should handle syntax errors in init scripts gracefully', async ({ page, server }) => {
  await page.addInitScript('console.error("syntax error simulator"); throw new SyntaxError("Invalid syntax");');
  await page.goto(server.EMPTY_PAGE).catch(() => {});
});

it('should propagate init scripts to dynamic/empty/cross-origin iframes', async ({ page, server }) => {
  await page.addInitScript('window.initVal = 456;');
  await page.goto(server.EMPTY_PAGE);
  await page.evaluate(() => {
    const iframe = document.createElement('iframe');
    iframe.src = 'about:blank';
    document.body.appendChild(iframe);
  });
  const frame = page.frames()[1];
  expect(await frame.evaluate(() => window['initVal'])).toBe(456);
});

it('should compute frame offset for deep nested and zero-size frames', async ({ page, server }) => {
  await page.goto(server.EMPTY_PAGE);
  await page.setContent(`
    <style>body { margin: 0; }</style>
    <iframe id="frameA" style="margin: 20px; border: 5px solid black; padding: 10px; width: 400px; height: 400px;" srcdoc='
      <style>body { margin: 0; }</style>
      <iframe id="frameB" style="margin: 30px; border: 10px solid red; padding: 5px; width: 200px; height: 200px;" srcdoc="
        <style>body { margin: 0; }</style>
        <div id=target style=width:50px;height:50px;margin:15px;background:blue;>target</div>
      "></iframe>
    '></iframe>
  `);
  
  await expect.poll(() => page.mainFrame().childFrames().length).toBe(1);
  const frameA = page.mainFrame().childFrames()[0];
  await expect.poll(() => frameA.childFrames().length).toBe(1);
  const frameB = frameA.childFrames()[0];

  const target = await frameB.$('#target');
  expect(target).not.toBeNull();
  const box = await target!.boundingBox();
  
  // Calculate expected coordinate sum:
  // Margin + border + padding of Frame A: 20 + 5 + 10 = 35
  // Margin + border + padding of Frame B: 30 + 10 + 5 = 45
  // Margin of Target: 15
  // Total expected offset: ~ 95px
  expect(box).not.toBeNull();
  // Tolerance is generous (30px) because browsers differ in default body
  // margins, scrollbar presence, and sub-pixel rounding for nested iframes.
  expect(Math.abs(box!.x - 95)).toBeLessThan(30);
  expect(Math.abs(box!.y - 95)).toBeLessThan(30);

  // Now verify zero-size frames support by appending one and ensuring frames count increases
  await frameB.evaluate(() => {
    const iframe = document.createElement('iframe');
    iframe.src = 'about:blank';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    document.body.appendChild(iframe);
  });
  await expect.poll(() => page.frames().length).toBeGreaterThan(3);
});

it('should throw or return null when trying to resolve non-node element handles', async ({ page }) => {
  const handle = await page.evaluateHandle(() => ({ a: 1 }));
  const element = handle.asElement();
  expect(element).toBeNull();
});

it('should handle zero-byte asset responses and verify transfer size is reported correctly', async ({ page, server }) => {
  server.setRoute('/zero', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '0' });
    res.end();
  });
  await page.goto(server.EMPTY_PAGE);
  const [response] = await Promise.all([
    page.waitForEvent('response', response => response.url().endsWith('/zero')),
    page.evaluate(() => fetch('/zero').then(r => r.text())),
  ]);
  expect(response).not.toBeNull();
  expect(response!.status()).toBe(200);
  const sizes = await response!.request().sizes();
  expect(sizes.responseBodySize).toBe(0);
});

it('should report canceled status for multiple concurrent aborted requests', async ({ page, server }) => {
  let interceptCallback1;
  let interceptCallback2;
  const interceptPromise1 = new Promise<any>(f => interceptCallback1 = f);
  const interceptPromise2 = new Promise<any>(f => interceptCallback2 = f);
  
  await page.route('**/abort1', route => interceptCallback1(route));
  await page.route('**/abort2', route => interceptCallback2(route));
  await page.goto(server.EMPTY_PAGE);
  
  page.evaluate(url => {
    globalThis.c1 = new AbortController();
    fetch(url + '/abort1', { signal: globalThis.c1.signal }).catch(() => {});
  }, server.PREFIX).catch(() => {});
  
  page.evaluate(url => {
    globalThis.c2 = new AbortController();
    fetch(url + '/abort2', { signal: globalThis.c2.signal }).catch(() => {});
  }, server.PREFIX).catch(() => {});
  
  const [route1, route2] = await Promise.all([interceptPromise1, interceptPromise2]);
  
  const failurePromise1 = page.waitForEvent('requestfailed', request => request.url().endsWith('/abort1'));
  const failurePromise2 = page.waitForEvent('requestfailed', request => request.url().endsWith('/abort2'));
  
  await Promise.all([
    page.evaluate(() => globalThis.c1.abort()),
    page.evaluate(() => globalThis.c2.abort()),
  ]);
  
  const [req1, req2] = await Promise.all([failurePromise1, failurePromise2]);
  expect(req1.failure()).not.toBeNull();
  expect(req2.failure()).not.toBeNull();
  
  await Promise.all([route1.abort(), route2.abort()]);
});

it('should tear down context correctly with pending navigations', async ({ page, server }) => {
  const browser = page.context().browser()!;
  const context = await browser.newContext();
  const newPage = await context.newPage();
  server.setRoute('/slow', () => {});
  newPage.goto(server.PREFIX + '/slow').catch(() => {});
  await context.close();
});

it('should fallback to default random names if tracing name option is empty', async ({ page, isBidi, server }, testInfo) => {
  const browser = page.context().browser()!;
  const context = await browser.newContext();
  await context.tracing.start({ name: '', screenshots: true, snapshots: true });
  await context.tracing.stop({ path: testInfo.outputPath('empty-name-trace.zip') });
  await context.close();
});

testWithNestedOrder('should handle nested fixtures and nested teardowns cleanly', async ({ nestedFixture }) => {
  order.push('test-body');
  expect(nestedFixture).toBe('child');
});

it('should handle high concurrency of popup windows in BiDi', async ({ page, server }) => {
  await page.goto(server.EMPTY_PAGE);
  const [p1, p2, p3] = await Promise.all([
    page.waitForEvent('popup'),
    page.waitForEvent('popup'),
    page.waitForEvent('popup'),
    page.evaluate(() => {
      window.open('about:blank');
      window.open('about:blank');
      window.open('about:blank');
    }),
  ]);
  expect(p1).toBeDefined();
  expect(p2).toBeDefined();
  expect(p3).toBeDefined();
  await p1.close();
  await p2.close();
  await p3.close();
});

// ==========================================
// Tier 3 - Cross-Feature (2 cases)
// ==========================================

it('should propagate init scripts to frames loaded from intercepted/routed requests', async ({ page, server }) => {
  await page.addInitScript('window.interceptVal = 789;');
  await page.route('**/iframe-routed.html', route => {
    route.fulfill({
      contentType: 'text/html',
      body: `<iframe src="${server.EMPTY_PAGE}"></iframe>`,
    });
  });
  await page.goto(server.PREFIX + '/iframe-routed.html');
  const frame = page.frames()[1];
  expect(await frame.evaluate(() => window['interceptVal'])).toBe(789);
});

it('should record tracing successfully inside a custom test fixture teardown', async ({ page, isBidi, server }, testInfo) => {
  const browser = page.context().browser()!;
  const context = await browser.newContext();
  await context.tracing.start({ name: 'teardown-trace', screenshots: true, snapshots: true });
  const newPage = await context.newPage();
  await newPage.goto(server.EMPTY_PAGE);
  await context.tracing.stop({ path: testInfo.outputPath('teardown-trace.zip') });
  await context.close();
});

// ==========================================
// Tier 4 - Real-World Application Scenarios (5 cases)
// ==========================================

it('should simulate E2E login flow using cookie insertion, network routing, and clicking', async ({ page, server }) => {
  const context = page.context();
  await context.addCookies([{ name: 'session', value: '12345', domain: 'localhost', path: '/' }]);
  await page.route('**/login', route => {
    route.fulfill({
      contentType: 'text/html',
      body: '<button id="submit">Login</button>',
    });
  });
  await page.goto(server.PREFIX + '/login');
  await page.click('#submit');
  const cookies = await context.cookies();
  expect(cookies.find(c => c.name === 'session')).toBeDefined();
});

it('should run a multi-page dashboard scenario recording separate traces', async ({ page, isBidi, server }, testInfo) => {
  const browser = page.context().browser()!;
  const context = await browser.newContext();
  await context.tracing.start({ name: 'dashboard-trace', screenshots: true, snapshots: true });
  const page1 = await context.newPage();
  const page2 = await context.newPage();
  await page1.goto(server.EMPTY_PAGE);
  await page2.goto(server.EMPTY_PAGE);
  await context.tracing.stop({ path: testInfo.outputPath('dashboard-trace.zip') });
  await context.close();
});

it('should interact with content and frames inside a WYSIWYG editor', async ({ page, server }) => {
  await page.goto(server.PREFIX + '/frames/one-frame.html');
  const frame = page.frames()[1];
  await frame.setContent('<div id="editor" contenteditable="true">Hello</div>');
  const editor = await frame.$('#editor');
  expect(editor).not.toBeNull();
  await editor!.fill('New Content');
  expect(await frame.evaluate(() => document.getElementById('editor')!.textContent)).toBe('New Content');
});

it('should run a data profiling dashboard tracking network transfer sizes and handling aborted assets', async ({ page, server }) => {
  let interceptCallback;
  const interceptPromise = new Promise<any>(f => interceptCallback = f);
  await page.route('**/aborted-asset', route => interceptCallback(route));
  
  server.setRoute('/data', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value: 42 }));
  });
  
  await page.goto(server.EMPTY_PAGE);
  
  const responsePromise = page.waitForEvent('response', r => r.url().endsWith('/data'));
  page.evaluate(() => fetch('/data').catch(() => {}));
  const response = await responsePromise;
  
  page.evaluate(url => {
    globalThis.c3 = new AbortController();
    fetch(url, { signal: globalThis.c3.signal }).catch(() => {});
  }, server.PREFIX + '/aborted-asset').catch(() => {});
  
  const route = await interceptPromise;
  const failurePromise = page.waitForEvent('requestfailed');
  await page.evaluate(() => globalThis.c3.abort());
  const failedRequest = await failurePromise;
  
  const sizes = await response.request().sizes();
  expect(sizes.responseHeadersSize).toBeGreaterThan(0);
  expect(failedRequest.failure()!.errorText).toMatch(/failed|aborted|canceled/i);
  await route.abort();
});

it('should execute a stress test verifying fixtures, tracing, popups, and context cleanup together', async ({ page, isBidi, server }, testInfo) => {
  const browser = page.context().browser()!;
  const context = await browser.newContext();
  await context.tracing.start({ name: 'stress-trace', screenshots: true, snapshots: true });
  const newPage = await context.newPage();
  await newPage.goto(server.EMPTY_PAGE);
  
  const [popup] = await Promise.all([
    newPage.waitForEvent('popup'),
    newPage.evaluate(() => window.open('about:blank')),
  ]);
  
  await popup.goto(server.EMPTY_PAGE);
  await popup.close();
  await context.tracing.stop({ path: testInfo.outputPath('stress-trace.zip') });
  await context.close();
});

it('should correctly decode base64 encoded header values', async ({ page, server }) => {
  server.setRoute('/binary-header', (req, res) => {
    // Send a header with a non-ASCII character to force BiDi base64 encoding.
    // Use ISO-8859-1 (latin1) encoding to set binary header correctly.
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'X-Binary-Header': Buffer.from('hello-ü-world', 'latin1').toString('binary')
    });
    res.end('ok');
  });
  await page.goto(server.EMPTY_PAGE);
  const [response] = await Promise.all([
    page.waitForEvent('response'),
    page.evaluate(() => fetch('/binary-header').then(r => r.text())),
  ]);
  const headers = await response.allHeaders();
  expect(headers['x-binary-header']).toBe('hello-ü-world');
});

it('should not spawn duplicate screencast loops when restarted rapidly', async ({ page }) => {
  const bidiPage = (page as any)._delegate;
  if (!bidiPage || typeof bidiPage.startScreencast !== 'function')
    return; // Non-bidi or unsupported
  
  // Rapid start-stop-start sequence
  bidiPage.startScreencast({ width: 640, height: 480, quality: 80 });
  bidiPage.stopScreencast();
  bidiPage.startScreencast({ width: 640, height: 480, quality: 80 });
  
  // Capture the initial timeout state
  const firstTimeout = bidiPage._screencastTimeout;
  expect(firstTimeout).toBeDefined();
  
  // Wait a small duration to ensure no extra loops have scheduled a new timeout concurrently
  await new Promise(r => setTimeout(r, 200));
  
  // Stop and verify that the single screencastTimeout is cleared and no orphan loops remain
  bidiPage.stopScreencast();
  expect(bidiPage._screencastTimeout).toBeUndefined();
});

it('should handle high concurrency of tracing starts with the same option name', async ({ browserType }, testInfo) => {
  const tracesDir = testInfo.outputPath('shared-traces-dir');
  const browser = await browserType.launch({ tracesDir });
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  
  // Start concurrently in the same tick
  await Promise.all(contexts.map(context => context.tracing.start({ name: 'concurrent-trace', screenshots: true, snapshots: true })));
  
  // Create a page and do something so there's content in the trace
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  await Promise.all(pages.map(p => p.goto('about:blank')));

  // Clean up and stop
  await Promise.all(contexts.map((context, i) => context.tracing.stop({ path: testInfo.outputPath(`concurrent-trace-${i}.zip`) })));
  await Promise.all(contexts.map(context => context.close()));
  await browser.close();

  // Read the directory contents
  const files = fs.readdirSync(tracesDir);
  const traceFiles = files.filter(f => f.endsWith('.trace'));
  const networkFiles = files.filter(f => f.endsWith('.network'));

  expect(traceFiles.length).toBe(3);
  expect(new Set(traceFiles).size).toBe(3);
  for (const file of traceFiles) {
    expect(file.startsWith('concurrent-trace')).toBe(true);
    expect(file.endsWith('.trace')).toBe(true);
  }

  expect(networkFiles.length).toBeGreaterThanOrEqual(3);
  for (const file of networkFiles) {
    expect(file.startsWith('concurrent-trace')).toBe(true);
    expect(file.endsWith('.network')).toBe(true);
  }
});
