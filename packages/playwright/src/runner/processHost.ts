/**
 * Copyright Microsoft Corporation. All rights reserved.
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

import child_process from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';
import url from 'url';

import debug from '@utils/debugLog';
import { assert } from '@isomorphic/assert';
import { monotonicTime, timeOrigin } from '@isomorphic/time';
import { raceAgainstDeadline } from '@isomorphic/timeoutRunner';

// Lazy-loaded to avoid eagerly inlining cacheBackend.ts into the runner bundle.
function flushSqliteWrites() {
  const modPath = path.join(__dirname, '..', 'transform', 'cacheBackend.js');
  return require(modPath).flushSqliteWrites();
}

import type { ipc, processRunner } from '../common/index.js';

export type ProcessExitData = {
  unexpectedly: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
};

// Transport abstraction so the test runner can run workers as either
// `child_process.fork` (Node mode, IPC channel) or `Bun.Worker` (Bun mode,
// zero-copy postMessage fast path — 2-241× faster per Bun's own benchmarks).
interface ChildTransport {
  postMessage(msg: unknown): void;
  onMessage(h: (msg: any) => void): void;
  onExit(h: (code: number | null, signal: NodeJS.Signals | null) => void): void;
  onError(h: (err: Error) => void): void;
  terminate(): void;
  forceKill(): void;
  readonly pid: number | undefined;
}

// Opt-in: `PW_USE_BUN_WORKER=1` switches workers from `child_process.fork`
// to `Bun.Worker`. Benchmarks (June 2026) showed identical median wall-clock
// to the fork path with slightly worse tail latency — Bun's "2-241× faster
// postMessage" doesn't translate when per-test JSC runtime, not IPC,
// dominates the gap. Kept behind a flag so future Bun releases can be
// re-tested without touching code. See `.claude/plans/bun-worker-migration.md`.
const useBunWorker = !!(process as any).versions.bun && !!process.env.PW_USE_BUN_WORKER;

export class ProcessHost extends EventEmitter {
  private _child: ChildTransport | undefined;
  private _didSendStop = false;
  private _processDidExit = false;
  private _didExitAndRanOnExit = false;
  private _entryScript: string;
  private _lastMessageId = 0;
  private _callbacks = new Map<number, { resolve: (result: any) => void, reject: (error: Error) => void }>();
  private _processName: string;
  private _producedEnv: Record<string, string | undefined> = {};
  private _extraEnv: Record<string, string | undefined>;
  private _requestHandlers = new Map<string, (params: any) => Promise<any>>();

  constructor(entryScript: string, processName: string, env: Record<string, string | undefined>) {
    super();
    this._entryScript = entryScript;
    this._processName = processName;
    this._extraEnv = env;
  }

  async startRunner(runnerParams: any, options: { onStdOut?: (chunk: Buffer | string) => void, onStdErr?: (chunk: Buffer | string) => void } = {}): Promise<ProcessExitData | undefined> {
    assert(!this._child, 'Internal error: starting the same process twice');
    this._child = useBunWorker
      ? spawnBunWorker(this._entryScript, this._extraEnv)
      : spawnForkedChild(this._entryScript, this._extraEnv, options.onStdOut, options.onStdErr);
    this._child.onExit(async (code, signal) => {
      this._processDidExit = true;
      await this.onExit();
      this._didExitAndRanOnExit = true;
      this.emit('exit', { unexpectedly: !this._didSendStop, code, signal } as ProcessExitData);
    });
    this._child.onError(() => {});  // do not yell at a send to dead process.
    this._child.onMessage((message: any) => {
      if (debug.enabled('pw:test:protocol'))
        debug('pw:test:protocol')('◀ RECV ' + JSON.stringify(message));
      if (message.method === '__env_produced__') {
        const producedEnv: ipc.EnvProducedPayload = message.params;
        this._producedEnv = Object.fromEntries(producedEnv.map(e => [e[0], e[1] ?? undefined]));
      } else if (message.method === '__dispatch__') {
        const { id, error, method, params, result } = message.params as processRunner.ProtocolResponse;
        if (id && this._callbacks.has(id)) {
          const { resolve, reject } = this._callbacks.get(id)!;
          this._callbacks.delete(id);
          if (error) {
            const errorObject = new Error(error.message);
            errorObject.stack = error.stack;
            reject(errorObject);
          } else {
            resolve(result);
          }
        } else {
          this.emit(method!, params);
        }
      } else if (message.method === '__request__') {
        const { id, method, params } = message.params as processRunner.ProtocolRequest;
        const handler = this._requestHandlers.get(method);
        if (!handler) {
          this.send({ method: '__response__', params: { id, error: { message: 'Unknown method' } } });
        } else {
          handler(params).then(result => {
            this.send({ method: '__response__', params: { id, result } });
          }).catch(error => {
            this.send({ method: '__response__', params: { id, error: { message: error.message } } });
          });
        }
      } else {
        this.emit(message.method!, message.params);
      }
    });

    const error = await new Promise<ProcessExitData | undefined>(resolve => {
      this._child!.onExit((code, signal) => resolve({ unexpectedly: true, code, signal }));
      this.once('ready', () => resolve(undefined));
    });

    if (error)
      return error;

    const processParams: ipc.ProcessInitParams = {
      processName: this._processName,
      timeOrigin: timeOrigin(),
    };

    this.send({
      method: '__init__', params: {
        processParams,
        runnerParams
      }
    });
  }

  sendMessage(message: { method: string, params?: any }) {
    const id = ++this._lastMessageId;
    this.send({
      method: '__dispatch__',
      params: { id, ...message }
    });
    return new Promise((resolve, reject) => {
      this._callbacks.set(id, { resolve, reject });
    });
  }

  protected sendMessageNoReply(message: { method: string, params?: any }) {
    this.sendMessage(message).catch(() => {});
  }

  protected async onExit() {
  }

  onRequest(method: string, handler: (params?: any) => Promise<any>) {
    this._requestHandlers.set(method, handler);
  }

  async stop() {
    if (!this._processDidExit && !this._didSendStop) {
      this.send({ method: '__stop__' });
      this._didSendStop = true;
    }
    if (this._didExitAndRanOnExit)
      return;
    const exitPromise = new Promise<void>(f => this.once('exit', () => f()));
    const timeout = +(process.env.PWTEST_CHILD_PROCESS_TIMEOUT || 5 * 60 * 1000);
    const result = await raceAgainstDeadline(() => exitPromise, monotonicTime() + timeout);
    if (result.timedOut) {
      this.emit('processError', { message: `Error: ${this._processName} process did not exit within ${timeout}ms after stop, force-killed it` });
      this._forceKill();
      await exitPromise;
    }
  }

  private _forceKill() {
    this._child?.forceKill();
  }

  didSendStop() {
    return this._didSendStop;
  }

  producedEnv() {
    return this._producedEnv;
  }

  private send(message: { method: string, params?: any }) {
    if (debug.enabled('pw:test:protocol'))
      debug('pw:test:protocol')('SEND ► ' + JSON.stringify(message));
    this._child?.postMessage(message);
  }
}

function spawnForkedChild(
  entryScript: string,
  extraEnv: Record<string, string | undefined>,
  onStdOut?: (chunk: Buffer | string) => void,
  onStdErr?: (chunk: Buffer | string) => void,
): ChildTransport {
  // Flush any queued cache writes before the fork — the child inherits
  // file descriptors but not in-memory state, and would otherwise read a
  // stale on-disk cache for entries the parent just queued.
  flushSqliteWrites();
  // Node 25's `child_process.fork(path)` chokes on entries inside a
  // `"type": "module"` workspace (ENOENT on the file:// URL form). Route
  // through a sibling `.cjs` shim that dynamic-imports the ESM module.
  // Bun + older Node don't have that problem.
  const needsCjsShim = !!process.versions.node && !process.versions.bun &&
      parseInt(process.versions.node.split('.')[0], 10) >= 25;
  const entry = (needsCjsShim && entryScript.endsWith('.js'))
    ? entryScript.replace(/\.js$/, '.cjs')
    : entryScript;
  const child = child_process.fork(entry, {
    // Note: detached:false so all workers share the parent's process group —
    // Ctrl+C or `kill` shuts down the whole tree.
    detached: false,
    // V8 structured clone is ~2-3× faster than JSON for IPC messages.
    // Safe here because spawnForkedChild() is Node-only (Bun uses
    // spawnBunWorker instead).
    serialization: 'advanced',
    env: { ...process.env, ...extraEnv },
    stdio: [
      'ignore',
      onStdOut ? 'pipe' : 'inherit',
      (onStdErr && !process.env.PW_RUNNER_DEBUG) ? 'pipe' : 'inherit',
      'ipc',
    ],
  });
  if (onStdOut)
    child.stdout?.on('data', onStdOut);
  if (onStdErr)
    child.stderr?.on('data', onStdErr);
  return {
    postMessage: m => child.send(m as any),
    onMessage: h => child.on('message', h),
    onExit: h => child.on('exit', h),
    onError: h => child.on('error', h),
    terminate: () => { child.kill('SIGTERM'); },
    forceKill: () => {
      const pid = child.pid;
      if (!pid)
        return;
      try {
        if (process.platform === 'win32')
          child_process.spawnSync(`taskkill /pid ${pid} /T /F`, { shell: true });
        else
          process.kill(pid, 'SIGKILL');
      } catch {
        // The process may have already exited.
      }
    },
    get pid() { return child.pid; },
  };
}

function spawnBunWorker(
  entryScript: string,
  extraEnv: Record<string, string | undefined>,
): ChildTransport {
  // Bun.Worker re-installs Bun.plugin() per isolate, so preload the same
  // bunRuntime that the main process loads. The shim is the .cjs sibling of
  // the worker entry's per-package bunRuntime.
  const preloadShim = path.resolve(path.dirname(entryScript), '../transform/bunRuntime.js');
  const W = (globalThis as any).Worker as new (entry: string, options?: any) => any;
  const worker = new W(entryScript, {
    preload: [preloadShim],
    env: { ...process.env, ...extraEnv },
  });
  // Bun's Worker exposes the Web Worker shape (addEventListener), plus the
  // Node-compat `on` shape. Use addEventListener — it's the documented API.
  const exitHandlers: Array<(code: number | null, signal: NodeJS.Signals | null) => void> = [];
  let exited = false;
  worker.addEventListener('close', (e: any) => {
    exited = true;
    const code = typeof e?.code === 'number' ? e.code : 0;
    for (const h of exitHandlers)
      h(code, null);
  });
  return {
    postMessage: m => worker.postMessage(m),
    onMessage: h => worker.addEventListener('message', (e: MessageEvent) => h((e as any).data)),
    onExit: h => {
      if (exited)
        queueMicrotask(() => h(0, null));
      else
        exitHandlers.push(h);
    },
    onError: h => worker.addEventListener('error', (e: any) => h(e?.error ?? new Error(String(e?.message ?? e)))),
    terminate: () => { worker.terminate(); },
    forceKill: () => { worker.terminate(); },
    pid: undefined,
  };
}
