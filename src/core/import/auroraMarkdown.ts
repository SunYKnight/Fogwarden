import { childElements, isElement, type XmlElement, type XmlNode } from '../xml';

/**
 * Aurora Builder descriptions are HTML-like XML (`p`, `h1`-`h6`, `ul`/`li`, `table`, `b`/`strong`, `i`/`em`,
 * `div class="reference"` pointing at other elements); this turns them into the Markdown `Markdown.tsx` renders.
 */

/** Name of the Aurora element with an id, for `div element="ID_…"` references. */
export type AuroraNameOf = (id: string) => string | undefined;

const INLINE_MARKS: Record<string, string> = { b: '**', strong: '**', i: '_', em: '_' };
const HEADING = /^h([1-6])$/;

/** Inline text of nodes: whitespace collapsed, bold and italic as Markdown marks. */
function inline(nodes: XmlNode[]): string {
  return nodes
    .map((node) => {
      let text: string;
      if (!isElement(node)) {
        text = node.replace(/\s+/g, ' ');
      } else if (node.name === 'br') {
        text = ' ';
      } else {
        const inner = inline(node.children);
        const mark = INLINE_MARKS[node.name];
        const trimmed = inner.trim();
        // Marks must touch the text, so outer spaces move outside them.
        text =
          mark && trimmed !== ''
            ? `${/^\s/.test(inner) ? ' ' : ''}${mark}${trimmed}${mark}${/\s$/.test(inner) ? ' ' : ''}`
            : inner;
      }
      return text;
    })
    .join('');
}

function tableRows(table: XmlElement): XmlElement[] {
  return childElements(table).flatMap((child) => (child.name === 'tr' ? [child] : tableRows(child)));
}

function tableMarkdown(table: XmlElement): string {
  const rows = tableRows(table).map((tr) =>
    childElements(tr).map((cell) => inline(cell.children).trim().replace(/\|/g, '/')),
  );
  const width = Math.max(0, ...rows.map((r) => r.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  const [head, ...body] = rows;
  return head ? [line(head), line(Array<string>(width).fill('---')), ...body.map(line)].join('\n') : '';
}

function blocks(nodes: XmlNode[], nameOf: AuroraNameOf): string[] {
  const out: string[] = [];
  let loose: XmlNode[] = [];
  const flush = () => {
    const text = inline(loose).trim();
    if (text !== '') {
      out.push(text);
    }
    loose = [];
  };
  for (const node of nodes) {
    const heading = isElement(node) ? HEADING.exec(node.name) : null;
    if (!isElement(node) || INLINE_MARKS[node.name] || ['span', 'a', 'br', 'u'].includes(node.name)) {
      loose.push(node);
    } else {
      flush();
      if (node.name === 'p') {
        out.push(inline(node.children).trim());
      } else if (heading) {
        out.push(`${'#'.repeat(Number(heading[1]))} ${inline(node.children).trim()}`);
      } else if (node.name === 'ul' || node.name === 'ol') {
        const items = childElements(node, 'li').map(
          (li) => `${node.name === 'ul' ? '-' : '1.'} ${inline(li.children).trim()}`,
        );
        out.push(items.join('\n'));
      } else if (node.name === 'table') {
        out.push(tableMarkdown(node));
      } else if (node.name === 'div' && node.attributes.class === 'reference') {
        const names = childElements(node).map((d) => nameOf(d.attributes.element ?? '') ?? d.attributes.element ?? '');
        out.push(...names.filter((n) => n !== '').map((n) => `See _${n}_.`));
      } else if (node.name === 'div' && node.attributes.class === 'sidebar') {
        out.push(...blocks(node.children, nameOf).map((b) => b.replace(/^/gm, '> ')));
      } else {
        out.push(...blocks(node.children, nameOf));
      }
    }
  }
  flush();
  return out.filter((b) => b.trim() !== '');
}

/** Markdown of an Aurora `description` element; empty without one. */
export function auroraMarkdown(description: XmlElement | undefined, nameOf: AuroraNameOf): string {
  return description ? blocks(description.children, nameOf).join('\n\n') : '';
}
