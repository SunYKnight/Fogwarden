import { CREATURE_TYPES, type Creature } from './model';

/** Picture shown for a creature without its own: one per creature type plus swarms. */
export const CREATURE_ICON_KEYS = [...CREATURE_TYPES, 'swarm'] as const;
export type CreatureIconKey = (typeof CREATURE_ICON_KEYS)[number];

// Most creatures in the compendium are people; an unknown type reads as one.
const DEFAULT_ICON: CreatureIconKey = 'humanoid';

/**
 * Icon for a creature type such as "beast" or "Humanoid (goblinoid)". `typeText` holds the rest of the type
 * line (subtype, tags); a swarm of tiny creatures gets the swarm icon whatever its members are.
 */
export function creatureTypeIcon(type: string, typeText = ''): CreatureIconKey {
  const text = `${type} ${typeText}`.toLowerCase();
  const named = CREATURE_TYPES.find((t) => new RegExp(`\\b${t}`).test(text));
  return /\bswarm\b/.test(text) ? 'swarm' : (named ?? DEFAULT_ICON);
}

/** Icon of a library creature; the importer marks swarms with the tag "swarm". */
export function creatureIconOf(creature: Pick<Creature, 'type' | 'subtype' | 'tags'>): CreatureIconKey {
  return creatureTypeIcon(creature.type, [creature.subtype, ...creature.tags].join(' '));
}
