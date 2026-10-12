import type { AssetRef } from './common';
import type { Creature } from './creature';

type Pictures = Pick<Creature, 'image' | 'token'>;

/** Picture on a combatant's token: its own token, else the creature's token, else the creature's image. */
export function resolveTokenAsset(combatantToken: AssetRef | null, creature: Pictures | null): AssetRef | null {
  return combatantToken ?? creature?.token ?? creature?.image ?? null;
}

/** Picture shown with a stat block: the general image before the token. */
export function creaturePortrait(creature: Pictures): AssetRef | null {
  return creature.image ?? creature.token;
}
