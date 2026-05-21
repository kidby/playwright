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

const IOS_ROLE_MAP: Record<string, string> = {
  XCUIElementTypeButton: 'button',
  XCUIElementTypeTextField: 'textbox',
  XCUIElementTypeSecureTextField: 'textbox',
  XCUIElementTypeTextView: 'textbox',
  XCUIElementTypeStaticText: 'text',
  XCUIElementTypeImage: 'img',
  XCUIElementTypeSwitch: 'switch',
  XCUIElementTypeSlider: 'slider',
  XCUIElementTypeCell: 'listitem',
  XCUIElementTypeTable: 'list',
  XCUIElementTypeCollectionView: 'list',
  XCUIElementTypeWebView: 'webview',
  XCUIElementTypeAlert: 'alertdialog',
  XCUIElementTypeToolbar: 'toolbar',
  XCUIElementTypeNavigationBar: 'navigation',
  XCUIElementTypeLink: 'link',
  XCUIElementTypeSearchField: 'searchbox',
};

const ANDROID_ROLE_MAP: Record<string, string> = {
  'android.widget.Button': 'button',
  'android.widget.ImageButton': 'button',
  'android.widget.EditText': 'textbox',
  'android.widget.TextView': 'text',
  'android.widget.ImageView': 'img',
  'android.widget.Switch': 'switch',
  'android.widget.SeekBar': 'slider',
  'android.widget.ListView': 'list',
  'android.widget.GridView': 'list',
  'androidx.recyclerview.widget.RecyclerView': 'list',
  'android.webkit.WebView': 'webview',
  'androidx.appcompat.widget.Toolbar': 'toolbar',
  'android.widget.CheckBox': 'checkbox',
  'android.widget.RadioButton': 'radio',
};

const INTERACTABLE_ROLES = new Set(['button', 'textbox', 'link', 'switch', 'checkbox', 'radio', 'slider', 'searchbox']);

export type AccessibilityNode = {
  role: string;
  name?: string;
  ref?: string;
  children?: AccessibilityNode[];
};

export function parsePageSource(pageSource: string, platform: 'iOS' | 'Android'): AccessibilityNode[] {
  const roleMap = platform === 'iOS' ? IOS_ROLE_MAP : ANDROID_ROLE_MAP;
  const tokens = tokenize(pageSource);
  const refState = { counter: 0 };
  const { nodes } = parseChildren(tokens, 0, roleMap, refState);
  return nodes;
}

export function convertPageSourceToSnapshot(pageSource: string, platform: 'iOS' | 'Android'): string {
  const tree = parsePageSource(pageSource, platform);
  return renderYaml(tree, 0);
}

type Token =
  | { kind: 'open'; tag: string; attrs: Record<string, string>; selfClose: boolean }
  | { kind: 'close'; tag: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const tagRe = /<\/?([A-Za-z_][A-Za-z0-9_.-]*)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(source)) !== null) {
    const full = m[0];
    const tag = m[1];
    const rest = m[2];
    if (full.startsWith('</')) {
      tokens.push({ kind: 'close', tag });
      continue;
    }
    const selfClose = full.endsWith('/>');
    tokens.push({ kind: 'open', tag, attrs: parseAttrs(rest), selfClose });
  }
  return tokens;
}

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null)
    out[m[1]] = decodeEntities(m[2]);
  return out;
}

function decodeEntities(s: string): string {
  return s
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
}

function parseChildren(tokens: Token[], start: number, roleMap: Record<string, string>, refState: { counter: number }): { nodes: AccessibilityNode[]; next: number } {
  const nodes: AccessibilityNode[] = [];
  let i = start;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.kind === 'close')
      return { nodes, next: i + 1 };
    if (tok.kind !== 'open') {
      i++;
      continue;
    }
    const role = roleMap[tok.tag] ?? defaultRole(tok.tag);
    const name = nameFromAttrs(tok.attrs);
    const node: AccessibilityNode = { role };
    if (name)
      node.name = name;
    if (isInteractable(role, tok.attrs))
      node.ref = `m${++refState.counter}`;
    if (tok.selfClose) {
      nodes.push(node);
      i++;
      continue;
    }
    const inner = parseChildren(tokens, i + 1, roleMap, refState);
    if (inner.nodes.length)
      node.children = inner.nodes;
    nodes.push(node);
    i = inner.next;
  }
  return { nodes, next: i };
}

function defaultRole(tag: string): string {
  if (tag === 'hierarchy' || tag === 'AppiumAUT')
    return 'root';
  return 'generic';
}

function nameFromAttrs(attrs: Record<string, string>): string | undefined {
  return attrs.label || attrs.name || attrs.value || attrs['content-desc'] || attrs.text || undefined;
}

function isInteractable(role: string, attrs: Record<string, string>): boolean {
  if (INTERACTABLE_ROLES.has(role))
    return true;
  if (attrs.clickable === 'true' || attrs.enabled === 'true' && attrs.value)
    return true;
  return false;
}

function renderYaml(nodes: AccessibilityNode[], depth: number): string {
  const lines: string[] = [];
  for (const n of nodes) {
    lines.push(renderNode(n, depth));
    if (n.children?.length)
      lines.push(renderYaml(n.children, depth + 1));
  }
  return lines.filter(Boolean).join('\n');
}

function renderNode(n: AccessibilityNode, depth: number): string {
  const indent = '  '.repeat(depth);
  const parts = [`- ${n.role}`];
  if (n.name)
    parts.push(quote(n.name));
  if (n.ref)
    parts.push(`[ref=${n.ref}]`);
  return `${indent}${parts.join(' ')}`;
}

function quote(s: string): string {
  if (/^[A-Za-z0-9 .,!?@#:_/-]+$/.test(s))
    return `"${s}"`;
  return JSON.stringify(s);
}
