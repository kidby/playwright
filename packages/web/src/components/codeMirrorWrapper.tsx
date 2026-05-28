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

import './codeMirrorWrapper.css';
import * as React from 'react';
import type { CodeMirror } from './codeMirrorModule';
import type { EditorState, Extension, StateEffectType } from '@codemirror/state';
import type { DecorationSet, EditorView } from '@codemirror/view';
import { ansi2html } from '../ansi2html';
import { useMeasure, kWebLinkRe } from '../uiUtils';

export type SourceHighlight = {
  line: number;
  column?: number;
  type: 'running' | 'paused' | 'error' | 'subtle-error';
  message?: string;
};

type CodeMirrorHighlighter = 'javascript' | 'python' | 'java' | 'csharp' | 'jsonl' | 'html' | 'css' | 'markdown' | 'yaml';

export const lineHeight = 20;

export interface SourceProps {
  text: string;
  highlighter?: CodeMirrorHighlighter;
  mimeType?: string;
  linkify?: boolean;
  readOnly?: boolean;
  // 1-based
  highlight?: SourceHighlight[];
  revealLine?: number;
  lineNumbers?: boolean;
  isFocused?: boolean;
  focusOnChange?: boolean;
  wrapLines?: boolean;
  onChange?: (text: string) => void;
  dataTestId?: string;
  placeholder?: string;
}

type EditorRef = {
  view: EditorView;
  cm: CodeMirror;
  mode: string;
  readOnly: boolean;
  lineNumbers?: boolean;
  wrapLines?: boolean;
  placeholder?: string;
  setHighlight: StateEffectType<SourceHighlight[]>;
  external: ReturnType<CodeMirror['Annotation']['define']>;
  highlight?: SourceHighlight[];
};

export const CodeMirrorWrapper: React.FC<SourceProps> = ({
  text,
  highlighter,
  mimeType,
  linkify,
  readOnly,
  highlight,
  revealLine,
  lineNumbers,
  isFocused,
  focusOnChange,
  wrapLines,
  onChange,
  dataTestId,
  placeholder,
}) => {
  const [measure, codemirrorElement] = useMeasure<HTMLDivElement>();
  const [modulePromise] = React.useState<Promise<CodeMirror>>(import('./codeMirrorModule').then(m => m.default));
  const editorRef = React.useRef<EditorRef | null>(null);
  const [editorView, setEditorView] = React.useState<EditorView>();
  // Keep the latest onChange in a ref so the editor's updateListener never goes stale.
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  React.useEffect(() => {
    (async () => {
      const CM = await modulePromise;

      const element = codemirrorElement.current;
      if (!element)
        return;

      const mode = highlighterToMode(highlighter) || mimeTypeToMode(mimeType) || (linkify ? 'text/linkified' : '');

      if (editorRef.current
        && mode === editorRef.current.mode
        && !!readOnly === editorRef.current.readOnly
        && lineNumbers === editorRef.current.lineNumbers
        && wrapLines === editorRef.current.wrapLines
        && placeholder === editorRef.current.placeholder) {
        // No need to re-create the editor.
        return;
      }

      // Either configuration is different or we don't have an editor yet.
      editorRef.current?.view.destroy();
      element.textContent = '';

      const setHighlight = CM.StateEffect.define<SourceHighlight[]>();
      const external = CM.Annotation.define<boolean>();
      const highlightField = CM.StateField.define<DecorationSet>({
        create: () => CM.Decoration.none,
        update(decorations, tr) {
          decorations = decorations.map(tr.changes);
          for (const effect of tr.effects) {
            if (effect.is(setHighlight))
              decorations = buildHighlightDecorations(CM, tr.state, effect.value);
          }
          return decorations;
        },
        provide: field => CM.EditorView.decorations.from(field),
      });

      const extensions: Extension[] = [
        CM.syntaxHighlighting(CM.highlightStyle),
        CM.bracketMatching(),
        CM.closeBrackets(),
        CM.history(),
        CM.search({ top: true }),
        CM.keymap.of([...CM.closeBracketsKeymap, ...CM.defaultKeymap, ...CM.historyKeymap, ...CM.searchKeymap]),
        highlightField,
        CM.EditorView.updateListener.of(update => {
          if (update.docChanged && !update.transactions.some(tr => tr.annotation(external)))
            onChangeRef.current?.(update.state.doc.toString());
        }),
      ];
      if (lineNumbers)
        extensions.push(CM.lineNumbers());
      if (wrapLines)
        extensions.push(CM.EditorView.lineWrapping);
      if (readOnly)
        extensions.push(CM.EditorState.readOnly.of(true), CM.EditorView.editable.of(false));
      if (placeholder)
        extensions.push(CM.placeholder(placeholder));
      const language = CM.languageExtension(mode);
      if (language)
        extensions.push(language);
      if (linkify || mode === 'markdown' || mode === 'text/linkified')
        extensions.push(linkifyPlugin(CM));

      const view = new CM.EditorView({
        state: CM.EditorState.create({ doc: '', extensions }),
        parent: element,
      });
      editorRef.current = { view, cm: CM, mode, readOnly: !!readOnly, lineNumbers, wrapLines, placeholder, setHighlight, external };
      if (isFocused)
        view.focus();
      setEditorView(view);
    })();
  }, [modulePromise, codemirrorElement, highlighter, mimeType, linkify, lineNumbers, wrapLines, readOnly, isFocused, placeholder]);

  React.useEffect(() => {
    editorRef.current?.view.requestMeasure();
  }, [measure]);

  React.useLayoutEffect(() => {
    const ref = editorRef.current;
    if (!editorView || !ref)
      return;
    const { view, cm: CM } = ref;

    let valueChanged = false;
    if (view.state.doc.toString() !== text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        annotations: ref.external.of(true),
      });
      valueChanged = true;
      if (focusOnChange) {
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        view.focus();
      }
    }

    if (valueChanged || JSON.stringify(highlight) !== JSON.stringify(ref.highlight)) {
      view.dispatch({ effects: ref.setHighlight.of(highlight || []) });
      ref.highlight = highlight;
    }

    // Line-less locations have line = 0, but they mean to reveal the file.
    if (typeof revealLine === 'number' && view.state.doc.lines >= revealLine) {
      const pos = view.state.doc.line(Math.max(1, revealLine)).from;
      view.dispatch({ effects: CM.EditorView.scrollIntoView(pos, { y: 'center' }) });
    }
  }, [editorView, text, highlight, revealLine, focusOnChange]);

  return <div data-testid={dataTestId} className='cm-wrapper' ref={codemirrorElement} onClick={onCodeMirrorClick}></div>;
};

function buildHighlightDecorations(CM: CodeMirror, state: EditorState, highlights: SourceHighlight[]): DecorationSet {
  const doc = state.doc;
  const ranges = [];
  for (const h of highlights) {
    if (h.line < 1 || h.line > doc.lines)
      continue;
    const line = doc.line(h.line);
    ranges.push(CM.Decoration.line({ class: `source-line-${h.type}` }).range(line.from));

    if ((h.type === 'error' || h.type === 'subtle-error') && line.length) {
      const to = h.column ? Math.min(line.from + h.column, line.to) : line.to;
      ranges.push(CM.Decoration.mark({
        class: 'source-line-error-underline',
        attributes: { title: h.message || '' },
      }).range(line.from, to));
    }

    if (h.type === 'error') {
      const dom = document.createElement('div');
      dom.innerHTML = ansi2html(h.message || '', { bg: 'var(--vscode-inputValidation-errorBackground)', fg: 'var(--vscode-editor-foreground)' });
      dom.className = 'source-line-error-widget';
      ranges.push(CM.Decoration.widget({ widget: CM.htmlWidget(dom), block: true, side: 1 }).range(line.to));
    }
  }
  return CM.Decoration.set(ranges, true);
}

function linkifyPlugin(CM: CodeMirror): Extension {
  return CM.ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this._build(CM, view);
    }
    update(update: import('./codeMirrorModule').ViewUpdate) {
      if (update.docChanged || update.viewportChanged)
        this.decorations = this._build(CM, update.view);
    }
    _build(CM: CodeMirror, view: EditorView): DecorationSet {
      const ranges = [];
      const re = new RegExp(kWebLinkRe.source, kWebLinkRe.flags);
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(text))) {
          ranges.push(CM.Decoration.mark({ class: 'cm-linkified' }).range(from + match.index, from + match.index + match[0].length));
          if (match.index === re.lastIndex)
            re.lastIndex++;
        }
      }
      return CM.Decoration.set(ranges, true);
    }
  }, { decorations: plugin => plugin.decorations });
}

function onCodeMirrorClick(event: React.MouseEvent) {
  if (!(event.target instanceof HTMLElement))
    return;
  // URLs are decorated with the 'cm-linkified' class by linkifyPlugin (covers
  // both linkified plain text and raw URLs in markdown source).
  if (event.target.classList.contains('cm-linkified')) {
    const url = event.target.textContent!;
    event.preventDefault();
    event.stopPropagation();
    window.open(url, '_blank');
  }
}

function mimeTypeToMode(mimeType: string | undefined): string | undefined {
  if (!mimeType)
    return;
  if (mimeType.includes('javascript') || mimeType.includes('json'))
    return 'javascript';
  if (mimeType.includes('python'))
    return 'python';
  if (mimeType.includes('csharp'))
    return 'text/x-csharp';
  if (mimeType.includes('java'))
    return 'text/x-java';
  if (mimeType.includes('markdown'))
    return 'markdown';
  if (mimeType.includes('html') || mimeType.includes('svg'))
    return 'htmlmixed';
  if (mimeType.includes('css'))
    return 'css';
}

function highlighterToMode(highlighter: CodeMirrorHighlighter | undefined): string | undefined {
  if (!highlighter)
    return;
  return {
    javascript: 'javascript',
    jsonl: 'javascript',
    python: 'python',
    csharp: 'text/x-csharp',
    java: 'text/x-java',
    markdown: 'markdown',
    html: 'htmlmixed',
    css: 'css',
    yaml: 'yaml',
  }[highlighter];
}
