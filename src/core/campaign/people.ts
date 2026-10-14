import { z } from 'zod';
import { FileFormatError, formatFrontMatter, parseFrontMatter, readTimestamp, splitList } from '../frontMatter';
import type { Encounter } from '../model/encounter';

/**
 * People and places of a campaign: `campaigns/<id>/people-and-places/<id>.md` with a header (`name`, `kind`,
 * `picture` = file name next to it, `tags`, explicitly linked `encounters`, time stamps) and Markdown notes.
 */

const HEADER_KEYS = ['name', 'kind', 'picture', 'tags', 'encounters', 'createdAt', 'updatedAt'] as const;
const KINDS = ['person', 'place'] as const;
export type CastKind = (typeof KINDS)[number];

export interface CastEntry {
  id: string;
  name: string;
  kind: CastKind;
  /** File name of the picture in the same folder; null without one. */
  picture: string | null;
  tags: string[];
  /** Ids of encounters linked by hand; mentions by name are found on the fly. */
  encounters: string[];
  createdAt: string | null;
  updatedAt: string | null;
  notes: string;
}

export function parseCastFile(text: string, id: string): CastEntry {
  const header = parseFrontMatter(text, HEADER_KEYS);
  const kind = z.enum(KINDS).safeParse((header.values.kind || 'person').toLowerCase());
  if (!kind.success) {
    throw new FileFormatError('"kind" must be person or place', header.lines.kind!);
  }
  const picture = header.values.picture || null;
  if (picture !== null && /[/\\]/.test(picture)) {
    throw new FileFormatError('"picture" is a file name in the same folder, without folders', header.lines.picture!);
  }
  return {
    id,
    name: header.values.name || id,
    kind: kind.data,
    picture,
    tags: splitList(header.values.tags),
    encounters: splitList(header.values.encounters),
    createdAt: readTimestamp(header, 'createdAt'),
    updatedAt: readTimestamp(header, 'updatedAt'),
    notes: header.body,
  };
}

export function formatCastFile(entry: CastEntry): string {
  const header: [string, string][] = [
    ['name', entry.name],
    ['kind', entry.kind],
    ['picture', entry.picture ?? ''],
    ['tags', entry.tags.join(', ')],
    ['encounters', entry.encounters.join(', ')],
    ['createdAt', entry.createdAt ?? ''],
    ['updatedAt', entry.updatedAt ?? ''],
  ];
  return formatFrontMatter(header, entry.notes);
}

/** Linked by hand, or the name appears as a whole word in the encounter's name, notes or combatants. */
export function appearsIn(entry: CastEntry, encounter: Encounter): boolean {
  const escaped = entry.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const word = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'iu');
  const texts = [encounter.name, encounter.notes, ...encounter.combatants.flatMap((c) => [c.name, c.notes])];
  return entry.encounters.includes(encounter.id) || (escaped !== '' && texts.some((t) => word.test(t)));
}
