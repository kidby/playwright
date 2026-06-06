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
