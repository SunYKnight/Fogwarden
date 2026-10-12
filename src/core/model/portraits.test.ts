import { describe, expect, it } from 'vitest';
import type { AssetRef } from './common';
import { creaturePortrait, resolveTokenAsset } from './portraits';

const asset = (path: string): AssetRef => ({ area: 'data', path });
const COMBATANT = asset('combatant.png');
const CREATURE = { image: asset('goblin.png'), token: asset('goblin.token.png') };

describe('resolveTokenAsset', () => {
  it('prefers combatant token, creature token, then creature image', () => {
    expect(resolveTokenAsset(COMBATANT, CREATURE)).toBe(COMBATANT);
    expect(resolveTokenAsset(null, CREATURE)).toBe(CREATURE.token);
    expect(resolveTokenAsset(null, { ...CREATURE, token: null })).toBe(CREATURE.image);
    expect(resolveTokenAsset(null, null)).toBeNull();
  });
});

describe('creaturePortrait', () => {
  it('shows the image before the token', () => {
    expect(creaturePortrait(CREATURE)).toBe(CREATURE.image);
    expect(creaturePortrait({ ...CREATURE, image: null })).toBe(CREATURE.token);
    expect(creaturePortrait({ image: null, token: null })).toBeNull();
  });
});
