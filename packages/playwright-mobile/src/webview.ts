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

import type { AppiumClient } from './appiumClient';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLL_MS = 500;

export const NATIVE_APP_CONTEXT = 'NATIVE_APP';

export type WebViewContextDescriptor = {
  id: string;
  title?: string;
  url?: string;
  packageOrBundleId?: string;
  attached?: boolean;
  visible?: boolean;
  empty?: boolean;
};

export type WebViewSelector = {
  title?: string | RegExp;
  url?: string | RegExp;
  packageOrBundleId?: string;
  timeoutMs?: number;
  pollMs?: number;
};

type IosContext = {
  id: string;
  title?: string;
  url?: string;
  bundleId?: string;
};

type AndroidPage = {
  id?: string;
  title?: string;
  url?: string;
  attached?: boolean;
  visible?: boolean;
  empty?: boolean;
};

type AndroidContext = {
  webviewName?: string;
  info?: { packageName?: string };
  pages?: AndroidPage[];
};

export async function listWebViewContexts(client: AppiumClient): Promise<WebViewContextDescriptor[]> {
  const platform = client.capabilities?.platformName;
  const raw = await client.executeScript<unknown>('mobile: getContexts', []);
  if (platform === 'iOS')
    return normalizeIosContexts(raw);
  if (platform === 'Android')
    return normalizeAndroidContexts(raw);
  return [];
}

export async function waitForWebViewContext(client: AppiumClient, sel: WebViewSelector): Promise<WebViewContextDescriptor> {
  const timeout = sel.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const poll = sel.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + timeout;
  let lastSeen: WebViewContextDescriptor[] = [];
  while (Date.now() < deadline) {
    lastSeen = await listWebViewContexts(client);
    const match = lastSeen.find(c => matches(c, sel));
    if (match)
      return match;
    await sleep(poll);
  }
  throw new Error(`waitForWebViewContext: no context matched ${describe(sel)} within ${timeout}ms (last seen: ${JSON.stringify(lastSeen)})`);
}

export async function switchToWebViewContext(client: AppiumClient, sel: WebViewSelector): Promise<WebViewContextDescriptor> {
  const target = await waitForWebViewContext(client, sel);
  await client.setContext(target.id);
  return target;
}

function matches(c: WebViewContextDescriptor, sel: WebViewSelector): boolean {
  if (c.id === NATIVE_APP_CONTEXT)
    return false;
  if (sel.packageOrBundleId && c.packageOrBundleId !== sel.packageOrBundleId)
    return false;
  if (sel.title !== undefined && !textMatches(c.title, sel.title))
    return false;
  if (sel.url !== undefined && !textMatches(c.url, sel.url))
    return false;
  if (c.attached === false || c.visible === false || c.empty === true)
    return false;
  return true;
}

function textMatches(value: string | undefined, pattern: string | RegExp): boolean {
  if (value === undefined)
    return false;
  if (pattern instanceof RegExp)
    return pattern.test(value);
  return value.includes(pattern);
}

function normalizeIosContexts(raw: unknown): WebViewContextDescriptor[] {
  if (!Array.isArray(raw))
    return [];
  const out: WebViewContextDescriptor[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      out.push({ id: entry });
      continue;
    }
    if (entry && typeof entry === 'object') {
      const e = entry as IosContext;
      out.push({
        id: e.id,
        title: e.title,
        url: e.url,
        packageOrBundleId: e.bundleId,
      });
    }
  }
  return out;
}

function normalizeAndroidContexts(raw: unknown): WebViewContextDescriptor[] {
  if (!Array.isArray(raw))
    return [];
  const out: WebViewContextDescriptor[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      out.push({ id: entry });
      continue;
    }
    if (!entry || typeof entry !== 'object')
      continue;
    const ctx = entry as AndroidContext;
    const pkg = ctx.info?.packageName;
    const webviewName = ctx.webviewName ?? (pkg ? `WEBVIEW_${pkg}` : undefined);
    if (!ctx.pages || ctx.pages.length === 0) {
      if (webviewName)
        out.push({ id: webviewName, packageOrBundleId: pkg });
      continue;
    }
    for (const page of ctx.pages) {
      if (!page.id)
        continue;
      const id = webviewName ? `${webviewName}/${page.id}` : page.id;
      out.push({
        id,
        title: page.title,
        url: page.url,
        packageOrBundleId: pkg,
        attached: page.attached,
        visible: page.visible,
        empty: page.empty,
      });
    }
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function describe(sel: WebViewSelector): string {
  const parts: string[] = [];
  if (sel.title !== undefined)
    parts.push(`title=${sel.title instanceof RegExp ? sel.title.toString() : JSON.stringify(sel.title)}`);
  if (sel.url !== undefined)
    parts.push(`url=${sel.url instanceof RegExp ? sel.url.toString() : JSON.stringify(sel.url)}`);
  if (sel.packageOrBundleId)
    parts.push(`packageOrBundleId=${sel.packageOrBundleId}`);
  return parts.length ? `{${parts.join(', ')}}` : '{}';
}
