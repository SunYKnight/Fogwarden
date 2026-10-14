/**
 * Text files with an optional header between `---` lines (`key: value`, one per line), then free text
 * (Markdown, table entries). Used by journal entries, people and places, quests and random tables.
 */

const DELIMITER = '---';
const HEADER_LINE = /^([A-Za-z][\w-]*)\s*:(.*)$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

export class FileFormatError extends Error {
  constructor(
    message: string,
    /** 1-based line number in the file. */
    readonly line: number,
    options?: ErrorOptions,
  ) {
    super(`Line ${line}: ${message}`, options);
    this.name = 'FileFormatError';
  }
}

export interface FrontMatter<K extends string> {
  values: Partial<Record<K, string>>;
  /** Header line number of each key, for errors about its value. */
  lines: Partial<Record<K, number>>;
  body: string;
  /** 1-based line number of the first body line. */
  bodyLine: number;
}

/** Splits header and body; keys outside `keys` (case-insensitive) and duplicates are errors naming the line. */
export function parseFrontMatter<K extends string>(text: string, keys: readonly K[]): FrontMatter<K> {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const hasHeader = lines[0]?.trimEnd() === DELIMITER;
  const close = hasHeader ? lines.findIndex((l, i) => i > 0 && l.trimEnd() === DELIMITER) : -1;
  if (hasHeader && close === -1) {
    throw new FileFormatError(`Header is not closed by "${DELIMITER}"`, 1);
  }
  const byLower = new Map(keys.map((k) => [k.toLowerCase(), k]));
  const values: Partial<Record<K, string>> = {};
  const keyLines: Partial<Record<K, number>> = {};
  lines.slice(1, Math.max(1, close)).forEach((line, i) => {
    const number = i + 2;
    const match = HEADER_LINE.exec(line);
    const key = match ? byLower.get(match[1]!.toLowerCase()) : undefined;
    if (line.trim() !== '' && !match) {
      throw new FileFormatError('Expected "key: value" in the header', number);
    }
    if (match && key === undefined) {
      throw new FileFormatError(`Unknown header key "${match[1]}"; known: ${keys.join(', ')}`, number);
    }
    if (key !== undefined && values[key] !== undefined) {
      throw new FileFormatError(`Duplicate header key "${match![1]}"`, number);
    }
    if (key !== undefined) {
      values[key] = match![2]!.trim();
      keyLines[key] = number;
    }
  });
  const bodyStart = hasHeader ? close + 1 : 0;
  const body = lines.slice(bodyStart).join('\n').replace(/\n$/, '');
  return { values, lines: keyLines, body, bodyLine: bodyStart + 1 };
}

/** Header entries with an empty value are left out; the file ends with the body plus one newline. */
export function formatFrontMatter(header: [string, string][], body: string): string {
  const lines = header.filter(([, value]) => value !== '').map(([key, value]) => `${key}: ${value}`);
  const multiLine = header.find(([, value]) => /[\r\n]/.test(value));
  if (multiLine) {
    throw new Error(`Header "${multiLine[0]}" must fit on one line`);
  }
  // parseFrontMatter strips exactly this one newline again.
  return `${[DELIMITER, ...lines, DELIMITER].join('\n')}\n${body}\n`;
}

/** Comma separated header list, e.g. `tags: noble, waterdeep`. */
export function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/** Header value that must be an ISO time stamp; null when the key is missing. */
export function readTimestamp<K extends string>(header: FrontMatter<K>, key: K): string | null {
  const value = header.values[key];
  if (value !== undefined && (!ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value)))) {
    throw new FileFormatError(`"${key}" must be a date and time like 2026-10-12T19:30:00.000Z`, header.lines[key]!);
  }
  return value ?? null;
}
