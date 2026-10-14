import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CREATURE_SCHEMA_VERSION, createCreature, type Creature } from '../model';
import { formatCreatureFile, formatStatBlock, parseCreatureFile } from './creatureFile';
import { srdCreature } from './dnd5eApi';
import { FIXTURE_MONSTERS } from './fixtures/dnd5eApiMonsters';
import { parseStatBlock, StatBlockError } from './statblock';

const CREATED = '2024-01-02T03:04:05.000Z';
const UPDATED = '2024-02-03T04:05:06.000Z';

const BASE: Creature = { ...createCreature('Test Knight'), id: 'test-knight', createdAt: CREATED, updatedAt: UPDATED };

/** Checks both round trip directions and returns the file text. */
function expectRoundTrip(creature: Creature): string {
  const text = formatCreatureFile(creature);
  const parsed = parseCreatureFile(text, creature.id);
  expect(parsed).toStrictEqual({ ...creature, version: CREATURE_SCHEMA_VERSION });
  expect(formatCreatureFile(parsed)).toBe(text);
  return text;
}

function headerOf(text: string): string[] {
  return text.slice(0, text.indexOf('\n---\n')).split('\n').slice(1);
}

describe('creature files of D&D 5e API monsters', () => {
  it.each(FIXTURE_MONSTERS.map((m) => m.index))('%s reads and writes back byte for byte', (index) => {
    const creature = srdCreature(FIXTURE_MONSTERS.find((m) => m.index === index)!);
    const text = formatCreatureFile(creature);
    const parsed = parseCreatureFile(text, creature.id);
    expect(parsed).toMatchObject({ id: `srd-${index}`, image: null, token: null, version: CREATURE_SCHEMA_VERSION });
    expect(formatCreatureFile(parsed)).toBe(text);
    expect(parseCreatureFile(formatCreatureFile(parsed), creature.id)).toStrictEqual(parsed);
  });
});

describe('formatCreatureFile header', () => {
  it('writes fields the stat block has no place for, notes as an indented block', () => {
    const text = expectRoundTrip({
      ...BASE,
      kind: 'npc',
      source: 'Homebrew',
      license: 'personal',
      tags: ['knight', 'boss'],
      notes: 'Leads the guard.\n\n  Never retreats.',
    });
    expect(headerOf(text)).toEqual([
      'kind: npc',
      'source: Homebrew',
      'license: personal',
      'tags: knight, boss',
      `createdAt: ${CREATED}`,
      `updatedAt: ${UPDATED}`,
      'notes:',
      '  Leads the guard.',
      '',
      '    Never retreats.',
    ]);
    expect(text.split('\n---\n')[1]).toBe(`${formatStatBlock(BASE)}\n`);
  });

  it('keeps an XP value that is not the challenge default in the stat block', () => {
    const text = expectRoundTrip({ ...BASE, challenge: 2, xp: 500 });
    expect(text).toContain('\nChallenge 2 (500 XP)\n');
    expect(headerOf(text).some((l) => l.startsWith('xp'))).toBe(false);
  });

  it('falls back to header values for data the stat block text cannot hold', () => {
    const text = expectRoundTrip({
      ...BASE,
      name: ' Spaced ',
      size: 'large',
      alignmentText: 'typically chaotic evil',
      alignmentWeights: { 'chaotic-evil': 0.8, 'neutral-evil': 0.2 },
      armorClass: -1,
      speeds: {},
      hitPoints: { average: 10, formula: 'lots' },
      tags: ['a, b'],
      source: '"Quoted"',
      legendaryDescription: 'Line one\r\nline two',
    });
    expect(headerOf(text)).toEqual(
      expect.arrayContaining([
        'source: "\\"Quoted\\""',
        'tags: ["a, b"]',
        'name: " Spaced "',
        'size: large',
        'alignmentText: typically chaotic evil',
        'alignmentWeights: {"chaotic-evil":0.8,"neutral-evil":0.2}',
        'armorClass: -1',
        'hitPoints: {"average":10,"formula":"lots"}',
        'speeds: {}',
        'legendaryDescription: "Line one\\r\\nline two"',
      ]),
    );
  });
});

describe('formatCreatureFile stat block', () => {
  it('writes bonus actions, reactions and legendary actions as stat block sections', () => {
    const creature: Creature = {
      ...BASE,
      source: '',
      actions: [{ name: 'Multiattack', description: 'The knight attacks twice.', attack: null }],
      bonusActions: [
        {
          name: 'Shield Bash',
          description: 'Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 5 (1d4 + 3) bludgeoning damage.',
          attack: {
            kind: 'melee-weapon',
            toHit: 5,
            reachFt: 5,
            rangeFt: null,
            targets: 'one target',
            damage: [{ formula: '1d4+3', type: 'bludgeoning' }],
          },
        },
      ],
      reactions: [{ name: 'Parry', description: 'The knight adds 2 to its AC against one melee attack.' }],
      legendaryDescription: 'The knight can take 2 legendary actions.\nIt regains them at the start of its turn.',
      legendaryActions: [
        { name: 'Move', description: 'The knight moves.', cost: 1 },
        { name: 'Charge', description: 'The knight moves and attacks.', cost: 2 },
      ],
    };
    const text = expectRoundTrip(creature);
    expect(headerOf(text)).toEqual([`createdAt: ${CREATED}`, `updatedAt: ${UPDATED}`]);
    expect(text).toContain('\nBonus Actions\n\nShield Bash. Melee Weapon Attack: +5 to hit');
    expect(text).toContain('\nReactions\n\nParry. The knight adds 2');
    expect(text).toContain(
      '\nLegendary Actions\n\nThe knight can take 2 legendary actions.\n  It regains them at the start of its turn.\n',
    );
    expect(text).toContain('\nCharge (Costs 2 Actions). The knight moves and attacks.\n');
    expect(parseStatBlock(formatStatBlock(creature), { exact: true }).bonusActions).toEqual(creature.bonusActions);
  });

  it('writes attack data the description does not show as an attack line', () => {
    const text = expectRoundTrip({
      ...BASE,
      actions: [
        {
          name: 'Bite',
          description: 'The knight bites.',
          attack: {
            kind: 'melee-or-ranged',
            toHit: -1,
            reachFt: 5,
            rangeFt: { normal: 20, long: 60 },
            targets: 'one target',
            damage: [
              { formula: '1d6+3', type: 'piercing' },
              { formula: '2', type: 'fire' },
            ],
          },
        },
      ],
    });
    expect(text).toContain(
      '\nBite. The knight bites.\n[Melee or Ranged Weapon Attack: -1 to hit, reach 5 ft. or range 20/60 ft., ' +
        'one target. Hit: 6 (1d6+3) piercing damage plus 2 (2) fire damage.]\n',
    );
    expect(headerOf(text).some((l) => l.startsWith('actions'))).toBe(false);
  });

  it('keeps entry text exactly as written, odd text as a JSON string', () => {
    const text = expectRoundTrip({
      ...BASE,
      traits: [
        { name: 'claws of the deep', description: 'Recharge 5\u20136 \u2014 see below.' },
        { name: 'Layered', description: 'Line one.\n\nActions\nFoo. Bar.' },
        { name: 'Bare Name', description: '' },
        { name: 'Windows', description: 'a\r\nb' },
        { name: 'Quoted', description: '"Hello"' },
      ],
    });
    expect(text).toContain('\nclaws of the deep. Recharge 5\u20136 \u2014 see below.\n');
    expect(text).toContain('\nLayered. Line one.\n\n  Actions\n  Foo. Bar.\n');
    expect(text).toContain('\nBare Name.\n');
    expect(text).toContain('\nWindows. "a\\r\\nb"\n');
    expect(text).toContain('\nQuoted. "\\"Hello\\""\n');
    expect(headerOf(text).some((l) => l.startsWith('traits'))).toBe(false);
  });
});

describe('parseCreatureFile', () => {
  const statBlock = formatStatBlock(BASE);

  it('reads hand-edited headers: CRLF, extra whitespace, any key case, blank lines', () => {
    const text = [
      '---  ',
      'Kind :   npc  ',
      '',
      'tags: a ,b',
      'notes:',
      '    line one',
      '',
      '    line two',
      '',
      '---',
      statBlock,
    ].join('\r\n');
    expect(parseCreatureFile(text, 'x')).toMatchObject({
      id: 'x',
      kind: 'npc',
      tags: ['a', 'b'],
      notes: 'line one\n\nline two',
      name: 'Test Knight',
    });
  });

  it('reads a plain stat block without header with defaults', () => {
    const text = readFileSync(join(import.meta.dirname, 'fixtures', 'goblin.txt'), 'utf8');
    const goblin = parseCreatureFile(text, 'goblin');
    const { id: _id, createdAt: _c, updatedAt: _u, ...plain } = parseStatBlock(text);
    expect(goblin).toMatchObject({
      ...plain,
      id: 'goblin',
      schema: 'creature',
      version: CREATURE_SCHEMA_VERSION,
      kind: 'monster',
      image: null,
      token: null,
    });
  });

  it('names the header line of unknown keys, bad values and unclosed headers', () => {
    const read = (header: string) => () => parseCreatureFile(`---\n${header}\n---\n${statBlock}`, 'x');
    expect(read('colour: red')).toThrow('Unknown header key "colour"');
    expect(read('colour: red')).toThrow(expect.objectContaining({ lineNumber: 2, line: 'colour: red' }));
    expect(read('kind: npc\nxp: lots')).toThrow(expect.objectContaining({ lineNumber: 3, line: 'xp: lots' }));
    expect(read('kind: dragon')).toThrow(/Invalid value for "kind"/);
    expect(read('kind: npc\nkind: player')).toThrow('Duplicate header key');
    expect(read('kind: npc\n  extra')).toThrow('Unexpected indented header line');
    expect(() => parseCreatureFile(`---\nkind: npc\n${statBlock}`, 'x')).toThrow(StatBlockError);
  });

  it('reports stat block errors with file line numbers', () => {
    const broken = `---\nkind: npc\n---\n${statBlock.replace('Medium humanoid', 'Smallish humanoid')}`;
    expect(() => parseCreatureFile(broken, 'x')).toThrow(expect.objectContaining({ lineNumber: 5 }));
  });
});
