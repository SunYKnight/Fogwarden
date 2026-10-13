import { describe, expect, it } from 'vitest';
import { matchScore, rankCommands, type Searchable } from './commandMatch';

const entry = (label: string, group = 'Go to', keywords: string[] = []): Searchable => ({ label, group, keywords });
const labels = (entries: Searchable[]) => entries.map((e) => e.label);

describe('matchScore', () => {
  it('ranks a prefix over a word start over a substring over scattered letters', () => {
    const prefix = matchScore('Next turn', 'ne')!;
    const wordStart = matchScore('Start combat', 'com')!;
    const substring = matchScore('Settings', 'tin')!;
    const scattered = matchScore('Next turn', 'nt')!;
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(scattered);
  });

  it('prefers scattered letters on word starts', () => {
    expect(matchScore('Roll initiative', 'ri')!).toBeGreaterThan(matchScore('Brigand', 'bd')!);
  });

  it('is null when a letter is missing or out of order', () => {
    expect(matchScore('Measure', 'mz')).toBeNull();
    expect(matchScore('Measure', 'em')).toBeNull();
  });
});

describe('rankCommands', () => {
  it('keeps every entry in order for an empty query', () => {
    const entries = [entry('Home'), entry('Maps'), entry('Play')];
    expect(labels(rankCommands(entries, '  '))).toEqual(['Home', 'Maps', 'Play']);
  });

  it('drops entries missing a word and puts the best match first', () => {
    const entries = [entry('Stop LAN'), entry('Start LAN'), entry('Start combat'), entry('Settings › Players')];
    expect(labels(rankCommands(entries, 'start'))).toEqual(['Start LAN', 'Start combat']);
    expect(labels(rankCommands(entries, 'lan st'))).toEqual(['Stop LAN', 'Start LAN']);
  });

  it('breaks ties by the shorter label, then by the given order', () => {
    const entries = [entry('Goblin Boss', 'Creature'), entry('Goblin', 'Creature'), entry('Gobbo', 'Map')];
    expect(labels(rankCommands(entries, 'gob'))).toEqual(['Gobbo', 'Goblin', 'Goblin Boss']);
  });

  it('finds entries by group and keywords, below label hits', () => {
    const entries = [entry('Settings › Players', 'Go to', ['lan', 'port']), entry('Start LAN', 'Players')];
    expect(labels(rankCommands(entries, 'lan'))).toEqual(['Start LAN', 'Settings › Players']);
    expect(labels(rankCommands([entry('Goblin', 'Creature')], 'creature gob'))).toEqual(['Goblin']);
  });

  it('lists scattered-letter matches only when no entry contains the words', () => {
    const entries = [entry('Red Dragon Wyrmling', 'Creature'), entry('Weather: Rain', 'Play')];
    expect(labels(rankCommands(entries, 'rain'))).toEqual(['Weather: Rain']);
    expect(labels(rankCommands(entries, 'rdw'))).toEqual(['Red Dragon Wyrmling']);
  });
});
