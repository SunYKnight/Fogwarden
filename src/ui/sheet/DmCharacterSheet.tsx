import { useEffect, useMemo, useState } from 'react';
import type { CharacterSheet, Creature, PlayerSheetOverlay } from '@/core/model';
import type { Spell } from '@/core/spells';
import { creatureResources } from '@/core/rules/resources';
import type { Repository } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { usePlayerDataStore } from '@/sync/playerData';
import { characterDetails } from '@/sync/playerFilter';
import type { CharacterDetails } from '@/sync/protocol';
import { detailsWithOverlay } from '@/sync/sheetEdits';
import { CharacterSheetView } from './CharacterSheetTabs';

type PlayerFileLoad<T> = (repository: Repository, campaignId: string, view: string) => Promise<T>;

const loadNotes: PlayerFileLoad<string> = (repository, campaignId, view) =>
  repository.loadPlayerNotes(campaignId, view);
const loadSheet: PlayerFileLoad<PlayerSheetOverlay> = (repository, campaignId, view) =>
  repository.loadPlayerSheet(campaignId, view);

/** A player file of a campaign: `live` while its links hold it, else as stored; null until read or without one. */
function usePlayerFile<T>(campaignId: string | null, view: string, live: T | undefined, load: PlayerFileLoad<T>) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  // Keyed, so another character's file never shows while this one loads.
  const key = `${campaignId}/${view}`;
  const [stored, setStored] = useState<{ key: string; value: T } | null>(null);
  useEffect(() => {
    let current = true;
    if (campaignId !== null) {
      load(repository, campaignId, view)
        .then((value) => current && setStored({ key: `${campaignId}/${view}`, value }))
        .catch(reportError);
    }
    return () => {
      current = false;
    };
  }, [repository, reportError, campaignId, view, load]);
  return live ?? (stored?.key === key ? stored.value : null);
}

/** The full sheet the DM reads: with the player's stored changes merged as the player sees them. */
export function dmSheetDetails(
  creature: Creature,
  stored: CharacterSheet | undefined,
  spellsById: ReadonlyMap<string, Spell>,
  overlay: PlayerSheetOverlay | null,
): CharacterDetails {
  const details = characterDetails(creature, stored, spellsById);
  return overlay ? detailsWithOverlay(details, overlay) : details;
}

/**
 * Where the character stands between encounters, e.g. "HP 7/20, 3 temporary · Level 1 slots used 2/4 · Hit dice
 * used 2/5"; a rested character has its maximum.
 */
export function sessionSummary(creature: Creature, overlay: PlayerSheetOverlay): string {
  const { session } = overlay;
  const max = creature.hitPoints.average;
  const hp = session ? Math.min(session.hp, max) : max;
  const temp = session && session.tempHp > 0 ? `, ${session.tempHp} temporary` : '';
  const slots = Object.entries(creatureResources(creature).slots).map(
    ([level, count]) => `Level ${level} slots used ${session?.slotsUsed[level] ?? 0}/${count}`,
  );
  const saves = session && session.hp <= 0 ? session.deathSaves : null;
  return [
    `HP ${hp}/${max}${temp}`,
    ...slots,
    ...(saves ? [`Death saves ${saves.successes}/${saves.failures} (successes/failures)`] : []),
    ...(creature.level !== null ? [`Hit dice used ${overlay.hitDiceUsed}/${creature.level}`] : []),
  ].join(' · ');
}

/**
 * A player character's full sheet on the DM's pages (Party tab, Compendium > Players): the sheet its player sees,
 * read-only. In a campaign (`campaignId` and the party member's `view`) it carries the player's changes, where
 * the character stands between encounters and the player's notes, read-only.
 */
export function DmCharacterSheet(props: { creature: Creature; campaignId?: string; view?: string }) {
  const { creature, campaignId = null, view = '' } = props;
  const stored = useLibraryStore((s) => s.characterSheets[creature.id]);
  const spells = useLibraryStore((s) => s.listings.spell);
  const liveNotes = usePlayerDataStore((s) => (s.campaignId === campaignId ? s.notes[view] : undefined));
  const liveOverlay = usePlayerDataStore((s) => (s.campaignId === campaignId ? s.overlays[view] : undefined));
  const notes = usePlayerFile(campaignId, view, liveNotes, loadNotes);
  const overlay = usePlayerFile(campaignId, view, liveOverlay, loadSheet);
  const details = useMemo(
    () => dmSheetDetails(creature, stored, new Map(spells.entries.map((e) => [e.ref.id, e.doc])), overlay),
    [creature, stored, spells, overlay],
  );
  return (
    <div className="col">
      {overlay && <p className="muted">{sessionSummary(creature, overlay)}</p>}
      <CharacterSheetView details={details} notes={notes === null ? null : { text: notes, onCommit: null }} />
    </div>
  );
}
