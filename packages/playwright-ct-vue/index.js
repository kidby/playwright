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

import path from 'path';
import { createRequire } from 'module';
import { test, expect, devices, defineConfig as originalDefineConfig } from '@playwright/experimental-ct-core';

const require = createRequire(import.meta.url);
const __dirname = import.meta.dirname;

export const defineConfig = (config, ...configs) => {
  return originalDefineConfig({
    ...config,
    '@playwright/test': {
      packageJSON: require.resolve('./package.json'),
    },
    '@playwright/experimental-ct-core': {
      registerSourceFile: path.join(__dirname, 'registerSource.mjs'),
      frameworkPluginFactory: () => import('@vitejs/plugin-vue').then(plugin => plugin.default()),
    },
  }, ...configs);
};

export { test, expect, devices };
