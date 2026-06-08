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
import path from 'path';

import colors from '@utils/colors';
import debug from '@utils/debugLog';
import { monotonicTime } from '@isomorphic/time';
import { raceAgainstDeadline } from '@isomorphic/timeoutRunner';
import { isURLAvailable } from '@utils/network';
import { launchProcess } from '@utils/processLauncher';

import type { TestRunnerPlugin, TestRunnerPluginRegistration } from '.';
import type { FullConfig } from '../../types/testReporter';
import type { FullConfigInternal } from '../common/index.js';
import type { AppiumConfig } from '../common/config.js';
import type { ReporterV2 } from '../reporters/reporterV2.js';

export const DEFAULT_APPIUM_SERVER_URL = 'http://127.0.0.1:4723';
const DEFAULT_TIMEOUT_MS = 60_000;

const debugAppium = debug('pw:appium');

export class AppiumServerPlugin implements TestRunnerPlugin {
  private _isAvailableCallback?: () => Promise<boolean>;
  private _killProcess?: () => Promise<void>;
  private _processExitedPromise!: Promise<never>;
  private _options: AppiumConfig & { serverUrl: string };
  private _reporter?: ReporterV2;
  private _projectName?: string;

  name = 'playwright:appium-server';

  constructor(options: AppiumConfig, projectName?: string) {
    this._options = { ...options, serverUrl: options.serverUrl ?? DEFAULT_APPIUM_SERVER_URL };
    this._projectName = projectName;
  }

  public async setup(_config: FullConfig, configDir: string, reporter: ReporterV2) {
    const devices = this._options.devices;
    if (devices && devices.length > 0 && _config.workers > devices.length) {
      const where = this._projectName ? ` (project "${this._projectName}")` : '';
      throw new Error(`appium.devices${where} has ${devices.length} entries but workers=${_config.workers}; add devices or reduce workers.`);
    }
    if (!this._options.autoStart)
      return;
    this._reporter = reporter;
    this._isAvailableCallback = getStatusProbe(this._options.serverUrl, reporter.onStdErr?.bind(reporter));
    this._options.cwd = this._options.cwd ? path.resolve(configDir, this._options.cwd) : configDir;
    try {
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

  private async _startProcess(): Promise<void> {
    let processExitedReject = (_: Error) => { };
    this._processExitedPromise = new Promise((_, reject) => { processExitedReject = reject; });

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
        this._reporter!.onStdOut?.(prefixOutputLines(data.toString(), this._projectName));
    });
    launchedProcess.stderr!.on('data', data => {
      if (debugAppium.enabled || this._options.stderr !== 'ignore')
        this._reporter!.onStdErr?.(prefixOutputLines(data.toString(), this._projectName));
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

function getStatusProbe(serverUrl: string, onStdErr: ReporterV2['onStdErr']) {
  const statusUrl = new URL('/status', serverUrl);
  return () => isURLAvailable(statusUrl, false, debugAppium, onStdErr);
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

export const appiumServerPluginsForConfig = (config: FullConfigInternal): TestRunnerPluginRegistration[] => {
  const plugins: TestRunnerPluginRegistration[] = [];
  for (const project of config.projects) {
    if (!project.appium)
      continue;
    plugins.push({
      factory: () => new AppiumServerPlugin(project.appium!, project.project.name),
      projectId: project.id,
    });
  }
  return plugins;
};
