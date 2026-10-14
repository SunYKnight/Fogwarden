import { describe, expect, it } from 'vitest';
import { parseXml, textOf } from './xml';

describe('parseXml', () => {
  it('decodes character references and keeps ones past Unicode as written', () => {
    const root = parseXml('<a b="&#x41;&#1114112;">&#66;&#xFFFFFFFF;&amp;</a>');
    expect(root.attributes.b).toBe('A&#1114112;');
    expect(textOf(root)).toBe('B&#xFFFFFFFF;&');
  });
});
