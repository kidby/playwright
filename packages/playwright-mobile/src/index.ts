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

export { AppiumClient } from './appiumClient';
export type { AppiumCapabilities, ElementHandle, LocatorStrategy } from './appiumClient';
export { AppLocator } from './appLocator';
export type { LocatorChainPart } from './appLocator';
export { Device } from './device';
export type { AndroidKey } from './device';
export { listWebViewContexts, switchToWebViewContext, waitForWebViewContext } from './webview';
export type { WebViewContextDescriptor, WebViewSelector } from './webview';
export { convertPageSourceToSnapshot, parsePageSource } from './snapshot';
export type { AccessibilityNode } from './snapshot';
export { gestures } from './gestures';
export type { GestureApi, SwipeDirection, SwipeOptions, TapOptions, LongPressOptions, DoubleTapOptions, ScrollToElementOptions, PullToRefreshOptions } from './gestures';
export { androidCapabilities, iosCapabilities } from './capabilities';
export type { AndroidCapabilityOptions, IosCapabilityOptions } from './capabilities';
export { mobileTest, expect } from './mobileTest';
export type { MobileFixtures } from './mobileTest';
