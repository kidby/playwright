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

import * as babel from '@babel/core';
import traverseFunction from '@babel/traverse';

import type { BabelFileResult, TransformOptions } from '@babel/core';

export { codeFrameColumns } from '@babel/code-frame';
export { declare } from '@babel/helper-plugin-utils';
export { types } from '@babel/core';

// `@babel/traverse@7.x` CJS-interop wraps its default export as
// `{ default: traverseFn, Hub, Scope, ... }` under ESM, so the unwrapped
// default is an object rather than the callable. Reach for the nested
// `.default` when present.
export const traverse: typeof traverseFunction =
    ((traverseFunction as any)?.default ?? traverseFunction) as typeof traverseFunction;

export type { NodePath, PluginObj, types as T } from '@babel/core';
export type { BabelAPI } from '@babel/helper-plugin-utils';

export type BabelPlugin = [string, any?];
export type BabelTransformFunction = (code: string, filename: string, isModule: boolean, pluginsPrefix: BabelPlugin[], pluginsSuffix: BabelPlugin[], jsxImportSource?: string) => BabelFileResult | null;

// Only runs when the user has configured custom babel plugins — oxc handles
// the default path. Needs TS stripping + a JSX transform so user plugins
// operate on a parsed module.
function babelTransformOptions(isTypeScript: boolean, pluginsPrologue: [string, any?][], pluginsEpilogue: [string, any?][], jsxImportSource?: string): TransformOptions {
  return {
    browserslistConfigFile: false,
    babelrc: false,
    configFile: false,
    assumptions: {
      // Without this, babel defines a top level function that
      // breaks playwright evaluates.
      setPublicClassFields: true,
    },
    presets: isTypeScript ? [
      [require('@babel/preset-typescript'), { onlyRemoveTypeImports: false }],
    ] : [],
    plugins: [
      ...pluginsPrologue.map(([name, options]) => [require(name), options]),
      [require('@babel/plugin-transform-react-jsx'), {
        throwIfNamespace: false,
        runtime: 'automatic',
        ...(jsxImportSource ? { importSource: jsxImportSource } : {}),
      }],
      ...pluginsEpilogue.map(([name, options]) => [require(name), options]),
    ],
    compact: false,
    sourceMaps: 'both',
  };
}

let isTransforming = false;

function isTypeScript(filename: string) {
  return filename.endsWith('.ts') || filename.endsWith('.tsx') || filename.endsWith('.mts') || filename.endsWith('.cts');
}

export function babelTransform(code: string, filename: string, _isModule: boolean, pluginsPrologue: [string, any?][], pluginsEpilogue: [string, any?][], jsxImportSource?: string): BabelFileResult | null {
  if (isTransforming)
    return null;

  // Prevent reentry while requiring plugins lazily.
  isTransforming = true;
  try {
    const options = babelTransformOptions(isTypeScript(filename), pluginsPrologue, pluginsEpilogue, jsxImportSource);
    return babel.transform(code, { filename, ...options });
  } finally {
    isTransforming = false;
  }
}

export function babelParse(code: string, filename: string): babel.ParseResult {
  const options = babelTransformOptions(isTypeScript(filename), [], []);
  return babel.parse(code, { filename, ...options })!;
}
