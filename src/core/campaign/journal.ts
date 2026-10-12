import { FileFormatError, formatFrontMatter, parseFrontMatter, readTimestamp, splitList } from '../frontMatter';
import type { Encounter, LogEntry } from '../model/encounter';

/**
 * Session journal entries: `campaigns/<id>/journal/<date>-session-<n>.md`, a small header (`title`, `session`,
 * `date`, linked `encounters`, time stamps) and Markdown notes. Play appends notable events under `## Timeline`.
 */

const HEADER_KEYS = ['title', 'session', 'date', 'encounters', 'createdAt', 'updatedAt'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIMELINE_HEADING = '## Timeline';
/** A session runs into the night; entries this young stay current past midnight. */
const SESSION_HOURS = 12;
/** Log kinds written by End combat (XP, loot) and failed death saves. */
const NOTABLE_LOG: Partial<Record<LogEntry['kind'], true>> = { xp: true, loot: true, death: true };

export interface JournalEntry {
  /** File name without `.md`. */
  id: string;
  session: number;
  title: string;
  /** Real-world day of the session, `YYYY-MM-DD`. */
  date: string;
  /** Ids of encounters in this campaign the session links to. */
  encounters: string[];
  createdAt: string | null;
  updatedAt: string | null;
  body: string;
}

export function parseJournalFile(text: string, id: string): JournalEntry {
  const header = parseFrontMatter(text, HEADER_KEYS);
  const session = Number(header.values.session ?? '0');
  const date = header.values.date ?? '';
  if (!Number.isInteger(session) || session < 0) {
    throw new FileFormatError('"session" must be a whole number', header.lines.session!);
  }
  if (date !== '' && !DATE.test(date)) {
    throw new FileFormatError('"date" must look like 2026-10-12', header.lines.date!);
  }
  return {
    id,
    session,
    title: header.values.title || (session > 0 ? `Session ${session}` : id),
    date,
    encounters: splitList(header.values.encounters),
    createdAt: readTimestamp(header, 'createdAt'),
    updatedAt: readTimestamp(header, 'updatedAt'),
    body: header.body,
  };
}

export function formatJournalFile(entry: JournalEntry): string {
  const header: [string, string][] = [
    ['title', entry.title],
    ['session', entry.session > 0 ? String(entry.session) : ''],
    ['date', entry.date],
    ['encounters', entry.encounters.join(', ')],
    ['createdAt', entry.createdAt ?? ''],
    ['updatedAt', entry.updatedAt ?? ''],
  ];
  return formatFrontMatter(header, entry.body);
}

/** Local calendar day, as the file name and header show it. */
export function localDate(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** The next session's entry; ids collide only with hand-made files, which the caller checks. */
export function newJournalEntry(entries: readonly JournalEntry[], at: Date): JournalEntry {
  const session = Math.max(0, ...entries.map((e) => e.session)) + 1;
  const date = localDate(at);
  const iso = at.toISOString();
  return {
    id: `${date}-session-${session}`,
    session,
    title: `Session ${session}`,
    date,
    encounters: [],
    createdAt: iso,
    updatedAt: iso,
    body: '',
  };
}

/** Newest first: by session number, then by date. */
export function sortJournal(entries: readonly JournalEntry[]): JournalEntry[] {
  return [...entries].sort((a, b) => b.session - a.session || b.date.localeCompare(a.date));
}

/** The entry Play events go to: the newest one when it is from today or less than 12 hours old. */
export function currentSession(entries: readonly JournalEntry[], at: Date): JournalEntry | null {
  const newest = sortJournal(entries)[0] ?? null;
  const created = newest?.createdAt ? Date.parse(newest.createdAt) : Number.NEGATIVE_INFINITY;
  const recent = at.getTime() - created < SESSION_HOURS * 3600 * 1000;
  return newest && (newest.date === localDate(at) || recent) ? newest : null;
}

/** Adds lines at the end of the `## Timeline` section, which is created at the end when missing. */
export function appendTimeline(body: string, lines: readonly string[]): string {
  const rows = body === '' ? [] : body.split('\n');
  const heading = rows.findIndex((r) => r.trim().toLowerCase() === TIMELINE_HEADING.toLowerCase());
  let result: string;
  if (heading === -1) {
    const before = body.trimEnd();
    result = `${before}${before === '' ? '' : '\n\n'}${TIMELINE_HEADING}\n\n${lines.join('\n')}`;
  } else {
    const next = rows.findIndex((r, i) => i > heading && /^#{1,2}\s/.test(r));
    const end = next === -1 ? rows.length : next;
    let last = end - 1;
    while (last > heading && rows[last]!.trim() === '') {
      last -= 1;
    }
    const section = [...rows.slice(0, last + 1), ...(last === heading ? [''] : []), ...lines];
    const rest = rows.slice(end);
    result = (rest.length === 0 ? section : [...section, '', ...rest]).join('\n');
  }
  return result;
}

/** What happened between two states of one encounter that belongs in the session journal. */
export function notableEvents(before: Encounter, after: Encounter): string[] {
  const events: string[] = [];
  if (before.round === 0 && after.round > 0) {
    events.push('Combat started');
  }
  after.combatants.forEach((c) => {
    const was = before.combatants.find((b) => b.id === c.id);
    const fallen = was !== undefined && was.hp.current > 0 && c.hp.current <= 0;
    const friendly = c.side === 'player' || c.side === 'ally';
    if (fallen) {
      events.push(friendly ? `${c.name} drops to 0 HP` : `${c.name} is defeated`);
    }
  });
  const known = new Set(before.log.map((e) => e.id));
  after.log.filter((e) => !known.has(e.id) && NOTABLE_LOG[e.kind]).forEach((e) => events.push(e.text));
  if (before.round > 0 && after.round === 0) {
    events.push(`Combat ended after ${before.round} ${before.round === 1 ? 'round' : 'rounds'}`);
  }
  return events;
}
