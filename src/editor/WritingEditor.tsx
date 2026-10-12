import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { EditorView, Decoration, type DecorationSet, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, isolateHistory } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { checkedReplacement } from '../core/sentences';

export type ProblemMark = { from: number; to: number; severity: 'error' | 'improvement' };
const setProblems = StateEffect.define<ProblemMark[]>();
const problems = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) if (effect.is(setProblems)) value = Decoration.set(effect.value.filter(r => r.from >= 0 && r.to <= tr.newDoc.length && r.to > r.from).map(r => Decoration.mark({
      class: `sentence-problem sentence-${r.severity}`,
      attributes: { title: r.severity === 'error' ? '客观错误 · 建议修改' : '可选优化 · 可按需采纳', 'data-severity': r.severity }
    }).range(r.from, r.to)), true);
    return value;
  },
  provide: field => EditorView.decorations.from(field)
});

export interface EditorHandle {
  selection(): { from: number; to: number };
  apply(from: number, to: number, original: string, replacement: string): boolean;
  locate(from: number, to: number): void;
  focus(): void;
}
type Props = { documentId: string; initialText: string; marks: ProblemMark[]; onChange: (text: string, composing: boolean) => void; onComposition: (composing: boolean) => void };
export const WritingEditor = forwardRef<EditorHandle, Props>(function WritingEditor(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const latest = useRef(props); latest.current = props;
  const marks = useRef(props.marks); marks.current = props.marks;
  useImperativeHandle(ref, () => ({
    selection: () => { const s = view.current?.state.selection.main; return { from: s?.from ?? 0, to: s?.to ?? 0 }; },
    apply: (from, to, original, replacement) => {
      const v = view.current;
      if (!v || v.composing) return false;
      const change = checkedReplacement(v.state.doc.toString(), from, to, original, replacement);
      if (!change) return false;
      v.dispatch({ changes: change, userEvent: 'input.replace', annotations: isolateHistory.of('full') });
      v.focus(); return true;
    },
    locate: (from, to) => { const v = view.current; if (v && to <= v.state.doc.length) v.dispatch({ effects: EditorView.scrollIntoView(from, { y: 'center' }) }); },
    focus: () => view.current?.focus()
  }), []);
  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({ doc: latest.current.initialText, extensions: [
        history(), keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]), markdown(), syntaxHighlighting(defaultHighlightStyle),
        EditorView.lineWrapping, problems,
        EditorView.contentAttributes.of({ 'aria-label': 'Markdown 写作编辑器', role: 'textbox', 'aria-multiline': 'true', 'data-testid': 'writing-editor' }),
        placeholder('Start with a thought. Make it your own.\n\n在这里用英语写下你的观点。反馈会在你写作时，安静地出现在右侧。'),
        EditorView.updateListener.of(update => { if (update.docChanged) latest.current.onChange(update.state.doc.toString(), update.view.composing); }),
        EditorView.domEventHandlers({
          compositionstart: () => { latest.current.onComposition(true); return false; },
          compositionend: () => {
            setTimeout(() => { if (view.current === v) { latest.current.onComposition(false); v.dispatch({ effects: setProblems.of(marks.current) }); } }, 0);
            return false;
          }
        })
      ] })
    });
    view.current = v;
    return () => { view.current = null; v.destroy(); };
  }, [props.documentId]);
  useEffect(() => {
    if (view.current && !view.current.composing) view.current.dispatch({ effects: setProblems.of(props.marks) });
  }, [props.marks]);
  return <div className="editor-mount" ref={host} />;
});
