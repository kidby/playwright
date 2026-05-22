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

type BunFetchModule = { preconnect(url: string): void };
declare const Bun: unknown;

const seenUrls = new Set<string>();

export function preconnect(url: string | undefined): void {
  if (!url || typeof Bun === 'undefined')
    return;
  if (!/^https?:\/\//i.test(url))
    return;
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return;
  }
  if (seenUrls.has(origin))
    return;
  seenUrls.add(origin);
  try {
    const mod = require('bun') as { fetch: BunFetchModule };
    mod.fetch.preconnect(origin);
  } catch {
    // Bun module not available; safe to no-op.
  }
}
