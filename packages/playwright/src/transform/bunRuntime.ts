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

// Bun-runtime utilities. Bun's native loader handles `.ts`/`.tsx` (including
// `import type` stripping) on its worker threadpool; the fork's transform
// pipeline early-returns under Bun (see `transform.ts:installTransformIfNeeded`
// and `:registerESMLoader`). Previously this module also registered a Bun
// plugin to redirect `playwright(-core)/lib/*` specifiers; bench probes
// (June 2026) showed Bun's default workspace resolver handles those paths
// without our hook ever firing, so the plugin was removed as dead overhead.

type BunGlobal = {
  pathToFileURL(path: string): URL;
};
declare const Bun: BunGlobal | undefined;

export function isBun(): boolean {
  return !!process.versions.bun;
}

export async function importUnderBun(file: string): Promise<unknown> {
  const fileUrl = Bun!.pathToFileURL(file).toString();
  return await import(fileUrl);
}
