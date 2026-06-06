import { test, expect } from './playwright-test-fixtures';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Milestone 4 - Dynamic Validation', () => {

  test('should allocate unique trace names for conflicting custom names', async ({ runInlineTest }) => {
    const result = await runInlineTest({
      'a.spec.ts': `
        import { test, expect, chromium } from '@playwright/test';
        import * as fs from 'fs';
        import * as path from 'path';

        test('conflicting trace names', async ({}, testInfo) => {
          const tracesDir = testInfo.outputPath('custom-traces');
          const browser = await chromium.launch({ tracesDir });
          const context1 = await browser.newContext();
          const context2 = await browser.newContext();

          await context1.tracing.start({ name: 'conflict', snapshots: true });
          await context2.tracing.start({ name: 'conflict', snapshots: true });

          await context1.tracing.stop();
          await context2.tracing.stop();

          const files = fs.readdirSync(tracesDir);
          console.log('TRACE_FILES:' + JSON.stringify(files));
          await browser.close();
        });
      `
    });

    expect(result.exitCode).toBe(0);
    expect(result.passed).toBe(1);

    // Extract TRACE_FILES from output
    const match = result.output.match(/TRACE_FILES:(.*)/);
    expect(match).toBeTruthy();
    const files = JSON.parse(match![1]);
    
    // We expect both 'conflict.network' and 'conflict-1.network' (or trace files)
    expect(files).toContain('conflict.network');
    expect(files).toContain('conflict-1.network');
  });
});
