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

import colors from '@utils/colors';
import { asLocatorDescription } from '@isomorphic/locatorGenerators';
import { isTextualMimeType } from '@isomorphic/mimeType';
import { isRegExp } from '@isomorphic/rtti';
import { isString } from '@isomorphic/stringUtils';
import { pollAgainstDeadline } from '@isomorphic/timeoutRunner';
import { constructURLBasedOnBaseURL, isURLPattern } from '@isomorphic/urlMatch';
import { serializeExpectedTextValues } from '@isomorphic/expectUtils';
import { monotonicTime } from '@isomorphic/index';

import { expectTypes, formatMatcherMessage, MatcherResult } from './matcherHint.js';
import { toBeTruthy } from './toBeTruthy.js';
import { toEqual } from './toEqual.js';
import { toHaveURLWithPredicate } from './toHaveURL.js';
import { toMatchText } from './toMatchText.js';
import { toHaveScreenshotStepTitle } from './toMatchSnapshot.js';
import { expectConfig } from './expect.js';

import type { ExpectMatcherState } from '../../types/test';
import type { ExpectTestInfo } from './expect.js';
import type { InternalMatcherUtils } from './matcherHint.js';
import type { APIResponse, Locator, Frame, Page } from 'playwright-core';
import type { ExpectResult, FrameExpectParams } from 'playwright-core/types/internal';
import type { ExpectMatcherUtils } from '../../types/test';
import type { URLPattern } from '@isomorphic/urlMatch';

export type ExpectMatcherStateInternal = Omit<ExpectMatcherState, 'utils'> & {
  utils: ExpectMatcherUtils & InternalMatcherUtils;
};

export interface LocatorEx extends Locator {
  _selector: string;
  _expect(expression: string, options: FrameExpectParams): Promise<ExpectResult>;
}

export interface FrameEx extends Frame {
  _expect(expression: string, options: FrameExpectParams): Promise<ExpectResult>;
}

interface APIResponseEx extends APIResponse {
  _fetchLog(): Promise<string[]>;
}

export function toBeAttached(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  options?: { attached?: boolean, timeout?: number },
) {
  const attached = !options || options.attached === undefined || options.attached;
  const expected = attached ? 'attached' : 'detached';
  const arg = attached ? '' : '{ attached: false }';
  return toBeTruthy.call(this, 'toBeAttached', locator, 'Locator', expected, arg, async (isNot, timeout) => {
    return await locator._expect(attached ? 'to.be.attached' : 'to.be.detached', { isNot, timeout });
  }, options);
}

export function toBeChecked(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  options?: { checked?: boolean, indeterminate?: boolean, timeout?: number },
) {
  const checked = options?.checked;
  const indeterminate = options?.indeterminate;
  const expectedValue = {
    checked,
    indeterminate,
  };
  let expected: string;
  let arg: string;
  if (options?.indeterminate) {
    expected = 'indeterminate';
    arg = `{ indeterminate: true }`;
  } else {
    expected = options?.checked === false ? 'unchecked' : 'checked';
    arg = options?.checked === false ? `{ checked: false }` : '';
  }
  return toBeTruthy.call(this, 'toBeChecked', locator, 'Locator', expected, arg, async (isNot, timeout) => {
    return await locator._expect('to.be.checked', { isNot, timeout, expectedValue });
  }, options);
}

export function toBeDisabled(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  options?: { timeout?: number },
) {
  return toBeTruthy.call(this, 'toBeDisabled', locator, 'Locator', 'disabled', '', async (isNot, timeout) => {
    return await locator._expect('to.be.disabled', { isNot, timeout });
  }, options);
}

export function toBeEditable(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  options?: { editable?: boolean, timeout?: number },
) {
  const editable = !options || options.editable === undefined || options.editable;
  const expected = editable ? 'editable' : 'readOnly';
  const arg = editable ? '' : '{ editable: false }';
  return toBeTruthy.call(this, 'toBeEditable', locator, 'Locator', expected, arg, async (isNot, timeout) => {
    return await locator._expect(editable ? 'to.be.editable' : 'to.be.readonly', { isNot, timeout });
  }, options);
}

export function toBeEmpty(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  options?: { timeout?: number },
) {
  return toBeTruthy.call(this, 'toBeEmpty', locator, 'Locator', 'empty', '', async (isNot, timeout) => {
    return await locator._expect('to.be.empty', { isNot, timeout });
  }, options);
}

export function toBeEnabled(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  options?: { enabled?: boolean, timeout?: number },
) {
  const enabled = !options || options.enabled === undefined || options.enabled;
  const expected = enabled ? 'enabled' : 'disabled';
  const arg = enabled ? '' : '{ enabled: false }';
  return toBeTruthy.call(this, 'toBeEnabled', locator, 'Locator', expected, arg, async (isNot, timeout) => {
    return await locator._expect(enabled ? 'to.be.enabled' : 'to.be.disabled', { isNot, timeout });
  }, options);
}

export function toBeFocused(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  options?: { timeout?: number },
) {
  return toBeTruthy.call(this, 'toBeFocused', locator, 'Locator', 'focused', '', async (isNot, timeout) => {
    return await locator._expect('to.be.focused', { isNot, timeout });
  }, options);
}

export function toBeHidden(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  options?: { timeout?: number },
) {
  return toBeTruthy.call(this, 'toBeHidden', locator, 'Locator', 'hidden', '', async (isNot, timeout) => {
    return await locator._expect('to.be.hidden', { isNot, timeout });
  }, options);
}

export function toBeVisible(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  options?: { visible?: boolean, timeout?: number },
) {
  const visible = !options || options.visible === undefined || options.visible;
  const expected = visible ? 'visible' : 'hidden';
  const arg = visible ? '' : '{ visible: false }';
  return toBeTruthy.call(this, 'toBeVisible', locator, 'Locator', expected, arg, async (isNot, timeout) => {
    return await locator._expect(visible ? 'to.be.visible' : 'to.be.hidden', { isNot, timeout });
  }, options);
}

export function toBeInViewport(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  options?: { timeout?: number, ratio?: number },
) {
  return toBeTruthy.call(this, 'toBeInViewport', locator, 'Locator', 'in viewport', '', async (isNot, timeout) => {
    return await locator._expect('to.be.in.viewport', { isNot, expectedNumber: options?.ratio, timeout });
  }, options);
}

export function toContainText(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  expected: string | RegExp | (string | RegExp)[],
  options: { timeout?: number, useInnerText?: boolean, ignoreCase?: boolean } = {},
) {
  if (Array.isArray(expected)) {
    return toEqual.call(this, 'toContainText', locator, 'Locator', async (isNot, timeout) => {
      const expectedText = serializeExpectedTextValues(expected, { matchSubstring: true, normalizeWhiteSpace: true, ignoreCase: options.ignoreCase });
      return await locator._expect('to.contain.text.array', { expectedText, isNot, useInnerText: options.useInnerText, timeout });
    }, expected, { ...options, contains: true });
  } else {
    return toMatchText.call(this, 'toContainText', locator, 'Locator', async (isNot, timeout) => {
      const expectedText = serializeExpectedTextValues([expected], { matchSubstring: true, normalizeWhiteSpace: true, ignoreCase: options.ignoreCase });
      return await locator._expect('to.have.text', { expectedText, isNot, useInnerText: options.useInnerText, timeout });
    }, expected, { ...options, matchSubstring: true });
  }
}

export function toHaveAccessibleDescription(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  expected: string | RegExp,
  options?: { timeout?: number, ignoreCase?: boolean },
) {
  return toMatchText.call(this, 'toHaveAccessibleDescription', locator, 'Locator', async (isNot, timeout) => {
    const expectedText = serializeExpectedTextValues([expected], { ignoreCase: options?.ignoreCase, normalizeWhiteSpace: true });
    return await locator._expect('to.have.accessible.description', { expectedText, isNot, timeout });
  }, expected, options);
}

export function toHaveAccessibleName(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  expected: string | RegExp,
  options?: { timeout?: number, ignoreCase?: boolean },
) {
  return toMatchText.call(this, 'toHaveAccessibleName', locator, 'Locator', async (isNot, timeout) => {
    const expectedText = serializeExpectedTextValues([expected], { ignoreCase: options?.ignoreCase, normalizeWhiteSpace: true });
    return await locator._expect('to.have.accessible.name', { expectedText, isNot, timeout });
  }, expected, options);
}

export function toHaveAccessibleErrorMessage(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  expected: string | RegExp,
  options?: { timeout?: number; ignoreCase?: boolean },
) {
  return toMatchText.call(this, 'toHaveAccessibleErrorMessage', locator, 'Locator', async (isNot, timeout) => {
    const expectedText = serializeExpectedTextValues([expected], { ignoreCase: options?.ignoreCase, normalizeWhiteSpace: true });
    return await locator._expect('to.have.accessible.error.message', { expectedText: expectedText, isNot, timeout });
  }, expected, options);
}

export function toHaveAttribute(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  name: string,
  expected: string | RegExp | undefined | { timeout?: number },
  options?: { timeout?: number, ignoreCase?: boolean },
) {
  if (!options) {
    // Update params for the case toHaveAttribute(name, options);
    if (typeof expected === 'object' && !isRegExp(expected)) {
      options = expected;
      expected = undefined;
    }
  }
  if (expected === undefined) {
    return toBeTruthy.call(this, 'toHaveAttribute', locator, 'Locator', 'have attribute', '', async (isNot, timeout) => {
      return await locator._expect('to.have.attribute', { expressionArg: name, isNot, timeout });
    }, options);
  }
  return toMatchText.call(this, 'toHaveAttribute', locator, 'Locator', async (isNot, timeout) => {
    const expectedText = serializeExpectedTextValues([expected as (string | RegExp)], { ignoreCase: options?.ignoreCase });
    return await locator._expect('to.have.attribute.value', { expressionArg: name, expectedText, isNot, timeout });
  }, expected as (string | RegExp), options);
}

export function toHaveClass(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  expected: string | RegExp | (string | RegExp)[],
  options?: { timeout?: number },
) {
  if (Array.isArray(expected)) {
    return toEqual.call(this, 'toHaveClass', locator, 'Locator', async (isNot, timeout) => {
      const expectedText = serializeExpectedTextValues(expected);
      return await locator._expect('to.have.class.array', { expectedText, isNot, timeout });
    }, expected, options);
  } else {
    return toMatchText.call(this, 'toHaveClass', locator, 'Locator', async (isNot, timeout) => {
      const expectedText = serializeExpectedTextValues([expected]);
      return await locator._expect('to.have.class', { expectedText, isNot, timeout });
    }, expected, options);
  }
}

export function toContainClass(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  expected: string | string[],
  options?: { timeout?: number },
) {
  if (Array.isArray(expected)) {
    if (expected.some(e => isRegExp(e)))
      throw new Error(`"expected" argument in toContainClass cannot contain RegExp values`);
    return toEqual.call(this, 'toContainClass', locator, 'Locator', async (isNot, timeout) => {
      const expectedText = serializeExpectedTextValues(expected);
      return await locator._expect('to.contain.class.array', { expectedText, isNot, timeout });
    }, expected, options);
  } else {
    if (isRegExp(expected))
      throw new Error(`"expected" argument in toContainClass cannot be a RegExp value`);
    return toMatchText.call(this, 'toContainClass', locator, 'Locator', async (isNot, timeout) => {
      const expectedText = serializeExpectedTextValues([expected]);
      return await locator._expect('to.contain.class', { expectedText, isNot, timeout });
    }, expected, options);
  }
}

export function toHaveCount(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  expected: number,
  options?: { timeout?: number },
) {
  return toEqual.call(this, 'toHaveCount', locator, 'Locator', async (isNot, timeout) => {
    return await locator._expect('to.have.count', { expectedNumber: expected, isNot, timeout });
  }, expected, options);
}

export function toHaveCSS(this: ExpectMatcherStateInternal, locator: LocatorEx, name: string, expected: string | RegExp, options?: { timeout?: number, pseudo?: 'before' | 'after' }): Promise<MatcherResult<any, any>>;
export function toHaveCSS(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  name: string,
  expected: string | RegExp,
  options?: { timeout?: number, pseudo?: 'before' | 'after' },
) {
  return toMatchText.call(this, 'toHaveCSS', locator, 'Locator', async (isNot, timeout) => {
    const expectedText = serializeExpectedTextValues([expected]);
    return await locator._expect('to.have.css', { expressionArg: name, expectedText, isNot, pseudo: options?.pseudo, timeout });
  }, expected, options);
}

export function toHaveId(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  expected: string | RegExp,
  options?: { timeout?: number },
) {
  return toMatchText.call(this, 'toHaveId', locator, 'Locator', async (isNot, timeout) => {
    const expectedText = serializeExpectedTextValues([expected]);
    return await locator._expect('to.have.id', { expectedText, isNot, timeout });
  }, expected, options);
}

export function toHaveJSProperty(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  name: string,
  expected: any,
  options?: { timeout?: number },
) {
  return toEqual.call(this, 'toHaveJSProperty', locator, 'Locator', async (isNot, timeout) => {
    return await locator._expect('to.have.property', { expressionArg: name, expectedValue: expected, isNot, timeout });
  }, expected, options);
}

export function toHaveRole(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  expected: string,
  options?: { timeout?: number, ignoreCase?: boolean },
) {
  if (!isString(expected))
    throw new Error(`"role" argument in toHaveRole must be a string`);
  return toMatchText.call(this, 'toHaveRole', locator, 'Locator', async (isNot, timeout) => {
    const expectedText = serializeExpectedTextValues([expected]);
    return await locator._expect('to.have.role', { expectedText, isNot, timeout });
  }, expected, options);
}

export function toHaveText(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  expected: string | RegExp | (string | RegExp)[],
  options: { timeout?: number, useInnerText?: boolean, ignoreCase?: boolean } = {},
) {
  if (Array.isArray(expected)) {
    return toEqual.call(this, 'toHaveText', locator, 'Locator', async (isNot, timeout) => {
      const expectedText = serializeExpectedTextValues(expected, { normalizeWhiteSpace: true, ignoreCase: options.ignoreCase });
      return await locator._expect('to.have.text.array', { expectedText, isNot, useInnerText: options?.useInnerText, timeout });
    }, expected, options);
  } else {
    return toMatchText.call(this, 'toHaveText', locator, 'Locator', async (isNot, timeout) => {
      const expectedText = serializeExpectedTextValues([expected], { normalizeWhiteSpace: true, ignoreCase: options.ignoreCase });
      return await locator._expect('to.have.text', { expectedText, isNot, useInnerText: options?.useInnerText, timeout });
    }, expected, options);
  }
}

export function toHaveValue(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  expected: string | RegExp,
  options?: { timeout?: number },
) {
  return toMatchText.call(this, 'toHaveValue', locator, 'Locator', async (isNot, timeout) => {
    const expectedText = serializeExpectedTextValues([expected]);
    return await locator._expect('to.have.value', { expectedText, isNot, timeout });
  }, expected, options);
}

export function toHaveValues(
  this: ExpectMatcherStateInternal,
  locator: LocatorEx,
  expected: (string | RegExp)[],
  options?: { timeout?: number },
) {
  return toEqual.call(this, 'toHaveValues', locator, 'Locator', async (isNot, timeout) => {
    const expectedText = serializeExpectedTextValues(expected);
    return await locator._expect('to.have.values', { expectedText, isNot, timeout });
  }, expected, options);
}

export function toHaveTitle(
  this: ExpectMatcherStateInternal,
  page: Page,
  expected: string | RegExp,
  options: { timeout?: number } = {},
) {
  return toMatchText.call(this, 'toHaveTitle', page, 'Page', async (isNot, timeout) => {
    const expectedText = serializeExpectedTextValues([expected], { normalizeWhiteSpace: true });
    return await (page.mainFrame() as FrameEx)._expect('to.have.title', { expectedText, isNot, timeout });
  }, expected, options);
}

export function toHaveURL(
  this: ExpectMatcherStateInternal,
  page: Page,
  expected: string | RegExp | URLPattern | ((url: URL) => boolean),
  options?: { ignoreCase?: boolean; timeout?: number },
) {
  if (isURLPattern(expected))
    return toHaveURLWithPredicate.call(this, page, url => (expected as URLPattern).test(url.href), options);

  // Ports don't support predicates. Keep separate server and client codepaths
  if (typeof expected === 'function')
    return toHaveURLWithPredicate.call(this, page, expected, options);

  const baseURL = (page.context() as any)._options.baseURL;
  expected = typeof expected === 'string' ? constructURLBasedOnBaseURL(baseURL, expected) : expected;
  return toMatchText.call(this, 'toHaveURL', page, 'Page', async (isNot, timeout) => {
    const expectedText = serializeExpectedTextValues([expected], { ignoreCase: options?.ignoreCase });
    return await (page.mainFrame() as FrameEx)._expect('to.have.url', { expectedText, isNot, timeout });
  }, expected, options);
}

export async function toBeOK(
  this: ExpectMatcherStateInternal,
  response: APIResponseEx
) {
  const matcherName = 'toBeOK';
  expectTypes(response, ['APIResponse'], matcherName);

  const contentType = response.headers()['content-type'];
  const isTextEncoding = contentType && isTextualMimeType(contentType);
  const [log, text] = (this.isNot === response.ok()) ? await Promise.all([
    response._fetchLog(),
    isTextEncoding ? response.text() : null
  ]) : [];

  const message = () => formatMatcherMessage(this.utils, {
    isNot: this.isNot,
    promise: this.promise,
    matcherName,
    receiver: 'response',
    expectation: '',
    log,
  }) + (text === null ? '' : `\nResponse text:\n${colors.dim(text?.substring(0, 1000) || '')}`);

  const pass = response.ok();
  return { message, pass };
}

export function toBeWithinRange(
  this: ExpectMatcherStateInternal,
  value: number,
  min: number,
  max: number,
) {
  const matcherName = 'toBeWithinRange';
  const pass = typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  const message = () => formatMatcherMessage(this.utils, {
    isNot: this.isNot,
    promise: this.promise,
    matcherName,
    receiver: 'value',
    expectation: `[${min}, ${max}]`,
    log: [`Actual: ${value}`],
  });
  return { message, pass };
}

export async function toMatchJsonSchema(
  this: ExpectMatcherStateInternal,
  received: any,
  schema: JsonSchema,
) {
  const matcherName = 'toMatchJsonSchema';
  // Allow either a parsed object or an APIResponse / Response — auto-extract
  // the JSON body in the response case so callers don't have to await first.
  let data = received;
  if (received && typeof received.json === 'function' && typeof received.ok === 'function')
    data = await received.json();

  const errors: string[] = [];
  validateJsonSchema(data, schema, '$', errors);
  const pass = errors.length === 0;
  const message = () => formatMatcherMessage(this.utils, {
    isNot: this.isNot,
    promise: this.promise,
    matcherName,
    receiver: 'data',
    expectation: '',
    log: errors.length ? errors : [`Schema matched at all checked points.`],
  });
  return { message, pass };
}

export async function toHaveResponseProperty(
  this: ExpectMatcherStateInternal,
  response: APIResponseEx,
  propertyPath: string,
  expected?: any,
) {
  const matcherName = 'toHaveResponseProperty';
  expectTypes(response, ['APIResponse'], matcherName);
  let body: any;
  try {
    body = await response.json();
  } catch (e) {
    return {
      pass: false,
      message: () => formatMatcherMessage(this.utils, {
        isNot: this.isNot,
        promise: this.promise,
        matcherName,
        receiver: 'response',
        expectation: propertyPath,
        log: [`Response body is not valid JSON: ${(e as Error).message}`],
      }),
    };
  }
  const { found, value } = getByJsonPath(body, propertyPath);
  let pass: boolean;
  if (!found)
    pass = false;
  else if (expected === undefined)
    pass = true;
  else
    pass = jsonDeepEqual(value, expected);

  const message = () => formatMatcherMessage(this.utils, {
    isNot: this.isNot,
    promise: this.promise,
    matcherName,
    receiver: 'response',
    expectation: expected === undefined ? propertyPath : `${propertyPath} = ${JSON.stringify(expected)}`,
    log: found ? [`Actual: ${JSON.stringify(value)}`] : [`Path "${propertyPath}" not found in response body`],
  });
  return { message, pass };
}

// Minimal JSON Schema validator covering the subset most API tests need:
// type, properties, required, additionalProperties, items, enum, const,
// pattern, minLength/maxLength, minimum/maximum. Avoids pulling ajv as a
// runtime dependency. For exotic schemas (oneOf/allOf/refs), users can
// pre-validate with their own validator and assert on a boolean.
export type JsonSchema = {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'null' | 'object' | 'array';
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  enum?: any[];
  const?: any;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  nullable?: boolean;
};

function jsonTypeOf(value: any): string {
  if (value === null)
    return 'null';
  if (Array.isArray(value))
    return 'array';
  if (Number.isInteger(value))
    return 'integer';
  return typeof value;
}

function validateJsonSchema(value: any, schema: JsonSchema, path: string, errors: string[]): void {
  if (schema.nullable && value === null)
    return;
  if (schema.type) {
    const actual = jsonTypeOf(value);
    const ok = schema.type === actual ||
      (schema.type === 'number' && actual === 'integer');
    if (!ok)
      errors.push(`${path}: expected type ${schema.type}, got ${actual}`);
  }
  if (schema.const !== undefined && !jsonDeepEqual(value, schema.const))
    errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
  if (schema.enum && !schema.enum.some(v => jsonDeepEqual(value, v)))
    errors.push(`${path}: value ${JSON.stringify(value)} not in enum`);
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value))
      errors.push(`${path}: string does not match pattern ${schema.pattern}`);
    if (schema.minLength !== undefined && value.length < schema.minLength)
      errors.push(`${path}: string length ${value.length} < minLength ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength)
      errors.push(`${path}: string length ${value.length} > maxLength ${schema.maxLength}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum)
      errors.push(`${path}: ${value} < minimum ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum)
      errors.push(`${path}: ${value} > maximum ${schema.maximum}`);
  }
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of Object.keys(schema.properties)) {
      if (key in value)
        validateJsonSchema(value[key], schema.properties[key], `${path}.${key}`, errors);
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key))
          errors.push(`${path}: unexpected property "${key}"`);
      }
    } else if (typeof schema.additionalProperties === 'object' && schema.additionalProperties) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key))
          validateJsonSchema(value[key], schema.additionalProperties, `${path}.${key}`, errors);
      }
    }
  }
  if (schema.required && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required) {
      if (!(key in value))
        errors.push(`${path}: missing required property "${key}"`);
    }
  }
  if (schema.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++)
      validateJsonSchema(value[i], schema.items, `${path}[${i}]`, errors);
  }
}

function getByJsonPath(root: any, propertyPath: string): { found: boolean; value: any } {
  // Tokenise `a.b[0].c` into ['a','b',0,'c']
  const tokens: (string | number)[] = [];
  const parts = propertyPath.split('.');
  for (const part of parts) {
    const match = part.match(/^([^[\]]*)((?:\[\d+\])*)$/);
    if (!match)
      return { found: false, value: undefined };
    if (match[1])
      tokens.push(match[1]);
    const indexMatches = match[2].matchAll(/\[(\d+)\]/g);
    for (const m of indexMatches)
      tokens.push(parseInt(m[1], 10));
  }
  let cursor = root;
  for (const tok of tokens) {
    if (cursor === null || cursor === undefined)
      return { found: false, value: undefined };
    if (typeof tok === 'number') {
      if (!Array.isArray(cursor) || tok >= cursor.length)
        return { found: false, value: undefined };
    } else {
      if (typeof cursor !== 'object' || !(tok in cursor))
        return { found: false, value: undefined };
    }
    cursor = cursor[tok as any];
  }
  return { found: true, value: cursor };
}

function jsonDeepEqual(a: any, b: any): boolean {
  if (a === b)
    return true;
  if (a === null || b === null || typeof a !== typeof b)
    return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length)
      return false;
    return a.every((v, i) => jsonDeepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length)
      return false;
    return aKeys.every(k => k in b && jsonDeepEqual(a[k], b[k]));
  }
  return false;
}

export async function toPass(
  this: ExpectMatcherState,
  callback: () => any,
  options: {
    intervals?: number[];
    timeout?: number,
  } = {},
) {
  const testInfo = expectConfig().testInfo;
  const timeout = options.timeout ?? expectConfig().toPass?.timeout ?? 0;
  const intervals = options.intervals ?? expectConfig().toPass?.intervals ?? [100, 250, 500, 1000];

  const { deadline, timeoutMessage } = deadlineForMatcher(testInfo, timeout);
  const result = await pollAgainstDeadline<Error|undefined>(async () => {
    if (testInfo && expectConfig().testInfo !== testInfo)
      return { continuePolling: false, result: undefined };
    try {
      await callback();
      return { continuePolling: !!this.isNot, result: undefined };
    } catch (e) {
      return { continuePolling: !this.isNot, result: e };
    }
  }, deadline, intervals);

  if (result.timedOut) {
    const message = result.result ? [
      result.result.message,
      '',
      `Call Log:`,
      `- ${timeoutMessage}`,
    ].join('\n') : timeoutMessage;
    return { message: () => message, pass: !!this.isNot };
  }
  return { pass: !this.isNot, message: () => '' };
}

export function computeMatcherTitleSuffix(matcherName: string, receiver: any, args: any[]): { short?: string, long?: string } {
  if (matcherName === 'toHaveScreenshot') {
    const title = toHaveScreenshotStepTitle(...args);
    return { short: title ? `(${title})` : '' };
  }
  if (receiver && typeof receiver === 'object' && (receiver as any)._apiName === 'Locator') {
    try {
      return { long: ' ' + asLocatorDescription('javascript', (receiver as LocatorEx)._selector) };
    } catch {
    }
  }
  return {};
}

export function deadlineForMatcher(testInfo: ExpectTestInfo | null, timeout: number): { deadline: number; timeoutMessage: string } {
  const startTime = monotonicTime();
  const matcherDeadline = timeout ? startTime + timeout : 0;
  const matcherMessage = `Timeout ${timeout}ms exceeded while waiting on the predicate`;
  if (!testInfo)
    return { deadline: matcherDeadline, timeoutMessage: matcherMessage };
  const { deadline: testDeadline, timeout: testTimeout } = testInfo._deadline();
  const effectiveTestDeadline = testDeadline - 250;
  const testMessage = `Test timeout of ${testTimeout}ms exceeded`;
  if (!matcherDeadline)
    return { deadline: effectiveTestDeadline, timeoutMessage: testMessage };
  return { deadline: Math.min(effectiveTestDeadline, matcherDeadline), timeoutMessage: effectiveTestDeadline < matcherDeadline ? testMessage : matcherMessage };
}
