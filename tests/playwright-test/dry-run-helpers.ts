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

// Helpers for reporters that write `[<name>] dry-run payload:\n<json>\n` to
// stderr instead of POSTing to an external service. Lets reporter integration
// tests assert on payload shapes without spinning up a mock HTTP server.

/**
 * Every dry-run payload emitted by `<reporterName>`, in the order they were
 * written. Bracketed reporter names contain `[` which would confuse a naive
 * scan, so we always anchor the JSON parse at the newline after the marker.
 */
export function extractDryRunPayloads(stderr: string, reporterName: string): any[] {
  const marker = `[${reporterName}] dry-run`;
  const payloads: any[] = [];
  let cursor = 0;
  while (cursor < stderr.length) {
    const start = stderr.indexOf(marker, cursor);
    if (start === -1)
      break;
    const payload = readBalanced(stderr, stderr.indexOf('\n', start) + 1);
    if (!payload)
      break;
    payloads.push(JSON.parse(payload.text));
    cursor = payload.end;
  }
  return payloads;
}

/** The most recently emitted dry-run payload from `<reporterName>`. */
export function lastDryRunPayload(stderr: string, reporterName: string): any {
  const all = extractDryRunPayloads(stderr, reporterName);
  if (all.length === 0)
    throw new Error(`No dry-run payload from ${reporterName}. stderr was:\n${stderr}`);
  return all[all.length - 1];
}

// Reads one balanced JSON value ({...} or [...]) starting at or after `from`.
function readBalanced(s: string, from: number): { text: string; end: number } | undefined {
  let i = from;
  while (i < s.length && s[i] !== '{' && s[i] !== '[')
    i++;
  if (i === s.length)
    return undefined;
  const open = s[i];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let end = i;
  for (; end < s.length; end++)
    if (s[end] === open) {depth++;} else if (s[end] === close && --depth === 0) { end++; break; }

  return { text: s.slice(i, end), end };
}
