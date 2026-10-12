import { FileFormatError, formatFrontMatter, parseFrontMatter, readTimestamp } from '../frontMatter';

/** Quests of a campaign: `campaigns/<id>/quests/<id>.md`, a header (`name`, `status`, time stamps) and notes. */

const HEADER_KEYS = ['name', 'status', 'createdAt', 'updatedAt'] as const;
export const QUEST_STATUSES = ['open', 'done', 'failed'] as const;
export type QuestStatus = (typeof QUEST_STATUSES)[number];

export interface Quest {
  id: string;
  name: string;
  status: QuestStatus;
  createdAt: string | null;
  updatedAt: string | null;
  notes: string;
}

export function parseQuestFile(text: string, id: string): Quest {
  const header = parseFrontMatter(text, HEADER_KEYS);
  const status = (header.values.status || 'open').toLowerCase();
  if (!QUEST_STATUSES.some((s) => s === status)) {
    throw new FileFormatError('"status" must be open, done or failed', header.lines.status!);
  }
  return {
    id,
    name: header.values.name || id,
    status: status as QuestStatus,
    createdAt: readTimestamp(header, 'createdAt'),
    updatedAt: readTimestamp(header, 'updatedAt'),
    notes: header.body,
  };
}

export function formatQuestFile(quest: Quest): string {
  const header: [string, string][] = [
    ['name', quest.name],
    ['status', quest.status],
    ['createdAt', quest.createdAt ?? ''],
    ['updatedAt', quest.updatedAt ?? ''],
  ];
  return formatFrontMatter(header, quest.notes);
}
