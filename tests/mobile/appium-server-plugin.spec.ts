import { test, expect } from '@playwright/test';
import { AppiumServerPlugin } from '../../packages/playwright/src/plugins/appiumServerPlugin';
import fs from 'fs';
import path from 'path';

test('AppiumServerPlugin starts and stops successfully without unhandled rejections', async ({}, testInfo) => {
  const mockServerFile = path.join(testInfo.outputDir, 'mock-server.js');
  fs.mkdirSync(testInfo.outputDir, { recursive: true });
  fs.writeFileSync(mockServerFile, `
    const http = require('http');
    const server = http.createServer((req, res) => {
      if (req.url === '/status') {
        res.end(JSON.stringify({ value: { ready: true } }));
      } else {
        res.end('{}');
      }
    });
    server.listen(4723, '127.0.0.1', () => console.log('started'));
  `);

  const plugin = new AppiumServerPlugin({
    autoStart: true,
    serverUrl: 'http://127.0.0.1:4723',
    command: 'node',
    args: [mockServerFile]
  }, 'test-project');

  // We add a listener to check for unhandled rejections.
  let unhandledRejection: any = null;
  const onUnhandled = (err: any) => { unhandledRejection = err; };
  process.on('unhandledRejection', onUnhandled);

  try {
    const reporter = {
      onStdOut: (s: string) => {},
      onStdErr: (s: string) => {},
    } as any;
    
    fs.mkdirSync(testInfo.outputDir, { recursive: true });
    await plugin.setup({} as any, testInfo.outputDir, reporter);

    // Give it a tick to let race resolve
    await new Promise(r => setTimeout(r, 100));
    
    // Now teardown, which will kill the process
    await plugin.teardown();

    // Give it another tick to let process onExit fire
    await new Promise(r => setTimeout(r, 100));

    expect(unhandledRejection).toBeNull();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('AppiumServerPlugin rejects when workers > devices.length', async ({}, testInfo) => {
  const plugin = new AppiumServerPlugin({
    devices: [{ udid: 'A' }, { udid: 'B' }],
  }, 'pool-project');
  const reporter = { onStdOut: () => {}, onStdErr: () => {} } as any;

  await expect(plugin.setup({ workers: 3 } as any, testInfo.outputDir, reporter))
      .rejects.toThrow(/devices.*has 2 entries but workers=3/);
});

test('AppiumServerPlugin passes validation when devices.length >= workers', async ({}, testInfo) => {
  const plugin = new AppiumServerPlugin({
    devices: [{ udid: 'A' }, { udid: 'B' }],
    // autoStart omitted → setup returns early after validation
  }, 'pool-ok');
  const reporter = { onStdOut: () => {}, onStdErr: () => {} } as any;

  await plugin.setup({ workers: 2 } as any, testInfo.outputDir, reporter);
});

test('AppiumServerPlugin: no devices configured — validation skipped', async ({}, testInfo) => {
  const plugin = new AppiumServerPlugin({}, 'no-pool');
  const reporter = { onStdOut: () => {}, onStdErr: () => {} } as any;
  await plugin.setup({ workers: 5 } as any, testInfo.outputDir, reporter);
});
