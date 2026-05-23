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

// @ts-check
//
// In methods accepting a `progress` parameter, awaited async calls must
// either pass `progress` as first argument or be wrapped in `progress.race()`.
// Original ESLint version was type-aware (checked Progress type via
// TypeChecker). This oxlint-compatible port is syntactic-only — scoped to
// `packages/playwright-core/src/server/**` via .oxlintrc.json overrides where
// the Progress pattern is the convention and false positives are unlikely.

function isProgressIdentifier(node) {
  // Accept any identifier whose name ends in `progress` or `Progress` —
  // covers `progress`, `nullProgress`, `subProgress`, `myProgress`, etc.
  return node && node.type === 'Identifier' && /[pP]rogress$/.test(node.name);
}

function hasProgressParam(node) {
  return node.params.some(p => isProgressIdentifier(p));
}

function isProgressRace(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'progress' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'race'
  );
}

function unwrapPromiseChain(node) {
  while (node.type === 'CallExpression' &&
         node.callee.type === 'MemberExpression' &&
         node.callee.property.type === 'Identifier' &&
         ['then', 'catch', 'finally'].includes(node.callee.property.name))
    node = node.callee.object;

  return node;
}

function passesProgressAsFirstArg(node) {
  const root = unwrapPromiseChain(node);
  if (root.type !== 'CallExpression')
    return false;
  return isProgressIdentifier(root.arguments[0]);
}

function isInsideProgressRace(node) {
  let current = node.parent;
  while (current) {
    if (isProgressRace(current))
      return true;
    if (current.type === 'ArrowFunctionExpression' || current.type === 'FunctionExpression' || current.type === 'FunctionDeclaration' || current.type === 'MethodDefinition')
      return false;
    current = current.parent;
  }
  return false;
}

const rule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'In methods accepting Progress, awaited calls must pass progress or be wrapped in progress.race()',
    },
    messages: {
      missingProgress: 'Awaited call must either pass `progress` as first argument or be wrapped in `progress.race()`. See packages/protocol/src/progress.d.ts.',
    },
    schema: [],
  },
  create(context) {
    const progressFunctionStack = [];

    function enterFunction(node) {
      progressFunctionStack.push(hasProgressParam(node));
    }

    function exitFunction() {
      progressFunctionStack.pop();
    }

    function isInProgressFunction() {
      return progressFunctionStack.length > 0 && progressFunctionStack[progressFunctionStack.length - 1];
    }

    return {
      'FunctionDeclaration': enterFunction,
      'FunctionDeclaration:exit': exitFunction,
      'FunctionExpression': enterFunction,
      'FunctionExpression:exit': exitFunction,
      'ArrowFunctionExpression': enterFunction,
      'ArrowFunctionExpression:exit': exitFunction,

      'AwaitExpression'(node) {
        if (!isInProgressFunction())
          return;

        const awaited = node.argument;

        // Only flag call expressions — `await x`, `await 42`, etc. pass.
        if (awaited.type !== 'CallExpression')
          return;

        // `await progress.anything(...)` — calls on progress itself.
        if (awaited.callee.type === 'MemberExpression' &&
            awaited.callee.object.type === 'Identifier' &&
            awaited.callee.object.name === 'progress')
          return;

        // `await fn(progress, ...)` is fine (unwraps .then/.catch/.finally chains).
        if (passesProgressAsFirstArg(awaited))
          return;

        // Promise.all/race/allSettled/any are aggregation helpers.
        if (awaited.callee.type === 'MemberExpression' &&
            awaited.callee.object.type === 'Identifier' &&
            awaited.callee.object.name === 'Promise' &&
            awaited.callee.property.type === 'Identifier' &&
            ['all', 'race', 'allSettled', 'any'].includes(awaited.callee.property.name))
          return;

        // Inside an enclosing progress.race(...).
        if (isInsideProgressRace(node))
          return;

        context.report({
          node: awaited,
          messageId: 'missingProgress',
        });
      },
    };
  },
};

module.exports = {
  meta: {
    name: 'progress',
  },
  rules: {
    'await-must-use-progress': rule,
  },
};
