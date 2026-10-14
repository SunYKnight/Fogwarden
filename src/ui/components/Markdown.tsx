import { createElement, type ReactNode } from 'react';

/**
 * Preview of the Markdown the journal, people, places, quests, items and spells are written in: headings,
 * paragraphs, lists, quotes, rules, code, tables (`| a | b |` rows, the second may be `| --- |`), bold,
 * italic, links (shown, not followed). Rendered as React elements, so text from files never becomes HTML.
 */

// Underscores inside a word (snake_case_names) are text, not emphasis.
const UNDERSCORE_EM = String.raw`(?<![\p{L}\p{N}])_[^_\s][^_]*_(?![\p{L}\p{N}])`;
const INLINE_PARTS = [
  String.raw`\*\*[^*]+\*\*`,
  '__[^_]+__',
  String.raw`\*[^*\s][^*]*\*`,
  UNDERSCORE_EM,
  '`[^`]+`',
  String.raw`\[[^\]]+\]\([^)\s]+\)`,
];
const INLINE = new RegExp(`(${INLINE_PARTS.join('|')})`, 'gu');
const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const RULE = /^(-{3,}|\*{3,}|_{3,})$/;
const FENCE = /^```/;
const TABLE_ROW = /^(\s*\|.*\|\s*)$/;
const TABLE_RULE = /^\s*\|[\s:|-]*-[\s:|-]*\|\s*$/;

function cells(row: string): string[] {
  return row
    .trim()
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());
}

function table(rows: string[], key: number): ReactNode {
  const headed = rows.length > 1 && TABLE_RULE.test(rows[1]!);
  const head = headed ? cells(rows[0]!) : null;
  const body = (headed ? rows.slice(2) : rows).filter((r) => !TABLE_RULE.test(r)).map(cells);
  return (
    <table key={key}>
      {head && (
        <thead>
          <tr>
            {head.map((c, i) => (
              <th key={i}>{inline(c)}</th>
            ))}
          </tr>
        </thead>
      )}
      <tbody>
        {body.map((row, i) => (
          <tr key={i}>
            {row.map((c, j) => (
              <td key={j}>{inline(c)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    let node: ReactNode = part;
    if (/^(\*\*|__).+\1$/.test(part)) {
      node = <strong key={i}>{inline(part.slice(2, -2))}</strong>;
    } else if (/^(\*|_).+\1$/.test(part)) {
      node = <em key={i}>{inline(part.slice(1, -1))}</em>;
    } else if (/^`.+`$/.test(part)) {
      node = <code key={i}>{part.slice(1, -1)}</code>;
    } else if (link) {
      node = (
        <span key={i} className="md-link" title={link[2]}>
          {inline(link[1]!)}
        </span>
      );
    }
    return node;
  });
}

/** Lines from `start` while `pattern` matches, with the captured text of each. */
function run(lines: string[], start: number, pattern: RegExp): string[] {
  const items: string[] = [];
  let i = start;
  while (i < lines.length && pattern.test(lines[i]!)) {
    items.push(pattern.exec(lines[i]!)![1]!);
    i += 1;
  }
  return items;
}

function blocks(text: string): ReactNode[] {
  const lines = text.split(/\r?\n/);
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const heading = HEADING.exec(line);
    const key = out.length;
    if (line.trim() === '') {
      i += 1;
    } else if (FENCE.test(line)) {
      const end = lines.findIndex((l, j) => j > i && FENCE.test(l));
      const stop = end === -1 ? lines.length : end;
      out.push(
        <pre key={key}>
          <code>{lines.slice(i + 1, stop).join('\n')}</code>
        </pre>,
      );
      i = stop + 1;
    } else if (heading) {
      out.push(createElement(`h${heading[1]!.length}`, { key }, inline(heading[2]!)));
      i += 1;
    } else if (RULE.test(line.trim())) {
      out.push(<hr key={key} />);
      i += 1;
    } else if (QUOTE.test(line)) {
      const quoted = run(lines, i, QUOTE);
      out.push(<blockquote key={key}>{inline(quoted.join(' '))}</blockquote>);
      i += quoted.length;
    } else if (TABLE_ROW.test(line)) {
      const rows = run(lines, i, TABLE_ROW);
      out.push(table(rows, key));
      i += rows.length;
    } else if (BULLET.test(line) || NUMBERED.test(line)) {
      const ordered = !BULLET.test(line);
      const items = run(lines, i, ordered ? NUMBERED : BULLET);
      const children = items.map((item, j) => <li key={j}>{inline(item)}</li>);
      out.push(ordered ? <ol key={key}>{children}</ol> : <ul key={key}>{children}</ul>);
      i += items.length;
    } else {
      const start = i;
      i += 1;
      const blockStarts = [HEADING, BULLET, NUMBERED, QUOTE, RULE, FENCE, TABLE_ROW];
      while (i < lines.length && lines[i]!.trim() !== '' && !blockStarts.some((p) => p.test(lines[i]!))) {
        i += 1;
      }
      out.push(<p key={key}>{inline(lines.slice(start, i).join(' '))}</p>);
    }
  }
  return out;
}

export function Markdown({ text, empty }: { text: string; empty: string }) {
  return <div className="markdown">{text.trim() === '' ? <p className="muted">{empty}</p> : blocks(text)}</div>;
}
