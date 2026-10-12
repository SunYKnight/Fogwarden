import { slug } from './ids';

const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;

/** Match key of a file name or document id: extension and "source--" prefixes dropped, then slugged. */
export function portraitKey(name: string): string {
  return slug(name.replace(IMAGE_FILE, '').split('--').at(-1)!);
}

export interface PortraitCandidate {
  id: string;
  name: string;
}

export interface PortraitMatch {
  fileName: string;
  creatureId: string;
}

export interface PortraitMatching {
  /** One entry per matched creature, ordered by file name. */
  matches: PortraitMatch[];
  /** Image files no creature name or id fits. */
  unmatched: string[];
  /** Image files that fit, but every fitting creature already got a better or earlier file. */
  duplicates: string[];
}

/**
 * Pairs image files with creatures by normalized id, name or family name (case, diacritics, punctuation
 * and source prefixes ignored; suffixes such as "-hotd" still count). The family names of "Werewolf,
 * Human Form" and "Succubus/Incubus" are "werewolf", "succubus" and "incubus". A file fits every creature
 * sharing its key; id beats name beats family, otherwise the first file in sorted order wins. Files other
 * than PNG, JPEG and WebP are ignored.
 */
export function matchPortraits(
  fileNames: readonly string[],
  creatures: readonly PortraitCandidate[],
): PortraitMatching {
  const index = new Map<string, { id: string; rank: number }[]>();
  for (const creature of creatures) {
    const family = creature.name.split(',')[0]!.split('/');
    const keys = [
      { key: portraitKey(creature.id), rank: 3 },
      { key: slug(creature.name), rank: 2 },
      ...family.map((name) => ({ key: slug(name), rank: 1 })),
    ];
    for (const { key, rank } of keys.filter((k) => k.key !== '')) {
      index.set(key, [...(index.get(key) ?? []), { id: creature.id, rank }]);
    }
  }
  const chosen = new Map<string, { fileName: string; rank: number }>();
  const fitting: string[] = [];
  const unmatched: string[] = [];
  for (const fileName of fileNames.filter((f) => IMAGE_FILE.test(f)).sort()) {
    const hits = index.get(portraitKey(fileName)) ?? [];
    for (const hit of hits) {
      const best = chosen.get(hit.id);
      if (!best || hit.rank > best.rank) chosen.set(hit.id, { fileName, rank: hit.rank });
    }
    (hits.length > 0 ? fitting : unmatched).push(fileName);
  }
  const used = new Set([...chosen.values()].map((c) => c.fileName));
  const matches = [...chosen]
    .map(([creatureId, { fileName }]) => ({ fileName, creatureId }))
    .sort((a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));
  return { matches, unmatched, duplicates: fitting.filter((f) => !used.has(f)) };
}
