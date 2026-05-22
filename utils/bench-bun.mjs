#!/usr/bin/env node
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

import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const bunPath = (() => {
  try { return execFileSync('which', ['bun'], { encoding: 'utf-8' }).trim(); }
  catch { return ''; }
})();

if (!bunPath) {
  process.stderr.write('bun not found on PATH; benchmark needs Bun installed\n');
  process.exit(1);
}

const ITERATIONS = Number(process.env.BENCH_ITERATIONS || 1000);
const FILE_SIZE_KB = Number(process.env.BENCH_FILE_KB || 4);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwbench-'));
const readPath = path.join(tmpDir, 'sample.ts');
const sample = ('import type { Page } from "@playwright/test";\nexport const x = 1;\n'.repeat(Math.max(1, FILE_SIZE_KB * 16)));
fs.writeFileSync(readPath, sample, 'utf-8');

const benches = `
import fs from 'fs';
import { performance } from 'perf_hooks';

const readPath = ${JSON.stringify(readPath)};
const writeDir = ${JSON.stringify(tmpDir)};
const iterations = ${ITERATIONS};
const sample = fs.readFileSync(readPath, 'utf-8');
const runtime = typeof Bun !== 'undefined' ? 'bun' : 'node';

async function timeAsync(label, fn) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++)
    await fn(i);
  return { label, ms: performance.now() - start };
}

function timeSync(label, fn) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++)
    fn(i);
  return { label, ms: performance.now() - start };
}

const results = [];

// Reads
results.push(timeSync('fs.readFileSync', () => fs.readFileSync(readPath, 'utf-8')));
if (runtime === 'bun')
  results.push(await timeAsync('Bun.file().text()', () => Bun.file(readPath).text()));

// Writes
results.push(timeSync('fs.writeFileSync', (i) => fs.writeFileSync(writeDir + '/w-' + i + '.txt', sample, 'utf-8')));
if (runtime === 'bun')
  results.push(await timeAsync('Bun.write()', (i) => Bun.write(writeDir + '/w2-' + i + '.txt', sample)));

// pathToFileURL
const url = await import('url');
results.push(timeSync('url.pathToFileURL', () => url.pathToFileURL(readPath).toString()));
if (runtime === 'bun')
  results.push(timeSync('Bun.pathToFileURL', () => Bun.pathToFileURL(readPath).toString()));

process.stdout.write(JSON.stringify({ runtime, iterations, fileBytes: sample.length, results }) + '\\n');
`;

const scriptPath = path.join(tmpDir, 'bench.mjs');
fs.writeFileSync(scriptPath, benches, 'utf-8');

function runUnder(runtime) {
  const bin = runtime === 'bun' ? bunPath : process.execPath;
  const r = spawnSync(bin, [scriptPath], { encoding: 'utf-8' });
  if (r.status !== 0)
    throw new Error(`${runtime} failed:\n${r.stderr}`);
  return JSON.parse(r.stdout.trim());
}

process.stdout.write(`Running ${ITERATIONS} iterations on ~${FILE_SIZE_KB} KB file under each runtime…\n\n`);

const node = runUnder('node');
const bun = runUnder('bun');

const rows = [
  ['operation', 'node (ms total)', 'bun (ms total)', 'speedup', 'note'],
];
const nodeMap = new Map(node.results.map(r => [r.label, r.ms]));
const bunMap = new Map(bun.results.map(r => [r.label, r.ms]));
const ops = [
  ['fs.readFileSync', 'Bun.file().text()'],
  ['fs.writeFileSync', 'Bun.write()'],
  ['url.pathToFileURL', 'Bun.pathToFileURL'],
];
for (const [nodeOp, bunOp] of ops) {
  const nodeMs = nodeMap.get(nodeOp);
  const bunMs = bunMap.get(bunOp) ?? bunMap.get(nodeOp);
  const speedup = nodeMs && bunMs ? (nodeMs / bunMs).toFixed(2) + '×' : 'n/a';
  rows.push([nodeOp + ' ↔ ' + bunOp, nodeMs?.toFixed(1) ?? '-', bunMs?.toFixed(1) ?? '-', speedup, '']);
}

const widths = rows[0].map((_, i) => Math.max(...rows.map(r => String(r[i]).length)));
for (const r of rows)
  process.stdout.write('| ' + r.map((c, i) => String(c).padEnd(widths[i])).join(' | ') + ' |\n');

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });
