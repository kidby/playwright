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

import 'playwright-core/lib/bootstrap';

import { ManualPromise } from '@isomorphic/manualPromise';
import { setTimeOrigin } from '@isomorphic/time';
import { startProfiling, stopProfiling } from '@utils/profiler';

import { serializeError } from '../util.js';

import type { EnvProducedPayload, ProcessInitParams, TestInfoErrorPayload } from './ipc.js';

// Transport abstraction so the same worker entry runs under both
// `child_process.fork` (Node mode, uses process.send/process.on('message'))
// and `worker_threads.Worker` / `Bun.Worker` (uses parentPort). The fork path
// stays the default on Node; the Worker path is enabled on Bun by the parent
// in runner/processHost.ts to unlock Bun's zero-copy postMessage fast path.
type WorkerTransport = {
  postMessage(msg: unknown): void;
  onMessage(handler: (msg: any) => void): void;
  readonly isWorkerThread: boolean;
};

function createTransport(): WorkerTransport {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const wt = require('node:worker_threads') as typeof import('node:worker_threads');
    if (!wt.isMainThread && wt.parentPort) {
      const port = wt.parentPort;
      return {
        postMessage: m => port.postMessage(m),
        onMessage: h => port.on('message', h),
        isWorkerThread: true,
      };
    }
  } catch {
    // worker_threads unavailable — fall through to fork path.
  }
  return {
    postMessage: m => process.send!(m),
    onMessage: h => process.on('message', h),
    isWorkerThread: false,
  };
}

const transport = createTransport();

export type ProtocolRequest = {
  id: number;
  method: string;
  params?: any;
};

export type ProtocolResponse = {
  id?: number;
  error?: TestInfoErrorPayload;
  method?: string;
  params?: any;
  result?: any;
};

export class ProcessRunner {
  async gracefullyClose(): Promise<void> { }

  protected dispatchEvent(method: string, params: any) {
    const response: ProtocolResponse = { method, params };
    sendMessageToParent({ method: '__dispatch__', params: response });
  }

  protected async sendRequest(method: string, params?: any): Promise<any> {
    return await sendRequestToParent(method, params);
  }

  protected async sendMessageNoReply(method: string, params?: any) {
    void sendRequestToParent(method, params).catch(() => {});
  }
}

let gracefullyCloseCalled = false;
let forceExitInitiated = false;

let processRunner: ProcessRunner | undefined;
let processName: string | undefined;
const startingEnv = { ...process.env };

export function startProcessRunner(create: (params: any) => ProcessRunner) {
  sendMessageToParent({ method: 'ready' });

  // Workers don't receive a `disconnect` event (no separate IPC channel) and
  // don't observe SIGINT/SIGTERM — the parent process handles signals and
  // drives shutdown via worker.terminate() or an explicit `__stop__` message.
  // Under child_process.fork these handlers stay as the original safety net.
  if (!transport.isWorkerThread) {
    process.on('disconnect', () => gracefullyCloseAndExit(true));
    process.on('SIGINT', () => {});
    process.on('SIGTERM', () => {});
  }

  transport.onMessage(async (message: any) => {
    if (message.method === '__init__') {
      const { processParams, runnerParams } = message.params as { processParams: ProcessInitParams, runnerParams: any };
      void startProfiling();
      setTimeOrigin(processParams.timeOrigin);
      processRunner = create(runnerParams);
      processName = processParams.processName;
      return;
    }
    if (message.method === '__stop__') {
      const keys = new Set([...Object.keys(process.env), ...Object.keys(startingEnv)]);
      const producedEnv: EnvProducedPayload = [...keys].filter(key => startingEnv[key] !== process.env[key]).map(key => [key, process.env[key] ?? null]);
      sendMessageToParent({ method: '__env_produced__', params: producedEnv });
      await gracefullyCloseAndExit(false);
      return;
    }
    if (message.method === '__dispatch__') {
      const { id, method, params } = message.params as ProtocolRequest;
      try {
        const result = await (processRunner as any)[method](params);
        const response: ProtocolResponse = { id, result };
        sendMessageToParent({ method: '__dispatch__', params: response });
      } catch (e) {
        const response: ProtocolResponse = { id, error: serializeError(e) };
        sendMessageToParent({ method: '__dispatch__', params: response });
      }
    }
    if (message.method === '__response__')
      handleResponseFromParent(message.params as ProtocolResponse);
  });
}

const kForceExitTimeout = +(process.env.PWTEST_FORCE_EXIT_TIMEOUT || 30000);

async function gracefullyCloseAndExit(forceExit: boolean) {
  if (forceExit && !forceExitInitiated) {
    forceExitInitiated = true;
    // Force exit after 30 seconds.
    // eslint-disable-next-line no-restricted-properties
    setTimeout(() => process.exit(0), kForceExitTimeout);
  }
  if (!gracefullyCloseCalled) {
    gracefullyCloseCalled = true;
    // Meanwhile, try to gracefully shutdown.
    await processRunner?.gracefullyClose().catch(() => {});
    if (processName)
      await stopProfiling(processName).catch(() => {});
    // eslint-disable-next-line no-restricted-properties
    process.exit(0);
  }
}

function sendMessageToParent(message: { method: string, params?: any }) {
  try {
    transport.postMessage(message);
  } catch (e) {
    try {
      // By default, the IPC messages are serialized as JSON.
      JSON.stringify(message);
    } catch {
      // Always throw serialization errors.
      throw e;
    }
    // Can throw when closing.
  }
}

let lastId = 0;
const requestCallbacks = new Map<number, ManualPromise<any>>();

async function sendRequestToParent(method: string, params?: any): Promise<any> {
  const id = ++lastId;
  sendMessageToParent({ method: '__request__', params: { id, method, params } });
  const promise = new ManualPromise<any>();
  requestCallbacks.set(id, promise);
  return promise;
}

function handleResponseFromParent(response: ProtocolResponse) {
  const promise = requestCallbacks.get(response.id!);
  if (!promise)
    return;
  requestCallbacks.delete(response.id!);
  if (response.error)
    promise.reject(new Error(response.error.message));
  else
    promise.resolve(response.result);
}
