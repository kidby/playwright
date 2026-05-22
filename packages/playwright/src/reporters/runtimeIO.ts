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

import fs from 'fs';
import path from 'path';

type BunGlobal = { write(dest: string, data: string | Uint8Array | Buffer): Promise<number> };
declare const Bun: BunGlobal | undefined;

export async function writeFileAtomic(filePath: string, contents: string): Promise<void> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (typeof Bun !== 'undefined')
    await Bun.write(filePath, contents);
  else
    fs.writeFileSync(filePath, contents, 'utf-8');
}
