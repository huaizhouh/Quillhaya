// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import { checkedReplacement } from '../../src/core/sentences';
describe('explicit suggestion application', () => {
  it('leaves writing untouched until applied, maps the cursor and supports undo', () => {
    const parent = document.createElement('div'); document.body.appendChild(parent);
    const view = new EditorView({ parent, state: EditorState.create({ doc: 'He go home. More text.', selection: { anchor: 21 }, extensions: [history()] }) });
    const change = checkedReplacement(view.state.doc.toString(), 0, 11, 'He go home.', 'He goes home.');
    expect(view.state.doc.toString()).toBe('He go home. More text.');
    view.dispatch({ changes: change!, userEvent: 'input.replace' });
    expect(view.state.doc.toString()).toBe('He goes home. More text.'); expect(view.state.selection.main.head).toBe(23);
    expect(undo(view)).toBe(true); expect(view.state.doc.toString()).toBe('He go home. More text.'); view.destroy(); parent.remove();
  });
});
