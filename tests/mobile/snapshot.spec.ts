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

import fs from 'fs';
import path from 'path';

import { test, expect } from '@playwright/test';

import { convertPageSourceToSnapshot, parsePageSource } from '../../packages/playwright-mobile/src/snapshot.js';
import { NativeDevice, iosCapabilities } from '../../packages/playwright-mobile/src/index.js';
import { startMockAppium } from './mockAppium.js';

import type { MockAppium } from './mockAppium.js';

const iosFixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'ios-page-source.xml'), 'utf-8');
const androidFixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'android-page-source.xml'), 'utf-8');

test('iOS: maps XCUIElement* tags to semantic roles', () => {
  const tree = parsePageSource(iosFixture, 'iOS');
  const roles = collectRoles(tree);
  expect(roles).toContain('button');
  expect(roles).toContain('textbox');
  expect(roles).toContain('text');
  expect(roles).toContain('switch');
  expect(roles).toContain('navigation');
});

test('Android: maps android.* tags to semantic roles', () => {
  const tree = parsePageSource(androidFixture, 'Android');
  const roles = collectRoles(tree);
  expect(roles).toContain('button');
  expect(roles).toContain('textbox');
  expect(roles).toContain('text');
  expect(roles).toContain('checkbox');
  expect(roles).toContain('toolbar');
});

test('refs are assigned in doc order to interactable elements', () => {
  const tree = parsePageSource(iosFixture, 'iOS');
  const refs = collectRefs(tree);
  expect(refs.length).toBeGreaterThan(0);
  expect(refs[0]).toBe('m1');
  expect(refs[refs.length - 1]).toMatch(/^m\d+$/);
});

test('non-interactable elements (text) have no ref', () => {
  const tree = parsePageSource(androidFixture, 'Android');
  const textNodes = collectByRole(tree, 'text');
  for (const t of textNodes)
    expect(t.ref).toBeUndefined();
});

test('YAML output contains role + name + ref tokens', () => {
  const yaml = convertPageSourceToSnapshot(iosFixture, 'iOS');
  expect(yaml).toContain('- button');
  expect(yaml).toContain('"Sign In"');
  expect(yaml).toContain('[ref=m');
});

test('YAML nesting reflects parent/child depth', () => {
  const yaml = convertPageSourceToSnapshot(androidFixture, 'Android');
  const lines = yaml.split('\n');
  const toolbarLine = lines.find(l => l.includes('- toolbar'));
  const textInsideToolbar = lines.find(l => l.includes('- text "Sign in"'));
  expect(toolbarLine).toBeDefined();
  expect(textInsideToolbar).toBeDefined();
  // Text inside toolbar must be deeper-indented than the toolbar itself.
  const toolbarIndent = toolbarLine!.match(/^ */)![0].length;
  const textIndent = textInsideToolbar!.match(/^ */)![0].length;
  expect(textIndent).toBeGreaterThan(toolbarIndent);
});

let mock: MockAppium;
test.beforeEach(async () => { mock = await startMockAppium(); });
test.afterEach(async () => { await mock.close(); });

test('device.pageSource() fetches /source and device.snapshot() converts', async () => {
  mock.setResponder(req => {
    if (req.method === 'GET' && req.path.endsWith('/source'))
      return { body: { value: iosFixture } };
  });
  const device = await NativeDevice.start(mock.url, iosCapabilities({ bundleId: 'com.example.app' }));
  expect(await device.pageSource()).toContain('XCUIElementTypeButton');
  const yaml = await device.snapshot();
  expect(yaml).toContain('- button');
  await device.stop();
});

function collectRoles(nodes: ReturnType<typeof parsePageSource>): string[] {
  const out: string[] = [];
  const walk = (ns: typeof nodes) => {
    for (const n of ns) {
      out.push(n.role);
      if (n.children)
        walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function collectRefs(nodes: ReturnType<typeof parsePageSource>): string[] {
  const out: string[] = [];
  const walk = (ns: typeof nodes) => {
    for (const n of ns) {
      if (n.ref)
        out.push(n.ref);
      if (n.children)
        walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

function collectByRole(nodes: ReturnType<typeof parsePageSource>, role: string): ReturnType<typeof parsePageSource> {
  const out: ReturnType<typeof parsePageSource> = [];
  const walk = (ns: typeof nodes) => {
    for (const n of ns) {
      if (n.role === role)
        out.push(n);
      if (n.children)
        walk(n.children);
    }
  };
  walk(nodes);
  return out;
}
