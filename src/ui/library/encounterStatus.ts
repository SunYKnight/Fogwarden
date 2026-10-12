import type { Encounter } from '@/core/model';

export type EncounterStatus = { kind: 'not-started' } | { kind: 'running'; round: number } | { kind: 'finished' };

/** Log text the initiative tracker writes when the DM ends combat. */
export const COMBAT_ENDED_TEXT = 'Combat ended';

/** Derives the campaign list status from play data; the schema stores no explicit status. */
export function encounterStatus(e: Encounter): EncounterStatus {
  const enemies = e.combatants.filter((c) => c.side === 'enemy');
  const last = e.log.at(-1);
  const ended = e.round === 0 && last?.kind === 'turn' && last.text === COMBAT_ENDED_TEXT;
  const defeated = enemies.length > 0 && enemies.every((c) => c.hp.current <= 0);
  let status: EncounterStatus = { kind: 'not-started' };
  if (ended || defeated) {
    status = { kind: 'finished' };
  } else if (e.round > 0) {
    status = { kind: 'running', round: e.round };
  }
  return status;
}

export function statusLabel(status: EncounterStatus): string {
  return status.kind === 'running' ? `Round ${status.round}` : status.kind === 'finished' ? 'Finished' : 'Not started';
}
