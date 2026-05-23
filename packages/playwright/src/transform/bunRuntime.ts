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

import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';

type BunPluginLoader = 'js' | 'jsx' | 'ts' | 'tsx';
type BunOnLoadResult = { contents: string; loader?: BunPluginLoader } | undefined;
type BunOnResolveResult = { path: string; namespace?: string } | undefined;
type BunPluginBuilder = {
  onLoad(
    filter: { filter: RegExp; namespace?: string },
    callback: (args: { path: string }) => BunOnLoadResult,
  ): void;
  onResolve(
    filter: { filter: RegExp; namespace?: string },
    callback: (args: { path: string; importer: string }) => BunOnResolveResult,
  ): void;
};
type BunGlobal = {
  plugin(plugin: { name: string; setup: (build: BunPluginBuilder) => void }): void;
  pathToFileURL(path: string): URL;
};
declare const Bun: BunGlobal | undefined;

export function isBun(): boolean {
  return !!process.versions.bun;
}

let installed = false;

export function installBunRuntime(): void {
  if (!isBun() || installed)
    return;
  installed = true;
  Bun!.plugin({
    name: 'playwright-bun-runtime',
    setup(build) {
      build.onResolve({ filter: /^playwright(-core)?\/lib\// }, args => resolvePackageLib(args.path, args.importer));
      build.onLoad({ filter: /\.tsx?$/ }, args => {
        let source: string;
        try {
          source = fs.readFileSync(args.path, 'utf-8');
        } catch {
          return undefined;
        }
        const loader: BunPluginLoader = args.path.endsWith('.tsx') ? 'tsx' : 'ts';
        return { contents: stripTypeImports(source), loader };
      });
    },
  });
}

const packageRootCache = new Map<string, string | null>();

function resolvePackageLib(specifier: string, importer: string): BunOnResolveResult {
  const match = specifier.match(/^(playwright(?:-core)?)\/(lib\/.+?)(?:\.js)?$/);
  if (!match)
    return undefined;
  const [, pkgName, libPath] = match;
  let pkgRoot = packageRootCache.get(pkgName);
  if (pkgRoot === undefined) {
    try {
      const req = createRequire(importer || __filename);
      pkgRoot = path.dirname(req.resolve(`${pkgName}/package.json`));
    } catch {
      pkgRoot = null;
    }
    packageRootCache.set(pkgName, pkgRoot);
  }
  if (!pkgRoot)
    return undefined;
  const resolved = path.join(pkgRoot, `${libPath}.js`);
  if (!fs.existsSync(resolved))
    return undefined;
  return { path: resolved };
}

export function stripTypeImports(source: string): string {
  if (!source.includes('type'))
    return source;
  return source
      .replace(/\bimport\s+type\s*\{[\s\S]*?\}\s*from\s*['"][^'"]+['"]\s*;?/g, '')
      .replace(/\bimport\s+type\s+\w+\s+from\s*['"][^'"]+['"]\s*;?/g, '')
      .replace(/\bimport\s*\{([^}]*)\}\s*from/g, (_match, braced: string) => {
        const kept = braced
            .split(',')
            .map(s => s.trim())
            .filter(s => s && !/^type\s+/.test(s))
            .join(', ');
        return kept ? `import { ${kept} } from` : 'import {} from';
      });
}

export async function importUnderBun(file: string): Promise<unknown> {
  const fileUrl = Bun!.pathToFileURL(file).toString();
  return await import(fileUrl);
}

installBunRuntime();
