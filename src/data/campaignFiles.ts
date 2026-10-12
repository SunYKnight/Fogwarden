import { calendarSchema, type Calendar } from '@/core/campaign/calendar';
import { formatJournalFile, parseJournalFile, type JournalEntry } from '@/core/campaign/journal';
import { formatCastFile, parseCastFile, type CastEntry } from '@/core/campaign/people';
import { formatQuestFile, parseQuestFile, type Quest } from '@/core/campaign/quests';
import { freeDocumentId } from '@/core/import/ids';
import { nowIso, type AssetRef } from '@/core/model';
import { DataError, type LoadProblem } from './repository';
import type { Storage } from './storage';

export interface CampaignDoc {
  id: string;
  updatedAt: string | null;
}

/** Markdown documents in one folder of a campaign, one file per document named after its id. */
export interface CampaignDocKind<T extends CampaignDoc> {
  folder: string;
  /** Id when the name has no letters or digits. */
  fallbackId: string;
  parse(text: string, id: string): T;
  format(doc: T): string;
}

export const JOURNAL: CampaignDocKind<JournalEntry> = {
  folder: 'journal',
  fallbackId: 'session',
  parse: parseJournalFile,
  format: formatJournalFile,
};

export const CAST: CampaignDocKind<CastEntry> = {
  folder: 'people-and-places',
  fallbackId: 'entry',
  parse: parseCastFile,
  format: formatCastFile,
};

export const QUESTS: CampaignDocKind<Quest> = {
  folder: 'quests',
  fallbackId: 'quest',
  parse: parseQuestFile,
  format: formatQuestFile,
};

const PICTURE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Journal, people and places, quests and calendar of one campaign, as readable files in its folder. */
export class CampaignFiles {
  constructor(
    readonly storage: Storage,
    readonly campaignId: string,
  ) {}

  private dir(kind: { folder: string }): string {
    return `campaigns/${this.campaignId}/${kind.folder}`;
  }

  private docPath<T extends CampaignDoc>(kind: CampaignDocKind<T>, id: string) {
    return `${this.dir(kind)}/${id}.md`;
  }

  async list<T extends CampaignDoc>(kind: CampaignDocKind<T>): Promise<{ docs: T[]; problems: LoadProblem[] }> {
    const ids = (await this.storage.list('data', this.dir(kind)))
      .filter((e) => !e.isDir && e.name.toLowerCase().endsWith('.md'))
      .map((e) => e.name.slice(0, -'.md'.length));
    const results = await Promise.allSettled(
      ids.map(async (id) => kind.parse(await this.storage.readText('data', this.docPath(kind, id)), id)),
    );
    const docs: T[] = [];
    const problems: LoadProblem[] = [];
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        docs.push(result.value);
      } else {
        problems.push({ area: 'data', path: this.docPath(kind, ids[i]!), message: errorMessage(result.reason) });
      }
    });
    return { docs, problems };
  }

  async load<T extends CampaignDoc>(kind: CampaignDocKind<T>, id: string): Promise<T> {
    const path = this.docPath(kind, id);
    const text = await this.storage.readText('data', path);
    let doc: T;
    try {
      doc = kind.parse(text, id);
    } catch (error) {
      throw new DataError(errorMessage(error), 'data', path);
    }
    return doc;
  }

  /** Stamps `updatedAt` and writes the file; the result reads back equal. */
  async save<T extends CampaignDoc>(kind: CampaignDocKind<T>, doc: T): Promise<T> {
    const stamped = { ...doc, updatedAt: nowIso() };
    const text = kind.format(stamped);
    await this.storage.writeText(this.docPath(kind, doc.id), text);
    return kind.parse(text, doc.id);
  }

  remove<T extends CampaignDoc>(kind: CampaignDocKind<T>, id: string): Promise<void> {
    return this.storage.remove(this.docPath(kind, id));
  }

  /** Readable id for a new document; names of pictures and hand-made files count as taken. */
  async newId<T extends CampaignDoc>(kind: CampaignDocKind<T>, name: string) {
    const entries = await this.storage.list('data', this.dir(kind));
    return freeDocumentId(name, kind.fallbackId, new Set(entries.map((e) => e.name.split('.')[0]!.toLowerCase())));
  }

  pictureRef(entry: CastEntry): AssetRef | null {
    return entry.picture === null ? null : { area: 'data', path: `${this.dir(CAST)}/${entry.picture}` };
  }

  /** Writes the picture as `<id>.<ext>` next to the entry, drops the old one and saves the entry. */
  async importPicture(entry: CastEntry, fileName: string, bytes: Uint8Array): Promise<CastEntry> {
    const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
    if (!PICTURE_EXTENSIONS.includes(extension)) {
      throw new DataError('Pictures must be PNG, JPEG or WebP', 'data', fileName);
    }
    const picture = `${entry.id}.${extension}`;
    await this.storage.writeBytes(`${this.dir(CAST)}/${picture}`, bytes);
    if (entry.picture !== null && entry.picture !== picture) {
      await this.removePicture(entry);
    }
    return this.save(CAST, { ...entry, picture });
  }

  /** Deletes the picture file unless another entry names it too. */
  async removePicture(entry: CastEntry): Promise<void> {
    const others = (await this.list(CAST)).docs.filter((d) => d.id !== entry.id && d.picture === entry.picture);
    const path = `${this.dir(CAST)}/${entry.picture}`;
    if (entry.picture !== null && others.length === 0 && (await this.storage.exists('data', path))) {
      await this.storage.remove(path);
    }
  }

  private get calendarPath(): string {
    return `campaigns/${this.campaignId}/calendar.json`;
  }

  /** Null while the campaign has no calendar. */
  async loadCalendar(): Promise<Calendar | null> {
    const path = this.calendarPath;
    const text = (await this.storage.exists('data', path)) ? await this.storage.readText('data', path) : null;
    let calendar: Calendar | null;
    try {
      calendar = text === null ? null : calendarSchema.parse(JSON.parse(text));
    } catch (error) {
      throw new DataError(errorMessage(error), 'data', path);
    }
    return calendar;
  }

  async saveCalendar(calendar: Calendar): Promise<Calendar> {
    const parsed = calendarSchema.parse(calendar);
    await this.storage.writeText(this.calendarPath, `${JSON.stringify(parsed, null, 2)}\n`);
    return parsed;
  }
}
