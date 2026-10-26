export type Sentence = { id: string; text: string; from: number; to: number; complete: boolean };
type Span = { from: number; to: number };

/** A caret or selection must belong entirely to one existing feedback unit. */
export function singleSentenceAtRange<T extends Span>(sentences: T[], range: Span): T | undefined {
  if (range.from > range.to || range.from < 0) return;
  if (range.from === range.to) {
    return sentences.find(s => s.from <= range.from && range.from < s.to)
      ?? sentences.find(s => s.to === range.from);
  }
  return sentences.find(s => s.from <= range.from && range.to <= s.to);
}

/** Build exclusions against the original UTF-16 string, never normalized offsets. */
export function markdownExclusions(text: string): Span[] {
  const spans: Span[] = [];
  const addMatches = (re: RegExp) => { for (const m of text.matchAll(re)) spans.push({ from: m.index!, to: m.index! + m[0].length }); };
  // Fences may be unfinished while the user types.
  let fence: { char: string; size: number; from: number } | null = null;
  let offset = 0;
  for (const line of text.split(/(?<=\n)/)) {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) fence = { char: marker[1][0], size: marker[1].length, from: offset };
      else if (marker[1][0] === fence.char && marker[1].length >= fence.size) {
        spans.push({ from: fence.from, to: offset + line.length }); fence = null;
      }
    } else if (!fence && (/^\s{0,3}#{1,6}\s/.test(line) || /^(?: {4}|\t)/.test(line) || /^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line) || /^\s*\[[^\]]+\]:\s/.test(line))) {
      spans.push({ from: offset, to: offset + line.length });
    }
    offset += line.length;
  }
  if (fence) spans.push({ from: fence.from, to: text.length });
  addMatches(/(`+)[^\n]*?\1/g);
  addMatches(/https?:\/\/[^\s<>]+|www\.[^\s<>]+/gi);
  addMatches(/!\[[^\]]*\]\([^\n)]*\)/g);
  addMatches(/\]\([^\n)]*\)/g);
  addMatches(/^\s{0,3}(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm);
  addMatches(/^\s{0,3}>\s?/gm);
  return spans.sort((a, b) => a.from - b.from);
}

function boundary(text: string, i: number): boolean {
  const char = text[i];
  if (!'.?!'.includes(char)) return false;
  if (char === '.') {
    if (/\d/.test(text[i - 1] || '') && /\d/.test(text[i + 1] || '')) return false;
    if (text[i + 1] === '.' || text[i - 1] === '.') return false;
    const prefix = text.slice(Math.max(0, i - 20), i + 1);
    if (/\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|Fig|No|Inc|a\.m|p\.m|e\.g|i\.e)\.$/i.test(prefix)) return false;
    if (/(?:\b[A-Za-z]\.){1,}$/.test(prefix)) return false;
  }
  return !text[i + 1] || /[\s"'”’)]/.test(text[i + 1]);
}

/** Conservative: prose intersecting code/links is skipped, not spliced into fake sentences. */
export function splitSentences(text: string, mode: 'discussion' | 'email' | 'general' = 'general'): Sentence[] {
  const excluded = markdownExclusions(text);
  const mask = new Uint8Array(text.length);
  for (const span of excluded) mask.fill(1, span.from, span.to);
  const results: Sentence[] = [];
  let start = 0;
  const emit = (end: number, complete: boolean) => {
    let from = start, to = end;
    while (from < to && (mask[from] || /[\s*_\[>]/.test(text[from]))) from++;
    while (to > from && /[\s*_]/.test(text[to - 1])) to--;
    if (to <= from || !/[A-Za-z]/.test(text.slice(from, to))) return;
    // Inline code and URLs should not be sent as prose, or leave broken fragments.
    if (mask.slice(from, to).some(Boolean)) return;
    results.push({ id: '', text: text.slice(from, to), from, to, complete });
  };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      // An email salutation and its following opening sentence form one review
      // unit. Keep the exact newline/offsets, including CRLF and a blank line.
      const salutation = text.slice(start, i).trim();
      const next = text.slice(i + 1).match(/^(?:[ \t]*\r?\n)?[ \t]*([^\r\n]+)/)?.[1];
      const emailOpening = mode === 'email' && /^(?:(?:Dear|Hi|Hello|Hey)\b[^\r\n,]{0,100}|To whom it may concern),$/i.test(salutation);
      if (emailOpening && next && !/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|`|~{3})/.test(next) && !mask.slice(start, i).some(Boolean)) continue;
      emit(i, false); start = i + 1; continue;
    }
    if (!mask[i] && boundary(text, i)) {
      let end = i + 1;
      while (end < text.length && /["'”’)]/.test(text[end])) end++;
      emit(end, true); start = end; i = end - 1;
    }
  }
  emit(text.length, false);
  return results;
}

export function wordCount(text: string): number {
  const chars = text.split('');
  for (const s of markdownExclusions(text)) chars.fill(' ', s.from, s.to);
  return (chars.join('').match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;
}

export function checkedReplacement(text: string, from: number, to: number, original: string, replacement: string): { from: number; to: number; insert: string } | null {
  return from >= 0 && to <= text.length && text.slice(from, to) === original ? { from, to, insert: replacement } : null;
}
