import { formatCreatureFile } from '@/core/import/creatureFile';
import {
  dnd5eEquipmentSchema,
  dnd5eMagicItemSchema,
  dnd5eMonsterSchema,
  dnd5eSpellSchema,
  SRD_ID_PREFIX,
  SRD_LICENSE,
  srdAreaTemplate,
  srdCreature,
  srdEquipment,
  srdMagicItem,
  srdSpell,
} from '@/core/import/dnd5eApi';
import { formatItemFile } from '@/core/items';
import { nowIso } from '@/core/model';
import { formatSpellFile } from '@/core/spells';
import { DND5E_API, downloadApiPictures, fetchApiJson, inParallel, listApi } from './dnd5eapiPictures';
import { writableSource, type PackManifest } from './packs';
import { libraryDocPath, type Repository } from './repository';

/**
 * D&D 5e API import: monsters, their pictures, spells with their area templates, magic items and equipment
 * into the user pack "D&D 5e API (SRD 5.1)". Ids are `srd-<index>`, the ids the shipped SRD pack has always
 * used, so encounters and pictures (`library/creatures/srd-goblin.jpg`) that name them resolve, and the API's
 * area templates take the shipped ones' place by pack precedence. Documents are written as they arrive: a
 * cancelled import keeps what it got, importing again overwrites the pack's files.
 */

export const DND5E_API_PACK: PackManifest = {
  id: 'dnd5e-api',
  name: 'D&D 5e API (SRD 5.1)',
  version: '5.1',
  author: 'Wizards of the Coast',
  license: SRD_LICENSE,
  description:
    'Monsters, spells, spell area templates, magic items and equipment of the System Reference Document 5.1 by ' +
    'Wizards of the Coast (CC-BY-4.0), downloaded from the D&D 5e API. The monster pictures come from ' +
    'dnd5eapi.co for personal use.',
  url: DND5E_API,
};

const PACK_SOURCE = writableSource(DND5E_API_PACK.id);

const LICENSE_TEXT = [
  `# ${DND5E_API_PACK.name}`,
  '',
  'This pack includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the',
  'Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is',
  'licensed under the Creative Commons Attribution 4.0 International License available at',
  'https://creativecommons.org/licenses/by/4.0/legalcode.',
  '',
  'Changes: downloaded from the D&D 5e API (https://www.dnd5eapi.co, the data of',
  "https://github.com/5e-bits/5e-database, MIT License) and converted into this application's formats:",
  'monsters as stat block text read back into structured data with a generic legendary action introduction;',
  'spells, magic items and equipment as Markdown; spell areas as area templates with a placeholder save DC',
  'of 13.',
  '',
  'The monster pictures (`creatures/*.jpg`) come from dnd5eapi.co, shrunk to 768 px, for personal use only.',
  'They are not part of the SRD 5.1 and not covered by its license.',
  '',
].join('\n');

export type ApiPart = 'monsters' | 'pictures' | 'spells' | 'areas' | 'magicItems' | 'equipment';
/** Import order; pictures, by far the largest download, go last. */
export const API_PARTS: readonly ApiPart[] = ['monsters', 'spells', 'areas', 'magicItems', 'equipment', 'pictures'];

export interface ApiEntry {
  index: string;
  name: string;
}

/** What the API lists per part; pictures are the monsters', areas come from the spells that have one. */
export type ApiPlan = Record<ApiPart, ApiEntry[]>;

export interface ApiProblem {
  part: ApiPart;
  name: string;
  message: string;
}

export interface ApiReport {
  written: Record<ApiPart, number>;
  /** Documents the API sent that could not be converted, and monsters without a picture. */
  problems: ApiProblem[];
}

type DocPart = Exclude<ApiPart, 'pictures'>;
interface PackFile {
  path: string;
  text: string;
}

/**
 * API list per document part and the conversion of one of its documents into a file of the pack; null when the
 * document has nothing for the part (a spell without an area).
 */
const DOC_PARTS: Record<DocPart, { endpoint: string; toFile: (json: unknown) => PackFile | null }> = {
  monsters: {
    endpoint: 'monsters',
    toFile: (json) => {
      const creature = srdCreature(dnd5eMonsterSchema.parse(json));
      return { path: libraryDocPath('creature', PACK_SOURCE, creature.id), text: formatCreatureFile(creature) };
    },
  },
  spells: {
    endpoint: 'spells',
    toFile: (json) => {
      const spell = srdSpell(dnd5eSpellSchema.parse(json));
      return { path: libraryDocPath('spell', PACK_SOURCE, spell.id), text: formatSpellFile(spell) };
    },
  },
  areas: {
    endpoint: 'spells',
    toFile: (json) => {
      const template = srdAreaTemplate(dnd5eSpellSchema.parse(json), nowIso());
      return (
        template && {
          path: libraryDocPath('marker', PACK_SOURCE, template.id),
          text: `${JSON.stringify(template, null, 2)}\n`,
        }
      );
    },
  },
  magicItems: {
    endpoint: 'magic-items',
    toFile: (json) => {
      const item = srdMagicItem(dnd5eMagicItemSchema.parse(json));
      return { path: libraryDocPath('item', PACK_SOURCE, item.id), text: formatItemFile(item) };
    },
  },
  equipment: {
    endpoint: 'equipment',
    toFile: (json) => {
      const item = srdEquipment(dnd5eEquipmentSchema.parse(json));
      return { path: libraryDocPath('item', PACK_SOURCE, item.id), text: formatItemFile(item) };
    },
  },
};

/** Asks the API's lists what each part holds. */
export async function planDndApiImport(signal?: AbortSignal): Promise<ApiPlan> {
  const [monsters, spells, magicItems, equipment] = await Promise.all([
    listApi(DOC_PARTS.monsters.endpoint, signal),
    listApi(DOC_PARTS.spells.endpoint, signal),
    listApi(DOC_PARTS.magicItems.endpoint, signal),
    listApi(DOC_PARTS.equipment.endpoint, signal),
  ]);
  return { monsters, pictures: monsters, spells, areas: spells, magicItems, equipment };
}

async function preparePack(repository: Repository): Promise<void> {
  await repository.ensurePack(DND5E_API_PACK);
  await repository.storage.writeText(`${PACK_SOURCE.root}/LICENSE.md`, LICENSE_TEXT);
}

const NOTHING_WRITTEN: Record<ApiPart, number> = {
  monsters: 0,
  pictures: 0,
  spells: 0,
  areas: 0,
  magicItems: 0,
  equipment: 0,
};

/**
 * Fetches each document of `entries` once and writes it into the pack for each of `parts`, which share one
 * endpoint; conversion failures become problems.
 */
async function importDocs(
  parts: readonly DocPart[],
  entries: readonly ApiEntry[],
  report: ApiReport,
  repository: Repository,
  onProgress: (part: DocPart, done: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const done: Record<DocPart, number> = { ...NOTHING_WRITTEN };
  await inParallel(
    entries,
    async (entry) => {
      const json = await fetchApiJson(`/api/2014/${DOC_PARTS[parts[0]!].endpoint}/${entry.index}`, signal);
      for (const part of parts) {
        let file: PackFile | null = null;
        try {
          file = DOC_PARTS[part].toFile(json);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          report.problems.push({ part, name: entry.name, message });
        }
        if (file) {
          await repository.storage.writeText(file.path, file.text);
          report.written[part] += 1;
        }
        done[part] += 1;
        onProgress(part, done[part]);
      }
    },
    signal,
  );
}

/**
 * Imports `parts` of `plan` into the pack "D&D 5e API (SRD 5.1)" in `API_PARTS` order, 4 downloads at a time;
 * spells and their areas share one download. Aborting `signal` stops it with the documents written so far kept.
 */
export async function runDndApiImport(
  repository: Repository,
  plan: ApiPlan,
  parts: readonly ApiPart[],
  onProgress: (part: ApiPart, done: number) => void,
  signal: AbortSignal,
): Promise<ApiReport> {
  await preparePack(repository);
  const report: ApiReport = { written: { ...NOTHING_WRITTEN }, problems: [] };
  const docParts = API_PARTS.filter((p): p is DocPart => p !== 'pictures' && parts.includes(p));
  for (const endpoint of new Set(docParts.map((p) => DOC_PARTS[p].endpoint))) {
    const group = docParts.filter((p) => DOC_PARTS[p].endpoint === endpoint);
    await importDocs(group, plan[group[0]!], report, repository, onProgress, signal);
  }
  if (parts.includes('pictures')) {
    const pictures = plan.pictures.map((e) => ({
      creatureId: `${SRD_ID_PREFIX}${e.index}`,
      fileName: `${SRD_ID_PREFIX}${e.index}.png`,
    }));
    const missing = await downloadApiPictures(repository, pictures, (done) => onProgress('pictures', done), {
      pack: DND5E_API_PACK.id,
      signal,
    });
    report.written.pictures = pictures.length - missing.length;
    report.problems.push(
      ...missing.map((id) => ({
        part: 'pictures' as const,
        name: plan.pictures.find((e) => `${SRD_ID_PREFIX}${e.index}` === id)?.name ?? id,
        message: 'The API has no picture',
      })),
    );
  }
  return report;
}

/**
 * Imports the monsters `indexes` (API indexes such as `goblin`), or all of them, into the pack "D&D 5e API
 * (SRD 5.1)" as `srd-<index>`, skipping those the pack has already; for callers that need a few monsters, like
 * the sample campaign. `onProgress` counts the monsters still missing.
 */
export async function importApiMonsters(
  repository: Repository,
  indexes: readonly string[] | 'all',
  onProgress: (done: number, total: number) => void = () => undefined,
  signal?: AbortSignal,
): Promise<{ written: number; problems: ApiProblem[] }> {
  const listed =
    indexes === 'all' ? await listApi('monsters', signal) : indexes.map((index) => ({ index, name: index }));
  const present = await Promise.all(
    listed.map((e) =>
      repository.storage.exists('data', libraryDocPath('creature', PACK_SOURCE, `${SRD_ID_PREFIX}${e.index}`)),
    ),
  );
  const missing = listed.filter((_e, i) => !present[i]);
  const report: ApiReport = { written: { ...NOTHING_WRITTEN }, problems: [] };
  if (missing.length > 0) {
    await preparePack(repository);
    await importDocs(
      ['monsters'],
      missing,
      report,
      repository,
      (_part, done) => onProgress(done, missing.length),
      signal,
    );
  }
  return { written: report.written.monsters, problems: report.problems };
}
