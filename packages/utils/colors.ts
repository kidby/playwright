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

// picocolors-compatible facade. Inline ANSI codes (matching picocolors'
// approach) — `util.styleText` measured ~630x slower per call, which compounds
// across reporters in `FORCE_COLOR=1` worker processes.
//
// Honors NO_COLOR / FORCE_COLOR. `isColorSupported` is preserved for call
// sites that branch on capability.

const isTTY = process.stdout.isTTY === true;
const noColor = 'NO_COLOR' in process.env && process.env.NO_COLOR !== '';
const forceColor = process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0' && process.env.FORCE_COLOR !== '';
const enabled = forceColor || (isTTY && !noColor);

const wrap = (open: string, close: string) => {
  if (!enabled)
    return (text: string | number): string => String(text);
  const closeRe = new RegExp(close.replace(/\[/g, '\\['), 'g');
  return (text: string | number): string => {
    const s = String(text);
    // Re-open after every embedded `close` so nested colors keep working.
    return open + (s.includes(close) ? s.replace(closeRe, open) : s) + close;
  };
};

const colors = {
  reset: wrap('\x1b[0m', '\x1b[0m'),
  bold: wrap('\x1b[1m', '\x1b[22m'),
  dim: wrap('\x1b[2m', '\x1b[22m'),
  italic: wrap('\x1b[3m', '\x1b[23m'),
  underline: wrap('\x1b[4m', '\x1b[24m'),
  inverse: wrap('\x1b[7m', '\x1b[27m'),
  hidden: wrap('\x1b[8m', '\x1b[28m'),
  strikethrough: wrap('\x1b[9m', '\x1b[29m'),

  black: wrap('\x1b[30m', '\x1b[39m'),
  red: wrap('\x1b[31m', '\x1b[39m'),
  green: wrap('\x1b[32m', '\x1b[39m'),
  yellow: wrap('\x1b[33m', '\x1b[39m'),
  blue: wrap('\x1b[34m', '\x1b[39m'),
  magenta: wrap('\x1b[35m', '\x1b[39m'),
  cyan: wrap('\x1b[36m', '\x1b[39m'),
  white: wrap('\x1b[37m', '\x1b[39m'),
  gray: wrap('\x1b[90m', '\x1b[39m'),

  bgBlack: wrap('\x1b[40m', '\x1b[49m'),
  bgRed: wrap('\x1b[41m', '\x1b[49m'),
  bgGreen: wrap('\x1b[42m', '\x1b[49m'),
  bgYellow: wrap('\x1b[43m', '\x1b[49m'),
  bgBlue: wrap('\x1b[44m', '\x1b[49m'),
  bgMagenta: wrap('\x1b[45m', '\x1b[49m'),
  bgCyan: wrap('\x1b[46m', '\x1b[49m'),
  bgWhite: wrap('\x1b[47m', '\x1b[49m'),

  isColorSupported: enabled,
};

export default colors;
