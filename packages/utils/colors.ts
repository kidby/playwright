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

// picocolors-compatible facade backed by Node's native util.styleText.
// Lets us drop `picocolors` from package.json. Node 22+ required.
//
// util.styleText respects NO_COLOR / FORCE_COLOR env vars natively.
// `isColorSupported` is preserved for call sites that branch on capability.

import { styleText } from 'util';

const isTTY = process.stdout.isTTY === true;
const noColor = 'NO_COLOR' in process.env && process.env.NO_COLOR !== '';
const forceColor = process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0' && process.env.FORCE_COLOR !== '';
const enabled = forceColor || (isTTY && !noColor);

const wrap = (style: Parameters<typeof styleText>[0]) => (text: string | number): string =>
  enabled ? styleText(style, String(text)) : String(text);

const colors = {
  reset: wrap('reset'),
  bold: wrap('bold'),
  dim: wrap('dim'),
  italic: wrap('italic'),
  underline: wrap('underline'),
  inverse: wrap('inverse'),
  hidden: wrap('hidden'),
  strikethrough: wrap('strikethrough'),

  black: wrap('black'),
  red: wrap('red'),
  green: wrap('green'),
  yellow: wrap('yellow'),
  blue: wrap('blue'),
  magenta: wrap('magenta'),
  cyan: wrap('cyan'),
  white: wrap('white'),
  gray: wrap('gray'),

  bgBlack: wrap('bgBlack'),
  bgRed: wrap('bgRed'),
  bgGreen: wrap('bgGreen'),
  bgYellow: wrap('bgYellow'),
  bgBlue: wrap('bgBlue'),
  bgMagenta: wrap('bgMagenta'),
  bgCyan: wrap('bgCyan'),
  bgWhite: wrap('bgWhite'),

  isColorSupported: enabled,
};

export default colors;
