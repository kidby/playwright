/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import url from 'url';

import { addToCompilationCache, serializeCompilationCache } from '../transform/compilationCache.js';
import { PortTransport } from '../transform/portTransport.js';
import { singleTSConfig, transformConfig } from '../transform/transform.js';

let loaderChannel: PortTransport | undefined;

export function registerESMLoader() {
  // Opt-out switch.
  if (process.env.PW_DISABLE_TS_ESM)
    return true;

  // Transpilation in `bun` is not necessary, and trying to register a hook would cause issues.
  // https://github.com/oven-sh/bun/issues/8222#issuecomment-3665364677
  if ('Bun' in globalThis)
    return true;

  if (loaderChannel)
    return true;

  const nodeModule = require('node:module');

  // Node 24+ (this fork's target): use synchronous hooks — no off-thread
  // loader, no MessagePort IPC, no PortTransport. The sync load hook in
  // esmLoaderSync.ts handles resolve + load + source maps in-process.
  if (nodeModule.registerHooks && !process.env.PLAYWRIGHT_FORCE_ASYNC_LOADER) {
    const esmLoaderSync = require('../transform/esmLoaderSync.js');
    nodeModule.registerHooks({
      resolve: esmLoaderSync.resolve,
      resolveSync: esmLoaderSync.resolve,
      load: esmLoaderSync.load,
      loadSync: esmLoaderSync.load,
    });
    return true;
  }

  // Legacy async loader path for Node < 22.15.
  const register = nodeModule.register;
  if (!register)
    return false;

  const { port1, port2 } = new MessageChannel();
  register(url.pathToFileURL(require.resolve('../transform/esmLoader.js')), {
    data: { port: port2 },
    transferList: [port2],
  });
  loaderChannel = createPortTransport(port1);
  return true;
}

function createPortTransport(port: MessagePort) {
  return new PortTransport(port, async (method, params) => {
    if (method === 'pushToCompilationCache')
      addToCompilationCache(params.cache);
  });
}

export async function startCollectingFileDeps() {
  if (!loaderChannel)
    return;
  await loaderChannel.send('startCollectingFileDeps', {});
}

export async function stopCollectingFileDeps(file: string) {
  if (!loaderChannel)
    return;
  await loaderChannel.send('stopCollectingFileDeps', { file });
}

export async function incorporateCompilationCache() {
  if (!loaderChannel)
    return;
  // This is needed to gather dependency information from the esm loader
  // that is populated from the resolve hook. We do not need to push
  // this information proactively during load, but gather it at the end.
  const result = await loaderChannel.send('getCompilationCache', {});
  addToCompilationCache(result.cache);
}

export async function configureESMLoader() {
  if (!loaderChannel)
    return;
  await loaderChannel.send('setSingleTSConfig', { tsconfig: singleTSConfig() });
  await loaderChannel.send('addToCompilationCache', { cache: serializeCompilationCache() });
}

export async function configureESMLoaderTransformConfig() {
  if (!loaderChannel)
    return;
  await loaderChannel.send('setSingleTSConfig', { tsconfig: singleTSConfig() });
  await loaderChannel.send('setTransformConfig', { config: transformConfig() });
}
