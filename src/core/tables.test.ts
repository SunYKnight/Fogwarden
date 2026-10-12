import { describe, expect, it } from 'vitest';
import { FileFormatError } from './frontMatter';
import { findTable, formatTableFile, parseTableFile, rollOnTable, type RandomTable } from './tables';

/** Rng whose next value makes a die of `sides` show `face`. */
function faces(sides: number, ...shown: number[]): () => number {
  const queue = [...shown];
  return () => (queue.shift()! - 1 + 0.5) / sides;
}

function rollWith(table: RandomTable, rng: () => number, tables: RandomTable[] = [table]): string {
  return rollOnTable(table, { rng, find: (ref) => findTable(tables, ref) }).text;
}

describe('random table files', () => {
  it('reads plain lines as equally weighted and names the table after its file', () => {
    const table = parseTableFile('Prancing Pony\n# comment\n\nYawning Portal\n', 'tavern-names');
    expect(table.name).toBe('Tavern names');
    expect(table.kind).toBe('weights');
    expect(table.entries.map((e) => [e.text, e.weight])).toEqual([
      ['Prancing Pony', 1],
      ['Yawning Portal', 1],
    ]);
  });

  it('picks weighted entries in proportion to their weight', () => {
    const table = parseTableFile('3: Goblins\nOgre\n', 'monsters');
    expect(table.kind).toBe('weights');
    // Four tickets: 1-3 are goblins, 4 is the ogre.
    expect(rollWith(table, faces(4, 1))).toBe('Goblins');
    expect(rollWith(table, faces(4, 3))).toBe('Goblins');
    expect(rollWith(table, faces(4, 4))).toBe('Ogre');
  });

  it('reads dice ranges, 00 as 100, and rolls 1d<highest>', () => {
    const table = parseTableFile('01-50: Copper\n51-95: Silver\n96-00: Gold\n', 'coins');
    expect(table.kind).toBe('dice');
    expect(table.entries.map((e) => [e.from, e.to])).toEqual([
      [1, 50],
      [51, 95],
      [96, 100],
    ]);
    const roll = rollOnTable(table, { rng: faces(100, 96), find: () => undefined });
    expect(roll).toEqual({ tableName: 'Coins', text: 'Gold', detail: '1d100: 96' });
  });

  it('treats numbers 1, 2, 3 on every line as a die, not as weights', () => {
    const table = parseTableFile('1: North\n2: East\n3: South\n4: West\n', 'wind');
    expect(table.kind).toBe('dice');
    expect(rollWith(table, faces(4, 3))).toBe('South');
  });

  it('rolls the dice of the header on tables that start above 1', () => {
    const table = parseTableFile('---\ndice: 2d6\n---\n2-6: Calm\n7: Rain\n8-12: Storm\n', 'weather');
    expect(table.dice).toBe('2d6');
    expect(rollWith(table, faces(6, 3, 4))).toBe('Rain');
  });

  it('names the line of gaps, missing numbers and a die that does not fit', () => {
    const errors = [
      ['1-3: a\n5-6: b', 2],
      ['1-3: a\nplain', 2],
      ['---\ndice: 1d6\n---\n1-4: a\n5-8: b', 2],
      ['2-6: a\n7-12: b', 1],
    ] as const;
    errors.forEach(([text, line]) => {
      expect(() => parseTableFile(text, 't')).toThrow(FileFormatError);
      expect(() => parseTableFile(text, 't')).toThrow(`Line ${line}:`);
    });
  });

  it('keeps comments and the header through format and parse', () => {
    const text = [
      '---',
      'name: Loot',
      'createdAt: 2026-10-12T19:00:00.000Z',
      'updatedAt: 2026-10-12T19:00:00.000Z',
      '---',
      '# coins first',
      '2: [2d6] gp',
      'A [Gem]',
      '',
    ].join('\n');
    expect(formatTableFile(parseTableFile(text, 'loot'))).toBe(text);
  });
});

describe('nested references', () => {
  const gems = parseTableFile('Ruby\n', 'gems');
  const loot = parseTableFile('---\nname: Loot\n---\nA [gems] and [2d6] gp\n', 'loot');

  it('rolls on the referenced table by id or name and rolls bracketed dice', () => {
    expect(rollWith(loot, faces(6, 1, 1, 3, 4), [loot, gems])).toBe('A Ruby and 7 gp');
  });

  it('reports a reference to a missing table', () => {
    expect(() => rollWith(loot, () => 0, [loot])).toThrow('[gems]');
  });

  it('stops tables that refer to each other in a loop', () => {
    const ping = parseTableFile('[pong]\n', 'ping');
    const pong = parseTableFile('[ping]\n', 'pong');
    expect(() => rollWith(ping, () => 0, [ping, pong])).toThrow('refer to each other');
  });
});
