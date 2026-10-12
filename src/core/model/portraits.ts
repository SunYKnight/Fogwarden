import { z } from 'zod';
import { assetRefSchema, idSchema, type AssetRef } from './common';
import type { Creature } from './creature';

export const PORTRAITS_SCHEMA_VERSION = 1;

/** Pictures attached to a creature without editing its document (shipped creatures are read-only). */
export const portraitSchema = z.object({ image: assetRefSchema.nullable(), token: assetRefSchema.nullable() });
export type Portrait = z.infer<typeof portraitSchema>;

/** `library/portraits.json` in the data root: creature id → portrait. */
export const portraitIndexSchema = z.object({
  schema: z.literal('portraits'),
  version: z.number().int().positive(),
  portraits: z.record(idSchema, portraitSchema),
});
export type PortraitIndex = z.infer<typeof portraitIndexSchema>;
export type Portraits = PortraitIndex['portraits'];

type Pictures = Pick<Creature, 'image' | 'token'>;

/**
 * Picture on a combatant's token: its own token, else the creature's token or image, else the portrait
 * index; within each source the token picture beats the general image.
 */
export function resolveTokenAsset(
  combatantToken: AssetRef | null,
  creature: Pictures | null,
  portrait: Portrait | undefined,
): AssetRef | null {
  return combatantToken ?? creature?.token ?? creature?.image ?? portrait?.token ?? portrait?.image ?? null;
}

/** Picture shown with a stat block: the creature's own pictures first, the general image before the token. */
export function creaturePortrait(creature: Pictures, portrait: Portrait | undefined): AssetRef | null {
  return creature.image ?? creature.token ?? portrait?.image ?? portrait?.token ?? null;
}
