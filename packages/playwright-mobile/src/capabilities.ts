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

import type { AppiumCapabilities } from './appiumClient';

const DEFAULT_NEW_COMMAND_TIMEOUT_SEC = 240;

export type AndroidCapabilityOptions = {
  app?: string;
  appPackage?: string;
  appActivity?: string;
  deviceName?: string;
  platformVersion?: string;
  udid?: string;
  noReset?: boolean;
  newCommandTimeoutSec?: number;
  extra?: Record<string, unknown>;
};

export function androidCapabilities(opts: AndroidCapabilityOptions = {}): AppiumCapabilities {
  const caps: AppiumCapabilities = {
    'platformName': 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:newCommandTimeout': opts.newCommandTimeoutSec ?? DEFAULT_NEW_COMMAND_TIMEOUT_SEC,
  };
  if (opts.app)
    caps['appium:app'] = opts.app;
  if (opts.appPackage)
    caps['appium:appPackage'] = opts.appPackage;
  if (opts.appActivity)
    caps['appium:appActivity'] = opts.appActivity;
  if (opts.deviceName)
    caps['appium:deviceName'] = opts.deviceName;
  if (opts.platformVersion)
    caps['appium:platformVersion'] = opts.platformVersion;
  if (opts.udid)
    caps['appium:udid'] = opts.udid;
  if (opts.noReset !== undefined)
    caps['appium:noReset'] = opts.noReset;
  if (opts.extra)
    Object.assign(caps, opts.extra);
  return caps;
}

export type IosCapabilityOptions = {
  app?: string;
  bundleId?: string;
  deviceName?: string;
  platformVersion?: string;
  udid?: string;
  noReset?: boolean;
  newCommandTimeoutSec?: number;
  extra?: Record<string, unknown>;
};

export function iosCapabilities(opts: IosCapabilityOptions = {}): AppiumCapabilities {
  const caps: AppiumCapabilities = {
    'platformName': 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:newCommandTimeout': opts.newCommandTimeoutSec ?? DEFAULT_NEW_COMMAND_TIMEOUT_SEC,
  };
  if (opts.app)
    caps['appium:app'] = opts.app;
  if (opts.bundleId)
    caps['appium:bundleId'] = opts.bundleId;
  if (opts.deviceName)
    caps['appium:deviceName'] = opts.deviceName;
  if (opts.platformVersion)
    caps['appium:platformVersion'] = opts.platformVersion;
  if (opts.udid)
    caps['appium:udid'] = opts.udid;
  if (opts.noReset !== undefined)
    caps['appium:noReset'] = opts.noReset;
  if (opts.extra)
    Object.assign(caps, opts.extra);
  return caps;
}
