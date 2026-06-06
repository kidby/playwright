/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import child_process from 'child_process';
import path from 'path';

import colors from '@utils/colors';
import debug from '@utils/debugLog';
import { monotonicTime } from '@isomorphic/time';
import { raceAgainstDeadline } from '@isomorphic/timeoutRunner';
import { isURLAvailable } from '@utils/network';
import { launchProcess } from '@utils/processLauncher';

import type { AppiumConfig } from 'playwright/test';

export const DEFAULT_APPIUM_SERVER_URL = 'http://127.0.0.1:4723';
const DEFAULT_TIMEOUT_MS = 60_000;

const debugAppium = debug('pw:appium');

export class AppiumDaemon {
  private _isAvailableCallback?: () => Promise<boolean>;
  private _killProcess?: () => Promise<void>;
  private _processExitedPromise!: Promise<never>;
  private _options: AppiumConfig & { serverUrl: string };
  private _projectName?: string;

  constructor(options: AppiumConfig, projectName?: string) {
    this._options = { ...options, serverUrl: options.serverUrl ?? DEFAULT_APPIUM_SERVER_URL };
    this._projectName = projectName;
  }

  public async start(configDir: string) {
    if (!this._options.autoStart)
      return;
    this._isAvailableCallback = getStatusProbe(this._options.serverUrl);
    this._options.cwd = this._options.cwd ? path.resolve(configDir, this._options.cwd) : configDir;
    try {
      if (this._options.drivers && this._options.drivers.length > 0)
        await this._ensureDrivers(this._options.drivers);


      process.env.PLAYWRIGHT_APPIUM_URL = this._options.serverUrl;

      await this._startProcess();
      await this._waitForProcess();
    } catch (error) {
      await this.teardown();
      throw error;
    }
  }

  public async teardown() {
    debugAppium(`Terminating Appium server`);
    await this._killProcess?.();
    debugAppium(`Terminated Appium server`);
  }

  private async _ensureDrivers(drivers: string[]) {
    const command = this._options.command ?? 'appium';
    const cwd = this._options.cwd;

    // Verify appium is available.
    try {
      child_process.execSync(`${command} --version`, { cwd, encoding: 'utf8', stdio: 'pipe' });
    } catch {
      throw new Error(
        `Appium not found. Install it with:\n  npm install -g appium\nor set appium.command in your config to the path to the appium binary.`
      );
    }

    // Query installed drivers. Appium 2.x outputs JSON in different shapes
    // depending on the version:
    //   - v2.0-v2.1: { driverName: { installed: true, ... }, ... }
    //   - v2.2+:     { installed: { driverName: {...} }, notInstalled: { driverName: {...} } }
    let installedSet: Set<string>;
    try {
      const listOutput = child_process.execSync(
        `${command} driver list --json`,
        { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      const parsed = JSON.parse(listOutput);

      // Handle both JSON shapes.
      if (parsed.installed && typeof parsed.installed === 'object') {
        // v2.2+ format: { installed: { uiautomator2: {...} }, notInstalled: {...} }
        installedSet = new Set(Object.keys(parsed.installed));
      } else {
        // v2.0 format: { uiautomator2: { installed: true }, xcuitest: { installed: false } }
        installedSet = new Set(
          Object.entries(parsed)
            .filter(([, v]: [string, any]) => v?.installed)
            .map(([k]) => k),
        );
      }
    } catch (e) {
      debugAppium(`Warning: could not query installed drivers (${e}). Will attempt to install all requested drivers.`);
      installedSet = new Set();
    }

    // Install missing drivers, isolating errors per-driver.
    for (const driver of drivers) {
      if (installedSet.has(driver)) {
        debugAppium(`Driver already installed: ${driver}`);
        continue;
      }
      debugAppium(`Installing Appium driver: ${driver} ...`);
      try {
        child_process.execSync(
          `${command} driver install ${driver}`,
          { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000 },
        );
        debugAppium(`Driver installed successfully: ${driver}`);
      } catch (e: any) {
        const stderr = e.stderr?.toString() || e.message;
        throw new Error(`Failed to install Appium driver "${driver}": ${stderr}`);
      }
    }
  }

  private async _startProcess(): Promise<void> {
    let processExitedReject = (_: Error) => { };
    this._processExitedPromise = new Promise<never>((_, reject) => { processExitedReject = reject; });
    this._processExitedPromise.catch(() => {});

    const isAlreadyAvailable = await this._isAvailableCallback?.();
    if (isAlreadyAvailable) {
      debugAppium(`Appium server already available at ${this._options.serverUrl}`);
      if (this._options.reuseExistingServer !== false)
        return;
      throw new Error(`${this._options.serverUrl} is already used — set appium.reuseExistingServer:true (default) or free the port.`);
    }

    const command = this._options.command ?? 'appium';
    const args = this._options.args ?? [];
    const fullCommand = args.length ? `${command} ${args.join(' ')}` : command;

    debugAppium(`Starting Appium process: ${fullCommand}`);
    const { launchedProcess, gracefullyClose } = await launchProcess({
      command: fullCommand,
      env: { ...process.env, ...this._options.env },
      cwd: this._options.cwd,
      stdio: 'stdin',
      shell: true,
      attemptToGracefullyClose: async () => {
        if (process.platform === 'win32')
          throw new Error('Graceful shutdown is not supported on Windows');
        if (!this._options.gracefulShutdown)
          throw new Error('skip graceful shutdown');
        const { signal, timeout = 500 } = this._options.gracefulShutdown;
        process.kill(-launchedProcess.pid!, signal);
        return new Promise<void>((resolve, reject) => {
          const timer = timeout
            ? setTimeout(() => reject(new Error(`Appium did not close gracefully within ${timeout}ms`)), timeout)
            : undefined;
          launchedProcess.once('close', () => { clearTimeout(timer); resolve(); });
        });
      },
      log: () => {},
      onExit: code => processExitedReject(new Error(code ? `Appium process exited with code ${code}` : 'Appium process exited early.')),
      tempDirectories: [],
    });
    this._killProcess = gracefullyClose;

    launchedProcess.stdout!.on('data', data => {
      if (debugAppium.enabled || this._options.stdout === 'pipe')
        process.stdout.write(prefixOutputLines(data.toString(), this._projectName) + '\n');
    });
    launchedProcess.stderr!.on('data', data => {
      if (debugAppium.enabled || this._options.stderr !== 'ignore')
        process.stderr.write(prefixOutputLines(data.toString(), this._projectName) + '\n');
    });
  }

  private async _waitForProcess() {
    if (!this._isAvailableCallback) {
      this._processExitedPromise.catch(() => {});
      return;
    }
    debugAppium(`Waiting for Appium /status at ${this._options.serverUrl} ...`);
    const launchTimeout = this._options.timeout || DEFAULT_TIMEOUT_MS;
    const cancellationToken = { canceled: false };
    const deadline = monotonicTime() + launchTimeout;

    const racingPromises: Promise<{ timedOut?: boolean }>[] = [
      this._processExitedPromise.then(() => ({})),
      raceAgainstDeadline(() => waitFor(this._isAvailableCallback!, cancellationToken), deadline),
    ];

    racingPromises.forEach(p => p.catch(() => {}));
    const { timedOut } = await Promise.race(racingPromises);
    cancellationToken.canceled = true;
    if (timedOut)
      throw new Error(`Timed out waiting ${launchTimeout}ms for Appium server at ${this._options.serverUrl}.`);
    debugAppium(`Appium server available`);
  }
}

async function waitFor(probe: () => Promise<boolean>, cancellationToken: { canceled: boolean }) {
  const logScale = [100, 250, 500];
  while (!cancellationToken.canceled) {
    if (await probe())
      return;
    const delay = logScale.shift() || 1000;
    debugAppium(`Waiting ${delay}ms`);
    await new Promise(x => setTimeout(x, delay));
  }
}

function getStatusProbe(serverUrl: string) {
  const statusUrl = new URL('/status', serverUrl);
  return () => isURLAvailable(statusUrl, false, debugAppium);
}

function prefixOutputLines(output: string, projectName?: string): string {
  const tag = projectName ? `Appium:${projectName}` : 'Appium';
  const lastIsNewLine = output[output.length - 1] === '\n';
  let lines = output.split('\n');
  if (lastIsNewLine)
    lines.pop();
  lines = lines.map(line => colors.dim(`[${tag}] `) + line);
  if (lastIsNewLine)
    lines.push('');
  return lines.join('\n');
}


