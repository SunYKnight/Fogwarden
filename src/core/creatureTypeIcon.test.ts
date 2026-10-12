import { describe, expect, it } from 'vitest';
import { creatureIconOf, creatureTypeIcon } from './creatureTypeIcon';
import { CREATURE_TYPES } from './model';

describe('creatureTypeIcon', () => {
  it('gives every creature type its own icon', () => {
    expect(CREATURE_TYPES.map((t) => creatureTypeIcon(t))).toEqual([...CREATURE_TYPES]);
  });

  it('ignores case and subtype text', () => {
    expect(creatureTypeIcon('Humanoid (goblinoid)')).toBe('humanoid');
    expect(creatureTypeIcon('FIEND', '(demon)')).toBe('fiend');
  });

  it('shows swarms as a swarm whatever their members are', () => {
    expect(creatureTypeIcon('swarm of Tiny beasts')).toBe('swarm');
    expect(creatureTypeIcon('beast', 'swarm')).toBe('swarm');
    expect(creatureIconOf({ type: 'beast', subtype: '', tags: ['swarm'] })).toBe('swarm');
    expect(creatureIconOf({ type: 'undead', subtype: '', tags: ['skeleton'] })).toBe('undead');
  });

  it('falls back to the humanoid icon for unknown types', () => {
    expect(creatureTypeIcon('')).toBe('humanoid');
    expect(creatureTypeIcon('vehicle')).toBe('humanoid');
  });
});
