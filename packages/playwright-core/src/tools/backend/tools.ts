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

import * as z from 'zod';
import common from './common.js';
import config from './config.js';
import console from './console.js';
import cookies from './cookies.js';
import devtools from './devtools.js';
import dialogs from './dialogs.js';
import evaluate from './evaluate.js';
import files from './files.js';
import form from './form.js';
import keyboard from './keyboard.js';
import mouse from './mouse.js';
import navigate from './navigate.js';
import network from './network.js';
import pdf from './pdf.js';
import route from './route.js';
import runCode from './runCode.js';
import snapshot from './snapshot.js';
import screenshot from './screenshot.js';
import storage from './storage.js';
import tabs from './tabs.js';
import tracing from './tracing.js';
import verify from './verify.js';
import video from './video.js';
import wait from './wait.js';
import webstorage from './webstorage.js';

import type { Tool } from './tool.js';
import type { ContextConfig } from './context.js';

export const browserTools: Tool<any>[] = [
  ...common,
  ...config,
  ...console,
  ...cookies,
  ...devtools,
  ...dialogs,
  ...evaluate,
  ...files,
  ...form,
  ...keyboard,
  ...mouse,
  ...navigate,
  ...network,
  ...pdf,
  ...route,
  ...runCode,
  ...screenshot,
  ...snapshot,
  ...storage,
  ...tabs,
  ...tracing,
  ...verify,
  ...video,
  ...wait,
  ...webstorage,
];

export function filteredTools(config: Pick<ContextConfig, 'capabilities'>) {
  return browserTools.filter(tool => tool.capability.startsWith('core') || config.capabilities?.includes(tool.capability)).filter(tool => !tool.skillOnly).map(tool => ({
    ...tool,
    schema: {
      ...tool.schema,
      // Note: we first ensure that "selector" property is present, so that we can omit() it without an error.
      inputSchema: tool.schema.inputSchema
          .extend({ selector: z.string(), startSelector: z.string(), endSelector: z.string() })
          .omit({ selector: true, startSelector: true, endSelector: true }),
    },
  }));
}
