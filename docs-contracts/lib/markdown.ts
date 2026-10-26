export const FENCE = /^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```/gm;

export function fencedBlocks(text: string): string[] {
  return [...text.matchAll(FENCE)].map((match) => match[1]);
}

export function bashBlocks(text: string): string[] {
  return [...text.matchAll(/```bash\n([\s\S]*?)```/g)].map((match) => match[1]);
}

export function stripFences(text: string): string {
  return text.replace(FENCE, "");
}

export function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function section(text: string, start: string, end: string): string | null {
  const from = text.indexOf(start);
  if (from < 0) return null;
  const to = text.indexOf(end, from);
  return to < 0 ? null : text.slice(from, to);
}

export function shellWords(line: string): string[] {
  const words: string[] = [];
  let current = "";
  let quote: string | null = null;
  let started = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quote !== null) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && index + 1 < line.length) current += line[++index];
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (char === "\\" && index + 1 < line.length) {
      current += line[++index];
      started = true;
    } else if (char === "#" && !started) {
      break;
    } else if (/\s/.test(char)) {
      if (started) words.push(current);
      current = "";
      started = false;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote !== null) return line.split(/\s+/).filter(Boolean);
  if (started) words.push(current);
  return words;
}

export function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

export function tally<T>(values: Iterable<T>, key: (value: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[key(value)] = (counts[key(value)] ?? 0) + 1;
  return counts;
}

export function sameSet(left: Iterable<string>, right: Iterable<string>): { missing: string[]; extra: string[] } {
  const a = new Set(left);
  const b = new Set(right);
  return { missing: sorted([...b].filter((value) => !a.has(value))), extra: sorted([...a].filter((value) => !b.has(value))) };
}
