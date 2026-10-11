import { describe, expect, it } from 'vitest';
import { checkedReplacement, splitSentences, wordCount } from '../../src/core/sentences';

describe('conservative sentence boundaries', () => {
  it('handles punctuation, quotes, offsets and line breaks', () => {
    const text = '  Hello world. Are you ready? Yes!\n"We can learn."';
    const sentences = splitSentences(text);
    expect(sentences.map(s => s.text)).toEqual(['Hello world.', 'Are you ready?', 'Yes!', '"We can learn."']);
    expect(sentences.every(s => s.complete && text.slice(s.from, s.to) === s.text)).toBe(true);
  });
  it('does not split abbreviations, initials or decimals', () => {
    const text = 'Dr. Smith teaches at 3.5 credits, e.g. writing. We agree!';
    expect(splitSentences(text).map(s => s.text)).toEqual(['Dr. Smith teaches at 3.5 credits, e.g. writing.', 'We agree!']);
    expect(splitSentences('J. R. Smith lives in the U.S. today.')).toHaveLength(1);
  });
  it('preserves unfinished sentences without calling them errors', () => {
    const sentences = splitSentences('I think that\nThe other idea');
    expect(sentences).toHaveLength(2); expect(sentences.every(s => !s.complete)).toBe(true);
  });
  it('excludes Markdown headings, fences, URLs and inline code', () => {
    const text = '# My heading.\n\n- We learn together.\n1. Practice is useful!\n```js\nconst x = 3.2;\n```\nUse `npm ci` today.\nVisit https://example.com/a.b today.\nWe can improve.';
    const sentences = splitSentences(text);
    expect(sentences.map(s => s.text)).toEqual(['We learn together.', 'Practice is useful!', 'We can improve.']);
    expect(sentences.every(s => text.slice(s.from, s.to) === s.text)).toBe(true);
  });
  it('ignores unfinished fences, indentation and reference definitions', () => {
    expect(splitSentences('    code.example();\n[ref]: https://example.com\n```python\nHello.')).toEqual([]);
  });
  it('handles surrogate pairs and CRLF without drifting offsets', () => {
    const text = '😀 Learning helps.\r\n- We practice.';
    for (const s of splitSentences(text)) expect(text.slice(s.from, s.to)).toBe(s.text);
  });
  it('counts English words without common Markdown syntax or code', () => {
    expect(wordCount('# Title\n- **We** learn together.\n`ignored code`\nhttps://example.com\nDon’t give up.')).toBe(6);
  });
});
describe('checked replacement', () => {
  it('accepts only exact local text at the expected range', () => {
    expect(checkedReplacement('He go home.', 0, 11, 'He go home.', 'He goes home.')).toEqual({ from: 0, to: 11, insert: 'He goes home.' });
    expect(checkedReplacement('She goes home.', 0, 11, 'He go home.', 'He goes home.')).toBeNull();
    expect(checkedReplacement('Hi.', -1, 3, 'Hi.', 'Hello.')).toBeNull();
  });
});
