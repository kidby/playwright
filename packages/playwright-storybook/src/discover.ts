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

import type { DiscoveryOptions, StoryEntry, StoryIndex } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchStoryIndex(url: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<StoryIndex> {
  const indexUrl = new URL('/index.json', url.endsWith('/') ? url : url + '/');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(indexUrl, { signal: controller.signal });
    if (!response.ok)
      throw new Error(`Storybook index.json: ${response.status} ${response.statusText}`);
    return await response.json() as StoryIndex;
  } finally {
    clearTimeout(timer);
  }
}

export function filterStories(index: StoryIndex, options: DiscoveryOptions): StoryEntry[] {
  const includes = toArray(options.include);
  const excludes = toArray(options.exclude);
  const requiredTags = options.tags?.include ?? [];
  const forbiddenTags = options.tags?.exclude ?? [];

  const results: StoryEntry[] = [];
  for (const entry of Object.values(index.entries ?? {})) {
    if (entry.type !== 'story')
      continue;
    const tags = entry.tags ?? [];
    if (requiredTags.length && !requiredTags.every(t => tags.includes(t)))
      continue;
    if (forbiddenTags.length && forbiddenTags.some(t => tags.includes(t)))
      continue;
    if (includes.length && !includes.some(pattern => matchesGlob(pattern, entry.title)))
      continue;
    if (excludes.length && excludes.some(pattern => matchesGlob(pattern, entry.title)))
      continue;
    results.push(entry);
  }
  return results;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined)
    return [];
  return Array.isArray(value) ? value : [value];
}

function matchesGlob(pattern: string, value: string): boolean {
  const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

export function iframeUrl(baseUrl: string, storyId: string): string {
  const root = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  return new URL(`iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`, root).toString();
}
