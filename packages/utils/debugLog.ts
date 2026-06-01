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

// `debug`-compatible facade. Preserves the long-standing `DEBUG=pw:*` env var
// while also honoring `NODE_DEBUG` so users on Node-native conventions get the
// same output. Lets us drop the `debug` npm package — which previously broke
// the runner bundle via `require('tty')` in its CJS source.
//
// Surface intentionally matches the subset of the `debug` API actually used in
// this repo: `debug(ns)` returns a logger; `debug.enabled(ns)` is a sniff
// helper; `debug.log` is a mutable sink that consumers swap to redirect
// output (used by testServer to mirror DEBUG output into the test transcript).

import { format } from 'util';

export type IDebugger = ((...args: unknown[]) => void) & { enabled: boolean; namespace: string };

const patterns: RegExp[] = parsePatterns(process.env.DEBUG ?? process.env.NODE_DEBUG ?? '');

function parsePatterns(spec: string): RegExp[] {
  if (!spec)
    return [];
  return spec.split(/[\s,]+/).filter(Boolean).map(p => {
    const escaped = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
  });
}

function isEnabled(namespace: string): boolean {
  for (const re of patterns) {
    if (re.test(namespace))
      return true;
  }
  return false;
}

type Debug = ((namespace: string) => IDebugger) & {
  log: (...args: unknown[]) => void;
  enabled: (namespace: string) => boolean;
};

const debug = ((namespace: string): IDebugger => {
  const enabled = isEnabled(namespace);
  if (!enabled) {
    const fn = Object.assign(() => {}, { enabled: false, namespace }) as IDebugger;
    return fn;
  }
  const fn = ((...args: unknown[]) => {
    debug.log(`  ${namespace} ${format(...args)}`);
  }) as IDebugger;
  fn.enabled = true;
  fn.namespace = namespace;
  return fn;
}) as Debug;

debug.log = (...args: unknown[]): void => {
  process.stderr.write(format(...args) + '\n');
};

debug.enabled = isEnabled;

export default debug;
