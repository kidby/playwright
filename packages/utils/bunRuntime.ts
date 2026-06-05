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

// Shared Bun-detection helpers. The fork uses Bun-native APIs in a few hot
// paths (SHA hashing, gzip, WebSocket transport) when running under Bun.
// The idiomatic detection — what Bun's own docs recommend for code that
// then calls into the `Bun.*` namespace — is to gate on the global being
// present + having a `version`, rather than checking `process.versions.bun`.
// Functionally equivalent, but the global check makes the precondition for
// the upcoming `Bun.*` call explicit at the gate.

type BunNamespace = {
  version: string;
  CryptoHasher: new (algo: string) => {
    update(data: ArrayBufferView | string): { digest(format: 'hex'): string };
  };
  gunzipSync(input: ArrayBufferView | string): Uint8Array;
  gzipSync(input: ArrayBufferView | string, options?: { level?: number }): Uint8Array;
  stringWidth(input: string, options?: { countAnsiEscapeCodes?: boolean; ambiguousIsNarrow?: boolean }): number;
  stripANSI(input: string): string;
  // Add more typed surface here as we use it.
};

declare const Bun: BunNamespace | undefined;

// Captured at module load — Bun's global doesn't change at runtime, and
// caching the namespace ref lets call-sites be `if (BUN_NS) BUN_NS.X(...)`
// without re-checking on every call.
const _bunNs: BunNamespace | undefined =
  typeof Bun !== 'undefined' && typeof Bun.version === 'string' ? Bun : undefined;

export function bunRuntime(): BunNamespace | undefined {
  return _bunNs;
}

export function isBunRuntime(): boolean {
  return _bunNs !== undefined;
}
