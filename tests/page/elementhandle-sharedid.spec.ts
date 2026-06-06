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

import { test as it, expect } from './pageTest';

it('should cache sharedId on creation and reuse it without network calls', async ({ page, toImpl, isBidi }) => {
  it.skip(!isBidi, 'Only applicable for BiDi');
  await page.setContent('<div id="test">Hello</div>');
  const handle = await page.$('#test');
  expect(handle).toBeTruthy();
  const handleImpl = toImpl(handle);

  // 1. Verify that the cache is immediately populated upon creation (no need to query nodeIdForElementHandle first)
  const originalSharedId = handleImpl._bidiSharedId;
  expect(originalSharedId).toBeTruthy();

  // Spy on _remoteValueForReference in the context
  const contextImpl = handleImpl._context.delegate as any;
  let callCount = 0;
  const originalMethod = contextImpl._remoteValueForReference;
  contextImpl._remoteValueForReference = function(...args: any[]) {
    callCount++;
    return originalMethod.apply(this, args);
  };

  // 2. Perform an action that requests the nodeId (e.g. adoptElementHandle or call the method directly)
  const sharedRef = await contextImpl.nodeIdForElementHandle(handleImpl);
  expect(sharedRef.sharedId).toBe(originalSharedId);

  // Verify no network call was made (callCount is 0 because of cache hit)
  expect(callCount).toBe(0);

  // 3. Clear the cached ID to force a cache miss
  handleImpl._bidiSharedId = undefined;

  // Retrieve nodeId again
  const newSharedRef = await contextImpl.nodeIdForElementHandle(handleImpl);
  expect(newSharedRef.sharedId).toBe(originalSharedId);

  // Verify that a network call WAS made now (callCount is 1)
  expect(callCount).toBe(1);

  // Verify that the cache got repopulated
  expect(handleImpl._bidiSharedId).toBe(originalSharedId);

  // Clean up spy
  contextImpl._remoteValueForReference = originalMethod;
});

it('should preserve and reuse cached sharedId when resolving the same element multiple times', async ({ page, toImpl, isBidi }) => {
  it.skip(!isBidi, 'Only applicable for BiDi');
  await page.setContent('<div id="test">Hello</div>');
  
  // Resolve the element multiple times
  const handle1 = await page.$('#test');
  const handle2 = await page.$('#test');
  expect(handle1).toBeTruthy();
  expect(handle2).toBeTruthy();
  
  const impl1 = toImpl(handle1);
  const impl2 = toImpl(handle2);

  // Both should have the same _bidiSharedId populated immediately
  expect(impl1._bidiSharedId).toBeTruthy();
  expect(impl2._bidiSharedId).toBe(impl1._bidiSharedId);
  
  // They are different JSHandle objects but share the same underlying sharedId
  expect(impl1).not.toBe(impl2);
});

it('should handle elements created dynamically during evaluation', async ({ page, toImpl, isBidi }) => {
  it.skip(!isBidi, 'Only applicable for BiDi');
  const handle = await page.evaluateHandle(() => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    return div;
  });
  
  const handleImpl = toImpl(handle.asElement());
  expect(handleImpl).toBeTruthy();
  expect(handleImpl._bidiSharedId).toBeTruthy();
});
