import { expect } from '@playwright/test';
import { lighthouseTest as test } from '../src/fixture.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

let server: http.Server;
let port: number;

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/good')
      res.end('<!DOCTYPE html><html><head><title>Test</title><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Test description"></head><body><h1>Hello</h1></body></html>');
    else if (req.url === '/interactive')
      res.end('<!DOCTYPE html><html><head><title>Interactive</title><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Interactive description"></head><body><button id="btn" onclick="document.body.innerHTML += \'<p id=\\\'added\\\'>Added content</p>\'">Interact</button></body></html>');
    else
      res.end('<!DOCTYPE html><html><head><title>Bad</title></head><body><img src="missing.jpg"></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as any).port;
});

test.afterAll(() => {
  server.close();
});

test.describe('Lighthouse integration', () => {
  test('should pass when thresholds are met', async ({ page, lighthouse }) => {
    await page.goto(`http://127.0.0.1:${port}/good`);
    const result = await lighthouse({
      thresholds: {
        performance: 50,
      }
    });
    expect(result.passed).toBe(true);
    expect(result.scores.performance).toBeGreaterThanOrEqual(50);
  });

  test('should throw when thresholds are not met and throwOnFail is true', async ({ page, lighthouse }) => {
    await page.goto(`http://127.0.0.1:${port}/bad`);
    const promise = lighthouse({
      thresholds: { seo: 100 },
      throwOnFail: true,
    });
    await expect(promise).rejects.toThrow(/thresholds not met/);
  });

  test('should save report to disk', async ({ page, lighthouse }, testInfo) => {
    await page.goto(`http://127.0.0.1:${port}/good`);
    const reportName = `test-report-${testInfo.workerIndex}`;
    const outputDir = testInfo.outputDir;
    
    const result = await lighthouse({
      thresholds: { performance: 50 },
      saveReport: ['html', 'json'],
      reportName,
      outputDir,
    });
    
    expect(result.reportPaths).toHaveLength(2);
    
    const htmlExists = await fs.stat(path.join(outputDir, `${reportName}.html`)).catch(() => null);
    const jsonExists = await fs.stat(path.join(outputDir, `${reportName}.json`)).catch(() => null);
    
    expect(htmlExists).toBeTruthy();
    expect(jsonExists).toBeTruthy();
  });

  test('should return failures list when threshold is not met', async ({ page, lighthouse }) => {
    await page.goto(`http://127.0.0.1:${port}/bad`);
    const result = await lighthouse({
      thresholds: { seo: 100 },
      throwOnFail: false,
    });
    expect(result.passed).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures[0]).toContain('seo: scored');
  });

  test('should handle invalid/negative thresholds', async ({ page, lighthouse }) => {
    await page.goto(`http://127.0.0.1:${port}/good`);
    // Negative thresholds should be treated as satisfied (since scores are >= 0)
    const resultNegative = await lighthouse({
      thresholds: { performance: -50 }
    });
    expect(resultNegative.passed).toBe(true);

    // Thresholds > 100 should fail (since scores are <= 100)
    const resultTooHigh = await lighthouse({
      thresholds: { performance: 150 },
      throwOnFail: false,
    });
    expect(resultTooHigh.passed).toBe(false);
    expect(resultTooHigh.failures[0]).toContain('performance: scored');
  });

  test('should support audits with post-navigation element interaction', async ({ page, lighthouse }) => {
    await page.goto(`http://127.0.0.1:${port}/interactive`);
    await page.click('#btn');
    await (expect(page.locator('#added')) as any).toBeVisible();

    const result = await lighthouse({
      thresholds: { performance: 10 }
    });
    expect(result.passed).toBe(true);
  });

  test.describe('Concurrent audits', () => {
    test.describe.configure({ mode: 'parallel' });

    test('concurrent audit 1', async ({ page, lighthouse }) => {
      await page.goto(`http://127.0.0.1:${port}/good`);
      const result = await lighthouse({
        thresholds: { performance: 50 }
      });
      expect(result.passed).toBe(true);
    });

    test('concurrent audit 2', async ({ page, lighthouse }) => {
      await page.goto(`http://127.0.0.1:${port}/good`);
      const result = await lighthouse({
        thresholds: { performance: 50 }
      });
      expect(result.passed).toBe(true);
    });
  });

  test('should throw error if audited on about:blank or no URL', async ({ page, lighthouse }) => {
    await expect(lighthouse({ thresholds: { performance: 50 } })).rejects.toThrow(
      /page has no URL yet/
    );
  });

  test('should skip lock and run when serialize is false', async ({ page, lighthouse }) => {
    await page.goto(`http://127.0.0.1:${port}/good`);
    const result = await lighthouse({
      thresholds: { performance: 50 },
      serialize: false,
    });
    expect(result.passed).toBe(true);
  });

  test('should check URL before acquiring lock', async ({ page, lighthouse }) => {
    await expect(
      lighthouse({
        thresholds: { performance: 50 },
        serialize: true,
      })
    ).rejects.toThrow(/page has no URL yet/);
  });
});

