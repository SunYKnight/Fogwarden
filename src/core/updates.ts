import type { UpdateSettings } from './model';

/** Automatic release checks run at most this often. */
export const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** `check` now, `wait` until the DM stops playing, or `skip` this app start. */
export type AutoCheck = 'check' | 'wait' | 'skip';

/** What the automatic release check does now; `playing` is Play with combat running. */
export function autoCheckDecision(updates: UpdateSettings, now: Date, playing: boolean): AutoCheck {
  const elapsed = updates.lastCheck === null ? Infinity : now.getTime() - Date.parse(updates.lastCheck);
  // A clock set back makes the elapsed time negative; that day has to pass.
  const recent = elapsed < AUTO_CHECK_INTERVAL_MS;
  let decision: AutoCheck = 'check';
  if (!updates.autoCheck || recent) {
    decision = 'skip';
  } else if (playing) {
    decision = 'wait';
  }
  return decision;
}
