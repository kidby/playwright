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

export { AppiumClient } from './appiumClient.js';
export type { AppiumCapabilities, ElementHandle, LocatorStrategy } from './appiumClient.js';
export { AppLocator } from './appLocator.js';
export type { LocatorChainPart } from './appLocator.js';
export { Device } from './device.js';
export type { AndroidKey } from './device.js';
export { listWebViewContexts, switchToWebViewContext, waitForWebViewContext, NATIVE_APP_CONTEXT } from './webview.js';
export type { WebViewContextDescriptor, WebViewSelector } from './webview.js';
export { convertPageSourceToSnapshot, parsePageSource } from './snapshot.js';
export type { AccessibilityNode } from './snapshot.js';
export { gestures } from './gestures.js';
export type { GestureApi, SwipeDirection, SwipeOptions, TapOptions, LongPressOptions, DoubleTapOptions, ScrollToElementOptions, PullToRefreshOptions } from './gestures.js';
export { androidCapabilities, iosCapabilities } from './capabilities.js';
export type { AndroidCapabilityOptions, IosCapabilityOptions } from './capabilities.js';
export { mobileTest, expect, captureFailureArtifacts } from './mobileTest.js';
export type { MobileFixtures, AttachableTestInfo } from './mobileTest.js';
