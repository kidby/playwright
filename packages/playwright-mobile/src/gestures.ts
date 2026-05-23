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

import type { AppiumClient } from './appiumClient.js';
import type { AppLocator } from './appLocator.js';

const DEFAULT_SWIPE_DISTANCE = 0.5;
const DEFAULT_SWIPE_DURATION_MS = 800;
const DEFAULT_LONG_PRESS_DURATION_MS = 2000;
const DEFAULT_PULL_DURATION_MS = 5000;
const DEFAULT_PULL_FROM_Y = 0.15;
const DEFAULT_PULL_TO_Y = 0.85;

export type SwipeDirection = 'up' | 'down' | 'left' | 'right';

export type SwipeOptions = {
  direction: SwipeDirection;
  distance?: number;
  durationMs?: number;
  target?: AppLocator;
};

export type TapOptions = {
  target?: AppLocator;
  x?: number;
  y?: number;
};

export type LongPressOptions = {
  target: AppLocator;
  durationMs?: number;
};

export type DoubleTapOptions = {
  target?: AppLocator;
  x?: number;
  y?: number;
};

export type ScrollToElementOptions = {
  target: AppLocator;
  direction?: SwipeDirection;
  percent?: number;
};

export type PullToRefreshOptions = {
  fromYFraction?: number;
  toYFraction?: number;
  durationMs?: number;
};

export type GestureApi = {
  swipe(opts: SwipeOptions): Promise<void>;
  tap(opts: TapOptions): Promise<void>;
  longPress(opts: LongPressOptions): Promise<void>;
  doubleTap(opts: DoubleTapOptions): Promise<void>;
  scrollToElement(opts: ScrollToElementOptions): Promise<void>;
  pullToRefresh(opts?: PullToRefreshOptions): Promise<void>;
};

export function gestures(client: AppiumClient): GestureApi {
  return {
    swipe: opts => swipe(client, opts),
    tap: opts => tap(client, opts),
    longPress: opts => longPress(client, opts),
    doubleTap: opts => doubleTap(client, opts),
    scrollToElement: opts => scrollToElement(client, opts),
    pullToRefresh: opts => pullToRefresh(client, opts ?? {}),
  };
}

async function swipe(client: AppiumClient, opts: SwipeOptions) {
  const platform = client.capabilities?.platformName;
  const distance = opts.distance ?? DEFAULT_SWIPE_DISTANCE;
  const duration = opts.durationMs ?? DEFAULT_SWIPE_DURATION_MS;

  if (platform === 'Android') {
    let area: { left: number; top: number; width: number; height: number };
    if (opts.target) {
      const handle = await opts.target.resolve();
      const rect = await client.executeScript<{ x: number; y: number; width: number; height: number }>(
          'mobile: getElementScreenPosition',
          [{ elementId: handle.ELEMENT }],
      ).catch(() => client.elementRect(handle));
      area = { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
    } else {
      const w = await client.getWindowRect();
      area = { left: 0, top: 0, width: w.width, height: w.height };
    }
    await client.executeScript('mobile: swipeGesture', [{
      left: area.left,
      top: area.top,
      width: Math.round(area.width * distance),
      height: Math.round(area.height * distance),
      direction: opts.direction,
      percent: distance,
      speed: Math.round(area.width / (duration / 1000)),
    }]);
    return;
  }

  if (platform === 'iOS') {
    const args: Record<string, unknown> = { direction: opts.direction };
    if (opts.target) {
      const handle = await opts.target.resolve();
      args.elementId = handle.ELEMENT;
    }
    await client.executeScript('mobile: swipe', [args]);
    return;
  }

  throw new Error(`swipe: unsupported platform ${platform}`);
}

async function tap(client: AppiumClient, opts: TapOptions) {
  if (opts.target) {
    await client.click(await opts.target.resolve());
    return;
  }
  if (typeof opts.x !== 'number' || typeof opts.y !== 'number')
    throw new Error('tap: provide either { target } or both { x, y }.');

  const platform = client.capabilities?.platformName;
  if (platform === 'Android') {
    await client.executeScript('mobile: clickGesture', [{ x: opts.x, y: opts.y }]);
    return;
  }
  if (platform === 'iOS') {
    await client.executeScript('mobile: tap', [{ x: opts.x, y: opts.y }]);
    return;
  }
  throw new Error(`tap: unsupported platform ${platform}`);
}

async function longPress(client: AppiumClient, opts: LongPressOptions) {
  const platform = client.capabilities?.platformName;
  const handle = await opts.target.resolve();
  const ms = opts.durationMs ?? DEFAULT_LONG_PRESS_DURATION_MS;
  if (platform === 'iOS') {
    await client.executeScript('mobile: touchAndHold', [{ elementId: handle.ELEMENT, duration: ms / 1000 }]);
    return;
  }
  if (platform === 'Android') {
    await client.executeScript('mobile: longClickGesture', [{ elementId: handle.ELEMENT, duration: ms }]);
    return;
  }
  throw new Error(`longPress: unsupported platform ${platform}`);
}

async function doubleTap(client: AppiumClient, opts: DoubleTapOptions) {
  const platform = client.capabilities?.platformName;
  if (platform !== 'Android' && platform !== 'iOS')
    throw new Error(`doubleTap: unsupported platform ${platform}`);
  if (!opts.target && (typeof opts.x !== 'number' || typeof opts.y !== 'number'))
    throw new Error('doubleTap: provide either { target } or both { x, y }.');
  const args: Record<string, unknown> = {};
  if (opts.target)
    args.elementId = (await opts.target.resolve()).ELEMENT;
  if (typeof opts.x === 'number')
    args.x = opts.x;
  if (typeof opts.y === 'number')
    args.y = opts.y;
  const command = platform === 'iOS' ? 'mobile: doubleTap' : 'mobile: doubleClickGesture';
  await client.executeScript(command, [args]);
}

async function scrollToElement(client: AppiumClient, opts: ScrollToElementOptions) {
  const platform = client.capabilities?.platformName;
  const handle = await opts.target.resolve();
  if (platform === 'iOS') {
    await client.executeScript('mobile: scrollToElement', [{ elementId: handle.ELEMENT }]);
    return;
  }
  if (platform === 'Android') {
    await client.executeScript('mobile: scrollGesture', [{
      elementId: handle.ELEMENT,
      direction: opts.direction ?? 'down',
      percent: opts.percent ?? 1,
    }]);
    return;
  }
  throw new Error(`scrollToElement: unsupported platform ${platform}`);
}

async function pullToRefresh(client: AppiumClient, opts: PullToRefreshOptions) {
  const platform = client.capabilities?.platformName;
  const fromYFraction = opts.fromYFraction ?? DEFAULT_PULL_FROM_Y;
  const toYFraction = opts.toYFraction ?? DEFAULT_PULL_TO_Y;
  const w = await client.getWindowRect();
  const midX = Math.round(w.width / 2);
  const fromY = Math.round(w.height * fromYFraction);
  const toY = Math.round(w.height * toYFraction);
  const duration = opts.durationMs ?? DEFAULT_PULL_DURATION_MS;

  if (platform === 'iOS') {
    await client.executeScript('mobile: dragFromToForDuration', [{
      duration: duration / 1000,
      fromX: midX,
      fromY,
      toX: midX,
      toY,
    }]);
    return;
  }
  if (platform === 'Android') {
    const distance = Math.abs(toY - fromY);
    const speed = Math.max(1, Math.round(distance / (duration / 1000)));
    await client.executeScript('mobile: dragGesture', [{
      startX: midX,
      startY: fromY,
      endX: midX,
      endY: toY,
      speed,
    }]);
    return;
  }
  throw new Error(`pullToRefresh: unsupported platform ${platform}`);
}
