import type { Encounter } from '@/core/model';
import { countOf } from '@/core/plural';

export type EncounterStatus =
  | { kind: 'not-started' }
  | { kind: 'running'; round: number }
  | {
      kind: 'finished';
      /** Rounds fought, from the turn lines of the log; null when there are none. */
      rounds: number | null;
    };

/** Log text the initiative tracker writes when the DM ends combat. */
export const COMBAT_ENDED_TEXT = 'Combat ended';

/** Turn lines the tracker logs at each turn start: "Round 3: Goblin". */
const ROUND_LINE = /^Round (\d+):/;

/** Derives the campaign list status from play data; the schema stores no explicit status. */
export function encounterStatus(e: Encounter): EncounterStatus {
  const turns = e.log.filter((l) => l.kind === 'turn');
  const enemies = e.combatants.filter((c) => c.side === 'enemy');
  // Rolls and notes may follow the closing line, so any ended fight counts.
  const ended = e.round === 0 && turns.some((l) => l.text === COMBAT_ENDED_TEXT);
  const defeated = enemies.length > 0 && enemies.every((c) => c.hp.current <= 0);
  const rounds = Math.max(0, ...turns.map((l) => Number(ROUND_LINE.exec(l.text)?.[1] ?? 0)));
  let status: EncounterStatus = { kind: 'not-started' };
  if (ended || defeated) {
    status = { kind: 'finished', rounds: rounds > 0 ? rounds : null };
  } else if (e.round > 0) {
    status = { kind: 'running', round: e.round };
  }
  return status;
}

export function statusLabel(status: EncounterStatus): string {
  let label = 'Not started';
  if (status.kind === 'running') {
    label = `Round ${status.round}`;
  } else if (status.kind === 'finished') {
    label = status.rounds === null ? 'Ended' : `Ended · ${countOf(status.rounds, 'round')}`;
  }
  return label;
}
