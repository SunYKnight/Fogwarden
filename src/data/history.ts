import { z } from 'zod';
import { parseJournalFile } from '@/core/campaign/journal';
import { parseCastFile } from '@/core/campaign/people';
import { parseQuestFile } from '@/core/campaign/quests';
import { parseCreatureFile } from '@/core/import/creatureFile';
import { parseItemFile } from '@/core/items';
import { parseSpellFile } from '@/core/spells';
import { parseTableFile } from '@/core/tables';
import type { Storage } from './storage';

/**
 * Version history of the data root (desktop: `src-tauri/src/history.rs`). Before a write replaces or removes a
 * file, its previous content is kept in `history/<YYYY-MM-DD>/<path>` (first version per file and day);
 * restores keep what they replace in `history/<YYYY-MM-DD> <HH-MM-SS> before restore/`.
 */
export const HISTORY_DIR = 'history';

/** True for data area paths inside the history (any case: Windows paths ignore it). */
export function isHistoryPath(path: string): boolean {
  return (
    path
      .split('/')
      .find((part) => part !== '' && part !== '.')
      ?.toLowerCase() === HISTORY_DIR
  );
}

export interface HistoryFile {
  /** Path in the data root, '/'-separated. */
  path: string;
  bytes: number;
}

export interface HistoryFolder {
  /** `YYYY-MM-DD`, or `YYYY-MM-DD HH-MM-SS before restore`; names sort by time. */
  name: string;
  files: HistoryFile[];
}

export interface HistoryListing {
  /** Oldest first. */
  folders: HistoryFolder[];
  /** Disk space of the whole history, every stored content counted once. */
  bytes: number;
}

export interface RestoreFile {
  folder: string;
  path: string;
}

export type HistoryKind =
  | 'settings'
  | 'creature'
  | 'marker'
  | 'map'
  | 'table'
  | 'item'
  | 'spell'
  | 'sounds'
  | 'damObjects'
  | 'pack'
  | 'campaign'
  | 'encounter'
  | 'journal'
  | 'cast'
  | 'quest'
  | 'calendar'
  | 'handout'
  | 'file';

export const HISTORY_KIND_LABELS: Record<HistoryKind, string> = {
  settings: 'Settings',
  creature: 'Creature',
  marker: 'Area template',
  map: 'Map',
  table: 'Random table',
  item: 'Item',
  spell: 'Spell',
  sounds: 'Sounds',
  damObjects: 'Dungeon Alchemist objects',
  pack: 'Pack',
  campaign: 'Campaign',
  encounter: 'Encounter',
  journal: 'Journal entry',
  cast: 'Person or place',
  quest: 'Quest',
  calendar: 'Calendar',
  handout: 'Handout',
  file: 'File',
};

/** The document a data file belongs to. */
export interface DocumentOfFile {
  /** Same for every file of one document. */
  key: string;
  kind: HistoryKind;
  id: string;
  /** The document's own file (a map's `map.json`); names come from it. */
  main: string;
}

interface DocumentRule {
  kind: HistoryKind;
  pattern: RegExp;
  id: (match: string[]) => string;
  main: (match: string[]) => string;
}

const SOURCE = '(library|packs/[^/]+)';
const CAMPAIGN = '^campaigns/([^/]+)/';

// First match wins: a map's pictures belong to the map, not to "File".
const DOCUMENT_RULES: DocumentRule[] = [
  { kind: 'settings', pattern: /^settings\.json$/, id: () => 'settings', main: (m) => m[0]! },
  {
    kind: 'creature',
    pattern: new RegExp(`^${SOURCE}/creatures/([^/.]+)(?:\\.token)?\\.[a-z]+$`, 'i'),
    id: (m) => m[2]!,
    main: (m) => `${m[1]}/creatures/${m[2]}.txt`,
  },
  {
    kind: 'marker',
    pattern: new RegExp(`^${SOURCE}/markers/([^/]+)\\.json$`),
    id: (m) => m[2]!,
    main: (m) => m[0]!,
  },
  {
    kind: 'map',
    pattern: new RegExp(`^${SOURCE}/maps/([^/]+)/`),
    id: (m) => m[2]!,
    main: (m) => `${m[1]}/maps/${m[2]}/map.json`,
  },
  {
    kind: 'table',
    pattern: new RegExp(`^${SOURCE}/tables/([^/]+)\\.txt$`),
    id: (m) => m[2]!,
    main: (m) => m[0]!,
  },
  {
    kind: 'item',
    pattern: new RegExp(`^${SOURCE}/items/([^/]+)\\.md$`),
    id: (m) => m[2]!,
    main: (m) => m[0]!,
  },
  {
    kind: 'spell',
    pattern: new RegExp(`^${SOURCE}/spells/([^/]+)\\.md$`),
    id: (m) => m[2]!,
    main: (m) => m[0]!,
  },
  {
    kind: 'sounds',
    pattern: new RegExp(`^${SOURCE}/sounds/`),
    id: (m) => m[1]!,
    main: (m) => `${m[1]}/sounds/sounds.json`,
  },
  {
    kind: 'damObjects',
    pattern: /^library\/dungeon-alchemist-(?:objects\.json$|models\/)/,
    id: () => 'library',
    main: () => 'library/dungeon-alchemist-objects.json',
  },
  { kind: 'pack', pattern: /^packs\/([^/]+)\/pack\.json$/, id: (m) => m[1]!, main: (m) => m[0]! },
  {
    kind: 'encounter',
    pattern: new RegExp(`${CAMPAIGN}encounters/([^/]+)/`),
    id: (m) => m[2]!,
    main: (m) => `campaigns/${m[1]}/encounters/${m[2]}/encounter.json`,
  },
  {
    kind: 'journal',
    pattern: new RegExp(`${CAMPAIGN}journal/([^/]+)\\.md$`),
    id: (m) => m[2]!,
    main: (m) => m[0]!,
  },
  {
    kind: 'cast',
    pattern: new RegExp(`${CAMPAIGN}people-and-places/([^/.]+)\\.[a-z]+$`, 'i'),
    id: (m) => m[2]!,
    main: (m) => `campaigns/${m[1]}/people-and-places/${m[2]}.md`,
  },
  {
    kind: 'quest',
    pattern: new RegExp(`${CAMPAIGN}quests/([^/]+)\\.md$`),
    id: (m) => m[2]!,
    main: (m) => m[0]!,
  },
  { kind: 'calendar', pattern: new RegExp(`${CAMPAIGN}calendar\\.json$`), id: (m) => m[1]!, main: (m) => m[0]! },
  { kind: 'handout', pattern: new RegExp(`${CAMPAIGN}handouts/(.+)$`), id: (m) => m[2]!, main: (m) => m[0]! },
  {
    kind: 'campaign',
    pattern: new RegExp(`${CAMPAIGN}(?:campaign\\.json|notes\\.md)$`),
    id: (m) => m[1]!,
    main: (m) => `campaigns/${m[1]}/campaign.json`,
  },
];

export function documentOf(path: string): DocumentOfFile {
  const [hit] = DOCUMENT_RULES.flatMap((rule) => {
    const match = rule.pattern.exec(path);
    return match ? [{ kind: rule.kind, id: rule.id(match), main: rule.main(match) }] : [];
  });
  const { kind, id, main } = hit ?? { kind: 'file' as const, id: path, main: path };
  return { key: `${kind}:${main}`, kind, id, main };
}

/** A document with its files kept in one history folder. */
export interface HistoryDocument extends DocumentOfFile {
  files: HistoryFile[];
}

/** The files of `folder` grouped by document, in the order of their first file. */
export function historyDocuments(folder: HistoryFolder): HistoryDocument[] {
  const documents = new Map<string, HistoryDocument>();
  for (const file of folder.files) {
    const doc = documentOf(file.path);
    const entry = documents.get(doc.key) ?? { ...doc, files: [] };
    entry.files.push(file);
    documents.set(doc.key, entry);
  }
  return [...documents.values()];
}

/**
 * The kept files that bring the document `key` back to how it was before the changes kept in `folder`: per file
 * the version of the first folder from `folder` on that holds one. Files without one are unchanged since then.
 */
export function restorePlan(listing: HistoryListing, folder: string, key: string): RestoreFile[] {
  const plan = new Map<string, RestoreFile>();
  const later = listing.folders.filter((f) => f.name >= folder);
  for (const kept of later) {
    for (const file of kept.files.filter((f) => !plan.has(f.path) && documentOf(f.path).key === key)) {
      plan.set(file.path, { folder: kept.name, path: file.path });
    }
  }
  return [...plan.values()];
}

const FOLDER_NAME = /^(\d{4}-\d{2}-\d{2})(?: (\d{2})-(\d{2})-(\d{2}) before restore)?$/;

/** Day (`YYYY-MM-DD`) and, for versions a restore replaced, the time (`HH:MM:SS`) of a history folder. */
export function historyFolderTime(name: string): { day: string; restoredAt: string | null } {
  const match = FOLDER_NAME.exec(name);
  if (!match) {
    throw new Error(`Not a history folder: ${name}`);
  }
  return { day: match[1]!, restoredAt: match[2] ? `${match[2]}:${match[3]}:${match[4]}` : null };
}

const namedJson = z.object({ name: z.string() });
const jsonName = (text: string) => namedJson.parse(JSON.parse(text)).name;

const NAME_READERS: Record<HistoryKind, ((text: string, id: string) => string) | null> = {
  settings: null,
  creature: (text, id) => parseCreatureFile(text, id).name,
  marker: jsonName,
  map: jsonName,
  table: (text, id) => parseTableFile(text, id).name,
  item: (text, id) => parseItemFile(text, id).name,
  spell: (text, id) => parseSpellFile(text, id).name,
  sounds: null,
  damObjects: null,
  pack: jsonName,
  campaign: jsonName,
  encounter: jsonName,
  journal: (text, id) => parseJournalFile(text, id).title,
  cast: (text, id) => parseCastFile(text, id).name,
  quest: (text, id) => parseQuestFile(text, id).name,
  calendar: null,
  handout: null,
  file: null,
};

/**
 * The name `doc` had before the changes kept in `folder`: read from its own file as `restorePlan` would bring it
 * back, else from the current file. Null for kinds without a name and documents whose file is gone.
 */
export async function historyDocumentName(
  storage: Storage,
  listing: HistoryListing,
  folder: string,
  doc: HistoryDocument,
): Promise<string | null> {
  const reader = NAME_READERS[doc.kind];
  const kept = listing.folders.find((f) => f.name >= folder && f.files.some((file) => file.path === doc.main));
  const path = kept ? `${HISTORY_DIR}/${kept.name}/${doc.main}` : doc.main;
  let name: string | null = null;
  if (reader && (await storage.exists('data', path))) {
    name = reader(await storage.readText('data', path), doc.id);
  }
  return name;
}
