/**
 * Minimal XML reader for import formats (Aurora Builder): elements, attributes, text, CDATA, comments and
 * the five named entities plus numeric references. No namespaces, no DTDs; the web worker-free core needs
 * no DOM, so tests run in node.
 */

export interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

export class XmlError extends Error {
  constructor(message: string, offset: number) {
    super(`${message} at character ${offset}`);
    this.name = 'XmlError';
  }
}

const NAMED_ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;
const TAG = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/y;
const ATTRIBUTE = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, ref: string) => {
    const lower = ref.toLowerCase();
    let decoded = NAMED_ENTITIES[lower] ?? whole;
    if (lower.startsWith('#x')) {
      decoded = String.fromCodePoint(parseInt(lower.slice(2), 16));
    } else if (lower.startsWith('#')) {
      decoded = String.fromCodePoint(parseInt(lower.slice(1), 10));
    }
    return decoded;
  });
}

function readAttributes(text: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of text.matchAll(ATTRIBUTE)) {
    attributes[match[1]!] = decodeEntities(match[2] ?? match[3] ?? '');
  }
  return attributes;
}

/** Where the markup starting at `at` ends (exclusive), for comments, CDATA and declarations. */
function skipEnd(text: string, at: number, close: string): number {
  const end = text.indexOf(close, at);
  if (end === -1) {
    throw new XmlError(`Missing "${close}"`, at);
  }
  return end + close.length;
}

/** The document's root element; text outside it is ignored. */
export function parseXml(text: string): XmlElement {
  const document: XmlElement = { name: '#document', attributes: {}, children: [] };
  const stack: XmlElement[] = [document];
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf('<', at);
    const textEnd = open === -1 ? text.length : open;
    if (textEnd > at && stack.length > 1) {
      stack.at(-1)!.children.push(decodeEntities(text.slice(at, textEnd)));
    }
    if (open === -1) {
      at = text.length;
    } else if (text.startsWith('<!--', open)) {
      at = skipEnd(text, open, '-->');
    } else if (text.startsWith('<![CDATA[', open)) {
      at = skipEnd(text, open, ']]>');
      stack.at(-1)!.children.push(text.slice(open + '<![CDATA['.length, at - ']]>'.length));
    } else if (text.startsWith('<?', open) || text.startsWith('<!', open)) {
      at = skipEnd(text, open, '>');
    } else {
      TAG.lastIndex = open;
      const match = TAG.exec(text);
      if (!match) {
        throw new XmlError('Malformed tag', open);
      }
      const [whole, closing, name, attributeText, selfClosing] = match;
      at = open + whole.length;
      if (closing) {
        if (stack.length < 2 || stack.at(-1)!.name !== name) {
          throw new XmlError(`Unexpected </${name}>`, open);
        }
        stack.pop();
      } else {
        const element: XmlElement = { name: name!, attributes: readAttributes(attributeText!), children: [] };
        stack.at(-1)!.children.push(element);
        if (!selfClosing) {
          stack.push(element);
        }
      }
    }
  }
  const root = document.children.find((c): c is XmlElement => typeof c !== 'string');
  if (stack.length > 1 || !root) {
    throw new XmlError(stack.length > 1 ? `<${stack.at(-1)!.name}> is not closed` : 'No root element', text.length);
  }
  return root;
}

export function isElement(node: XmlNode): node is XmlElement {
  return typeof node !== 'string';
}

/** Child elements, all or those named `name`. */
export function childElements(element: XmlElement, name?: string): XmlElement[] {
  return element.children.filter((c): c is XmlElement => isElement(c) && (name === undefined || c.name === name));
}

export function firstChild(element: XmlElement, name: string): XmlElement | undefined {
  return childElements(element, name)[0];
}

/** Text of the element and its descendants, trimmed. */
export function textOf(element: XmlElement | undefined): string {
  const collect = (node: XmlNode): string => (isElement(node) ? node.children.map(collect).join('') : node);
  return element ? collect(element).trim() : '';
}

/** Every element below `element` (depth first, document order). */
export function descendants(element: XmlElement): XmlElement[] {
  return childElements(element).flatMap((c) => [c, ...descendants(c)]);
}
