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

import { Android } from './android/android.js';
import { AdbBackend } from './android/backendAdb.js';
import { BidiChromium } from './bidi/bidiChromium.js';
import { BidiFirefox } from './bidi/bidiFirefox.js';
import { Chromium } from './chromium/chromium.js';
import { DebugController } from './debugController.js';
import { Electron } from './electron/electron.js';
import { Firefox } from './firefox/firefox.js';
import { SdkObject, createRootSdkObject } from './instrumentation.js';
import { WebKit } from './webkit/webkit.js';

import type { BrowserType } from './browserType.js';
import type { Language } from '@isomorphic/locatorGenerators';
import type { Browser } from './browser.js';
import type { Page } from './page.js';

type PlaywrightOptions = {
  sdkLanguage: Language;
  isInternalPlaywright?: boolean;
  isServer?: boolean;
};

export class Playwright extends SdkObject {
  readonly chromium: BrowserType;
  readonly android: Android;
  readonly electron: Electron;
  readonly firefox: BrowserType;
  readonly webkit: BrowserType;
  readonly options: PlaywrightOptions;
  readonly debugController: DebugController;
  private _allPages = new Set<Page>();
  private _allBrowsers = new Set<Browser>();

  constructor(options: PlaywrightOptions) {
    super(createRootSdkObject(), undefined, 'Playwright');
    this.options = options;
    this.attribution.playwright = this;
    this.instrumentation.addListener({
      onBrowserOpen: browser => this._allBrowsers.add(browser),
      onBrowserClose: browser => this._allBrowsers.delete(browser),
      onPageOpen: page => this._allPages.add(page),
      onPageClose: page => this._allPages.delete(page),
    }, null);
    this.chromium = new Chromium(this, new BidiChromium(this));
    this.firefox = new Firefox(this, new BidiFirefox(this));
    this.webkit = new WebKit(this);
    this.electron = new Electron(this);
    this.android = new Android(this, new AdbBackend());
    this.debugController = new DebugController(this);
  }

  allBrowsers(): Browser[] {
    return [...this._allBrowsers];
  }

  allPages(): Page[] {
    return [...this._allPages];
  }
}

export function createPlaywright(options: PlaywrightOptions) {
  return new Playwright(options);
}
