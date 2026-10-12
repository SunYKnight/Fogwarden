import { describe, expect, it } from 'vitest';
import type { AssetRef } from './common';
import { creaturePortrait, resolveTokenAsset } from './portraits';

const asset = (path: string): AssetRef => ({ area: 'data', path });
const COMBATANT = asset('combatant.png');
const CREATURE = { image: asset('creature-image.png'), token: asset('creature-token.png') };
const PORTRAIT = { image: asset('portrait-image.png'), token: asset('portrait-token.png') };

describe('resolveTokenAsset', () => {
  it('prefers combatant token, creature token, creature image, then the portrait index', () => {
    expect(resolveTokenAsset(COMBATANT, CREATURE, PORTRAIT)).toBe(COMBATANT);
    expect(resolveTokenAsset(null, CREATURE, PORTRAIT)).toBe(CREATURE.token);
    expect(resolveTokenAsset(null, { ...CREATURE, token: null }, PORTRAIT)).toBe(CREATURE.image);
    expect(resolveTokenAsset(null, { image: null, token: null }, PORTRAIT)).toBe(PORTRAIT.token);
    expect(resolveTokenAsset(null, null, { ...PORTRAIT, token: null })).toBe(PORTRAIT.image);
    expect(resolveTokenAsset(null, null, undefined)).toBeNull();
  });
});

describe('creaturePortrait', () => {
  it('shows the image before the token and the creature before the portrait index', () => {
    expect(creaturePortrait(CREATURE, PORTRAIT)).toBe(CREATURE.image);
    expect(creaturePortrait({ ...CREATURE, image: null }, PORTRAIT)).toBe(CREATURE.token);
    expect(creaturePortrait({ image: null, token: null }, PORTRAIT)).toBe(PORTRAIT.image);
    expect(creaturePortrait({ image: null, token: null }, undefined)).toBeNull();
  });
});
