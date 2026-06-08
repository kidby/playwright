/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
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

// Runtime availability checks. These let real-device specs skip themselves
// when the required emulator / simulator / Appium server isn't present,
// rather than failing the whole run. Each check is cached per process so
// repeated calls are cheap.

import { spawnSync } from 'node:child_process';

export const APPIUM_URL = process.env.APPIUM_URL || 'http://127.0.0.1:4723';
export const MOBILE_E2E_OPT_IN = process.env.MOBILE_E2E === '1';

let _appiumChecked = false;
let _appiumReady = false;
let _androidChecked = false;
let _androidUdid: string | undefined;
let _iosChecked = false;
let _iosUdid: string | undefined;

export async function isAppiumReachable(): Promise<boolean> {
  if (_appiumChecked)
    return _appiumReady;
  _appiumChecked = true;
  try {
    const res = await fetch(`${APPIUM_URL}/status`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok)
      return (_appiumReady = false);
    const body = await res.json() as { value?: { ready?: boolean } };
    _appiumReady = body.value?.ready === true;
  } catch {
    _appiumReady = false;
  }
  return _appiumReady;
}

export function allBootedAndroidUdids(): string[] {
  try {
    const out = spawnSync('adb', ['devices'], { encoding: 'utf-8', timeout: 5000 });
    if (out.status !== 0)
      return [];
    return out.stdout.split('\n').slice(1)
        .map(line => line.match(/^(\S+)\s+device\b/)?.[1])
        .filter((u): u is string => !!u);
  } catch { return []; }
}

export function bootedAndroidUdid(): string | undefined {
  if (_androidChecked)
    return _androidUdid;
  _androidChecked = true;
  try {
    const out = spawnSync('adb', ['devices'], { encoding: 'utf-8', timeout: 5000 });
    if (out.status !== 0)
      return undefined;
    // Each line after the header: "<udid>\tdevice"
    const lines = out.stdout.split('\n').slice(1);
    for (const line of lines) {
      const m = line.match(/^(\S+)\s+device\b/);
      if (m) {
        _androidUdid = m[1];
        return _androidUdid;
      }
    }
  } catch { /* adb unavailable */ }
  return undefined;
}

export function bootedIosUdid(): string | undefined {
  if (_iosChecked)
    return _iosUdid;
  _iosChecked = true;
  try {
    const out = spawnSync('xcrun', ['simctl', 'list', 'devices', 'booted', '--json'], { encoding: 'utf-8', timeout: 5000 });
    if (out.status !== 0)
      return undefined;
    const data = JSON.parse(out.stdout) as { devices: Record<string, Array<{ udid: string; state: string }>> };
    for (const runtime of Object.values(data.devices)) {
      for (const dev of runtime) {
        if (dev.state === 'Booted') {
          _iosUdid = dev.udid;
          return _iosUdid;
        }
      }
    }
  } catch { /* xcrun unavailable */ }
  return undefined;
}

/** Returns the reason to skip, or undefined if the test can run on Android. */
export async function shouldSkipAndroid(): Promise<string | undefined> {
  if (!MOBILE_E2E_OPT_IN)
    return 'set MOBILE_E2E=1 to run real-device integration tests';
  if (!(await isAppiumReachable()))
    return `Appium not reachable at ${APPIUM_URL}`;
  if (!bootedAndroidUdid())
    return 'no booted Android emulator (start one with: $ANDROID_HOME/emulator/emulator -avd <name>)';
  return undefined;
}

/** Returns the reason to skip, or undefined if the test can run on iOS. */
export async function shouldSkipIos(): Promise<string | undefined> {
  if (!MOBILE_E2E_OPT_IN)
    return 'set MOBILE_E2E=1 to run real-device integration tests';
  if (process.platform !== 'darwin')
    return 'iOS sim only runs on macOS';
  if (!(await isAppiumReachable()))
    return `Appium not reachable at ${APPIUM_URL}`;
  if (!bootedIosUdid())
    return 'no booted iOS simulator (boot one with: xcrun simctl boot <udid>)';
  return undefined;
}
