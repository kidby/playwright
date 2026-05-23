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

import { transformSync as oxcTransformSync } from 'oxc-transform';

export type OxcTransformResult = { code: string; map?: { version: number; sources: string[]; mappings: string; names: string[] } } | null;

export type OxcTransformFunction = (code: string, filename: string, jsxImportSource?: string) => OxcTransformResult;

function isTypeScript(filename: string): boolean {
  return filename.endsWith('.ts') || filename.endsWith('.tsx') || filename.endsWith('.mts') || filename.endsWith('.cts');
}

function isJSX(filename: string): boolean {
  return filename.endsWith('.tsx') || filename.endsWith('.jsx');
}

export const oxcTransform: OxcTransformFunction = (code, filename, jsxImportSource) => {
  const lang: 'ts' | 'tsx' | 'js' | 'jsx' = isTypeScript(filename)
    ? (isJSX(filename) ? 'tsx' : 'ts')
    : (isJSX(filename) ? 'jsx' : 'js');

  const result = oxcTransformSync(filename, code, {
    lang,
    sourceType: 'module',
    sourcemap: true,
    typescript: {
      onlyRemoveTypeImports: false,
      allowNamespaces: true,
    },
    jsx: {
      runtime: 'automatic',
      throwIfNamespace: false,
      ...(jsxImportSource ? { importSource: jsxImportSource } : {}),
    },
  });

  if (result.errors && result.errors.length) {
    const err = result.errors[0];
    throw new Error(`${filename}: ${err.message}${err.codeframe ? '\n' + err.codeframe : ''}`);
  }

  return {
    code: result.code,
    map: result.map as any,
  };
};
