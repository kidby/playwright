/**
 * Copyright Microsoft Corporation. All rights reserved.
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

import { spawnAsync } from '@utils/spawnAsync';

export type SimulatorInfo = {
  udid: string;
  name: string;
  osVersion: string;
  state: string;
  isAvailable: boolean;
};

type SimctlDevice = {
  udid: string;
  name: string;
  state: string;
  isAvailable: boolean;
};

type SimctlResponse = {
  devices: Record<string, SimctlDevice[]>;
};

export async function listBootedSimulators(): Promise<SimulatorInfo[]> {
  if (process.platform !== 'darwin')
    return [];
  try {
    const { code, stdout } = await spawnAsync('xcrun', ['simctl', 'list', '-j', 'devices', 'booted'], { stdio: 'pipe' });
    if (code !== 0)
      return [];
    const parsed = JSON.parse(stdout) as SimctlResponse;
    const result: SimulatorInfo[] = [];
    for (const [runtimeKey, devices] of Object.entries(parsed.devices ?? {})) {
      const osVersion = parseOsVersionFromRuntime(runtimeKey);
      for (const d of devices) {
        if (d.state !== 'Booted')
          continue;
        result.push({
          udid: d.udid,
          name: d.name,
          osVersion,
          state: d.state,
          isAvailable: d.isAvailable,
        });
      }
    }
    return result;
  } catch {
    return [];
  }
}

function parseOsVersionFromRuntime(runtimeKey: string): string {
  const match = /iOS-([\d-]+)$/.exec(runtimeKey);
  if (!match)
    return '';
  return match[1].replace(/-/g, '.');
}
