/*
  Copyright (c) Microsoft Corporation.

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { Annotation, EditorState, StateEffect, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, lineNumbers, placeholder } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { HighlightStyle, StreamLanguage, bracketMatching, syntaxHighlighting } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { java } from '@codemirror/lang-java';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { yaml } from '@codemirror/lang-yaml';
import { csharp } from '@codemirror/legacy-modes/mode/clike';

// Map syntax-highlight tags onto stable `tok-*` classes; colors live in
// codeMirrorWrapper.css so the existing light/dark VS Code theming is preserved.
const highlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.standard(t.name), t.operatorKeyword, t.modifier], class: 'tok-keyword' },
  { tag: [t.number, t.bool, t.integer, t.float], class: 'tok-number' },
  { tag: [t.string, t.special(t.string), t.regexp], class: 'tok-string' },
  { tag: [t.comment, t.lineComment, t.blockComment], class: 'tok-comment' },
  { tag: [t.invalid], class: 'tok-error' },
  { tag: [t.definition(t.name), t.tagName, t.heading], class: 'tok-def' },
  { tag: [t.variableName, t.atom, t.labelName], class: 'tok-variable' },
  { tag: [t.propertyName, t.function(t.variableName), t.function(t.propertyName)], class: 'tok-property' },
  { tag: [t.attributeName], class: 'tok-attribute' },
  { tag: [t.typeName, t.className, t.namespace], class: 'tok-type' },
  { tag: [t.operator, t.meta], class: 'tok-operator' },
  { tag: [t.bracket, t.brace, t.paren, t.punctuation], class: 'tok-bracket' },
  { tag: [t.link, t.url], class: 'tok-link' },
]);

/**
 * Resolve a legacy CodeMirror 5 mode string (kept by the wrapper) to a CM6
 * language extension. Returns undefined for plain text / linkified content.
 */
function languageExtension(mode: string | undefined): Extension | undefined {
  switch (mode) {
    case 'javascript': return javascript();
    case 'python': return python();
    case 'text/x-java': return java();
    case 'text/x-csharp': return StreamLanguage.define(csharp);
    case 'markdown': return markdown();
    case 'htmlmixed': return html();
    case 'css': return css();
    case 'yaml': return yaml();
    default: return undefined;
  }
}

// Wraps a pre-rendered DOM node as a block widget (used for inline error messages).
class HtmlWidget extends WidgetType {
  constructor(private _dom: HTMLElement) {
    super();
  }
  override eq(other: HtmlWidget) {
    return other._dom === this._dom;
  }
  override toDOM() {
    return this._dom;
  }
}

function htmlWidget(dom: HTMLElement): WidgetType {
  return new HtmlWidget(dom);
}

const cmModule = {
  Annotation,
  EditorState,
  EditorView,
  StateEffect,
  StateField,
  Decoration,
  ViewPlugin,
  keymap,
  lineNumbers,
  placeholder,
  bracketMatching,
  syntaxHighlighting,
  closeBrackets,
  closeBracketsKeymap,
  defaultKeymap,
  history,
  historyKeymap,
  search,
  searchKeymap,
  highlightStyle,
  languageExtension,
  htmlWidget,
};

export type CodeMirror = typeof cmModule;
export type { DecorationSet, ViewUpdate };
export default cmModule;
