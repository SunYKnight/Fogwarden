import { isTauri } from '@tauri-apps/api/core';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import type { Campaign, Creature } from '@/core/model';
import type { LibraryEntry } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { CreatureThumb } from '../creatureTypes/CreatureThumb';
import { Button, EmptyState, openContextMenu } from '../kit';
import { openAuroraImport } from './compendiumUi';
import { CreaturePreview, useCreatureActions } from './CreatureLibrary';
import { OriginBadge } from './OriginBadge';

type Entry = LibraryEntry<'creature'>;

// Aurora imports tag every character with it; the origin badge says so too.
const AURORA_TAG = 'aurora';

/** Level, race and class as far as known (Aurora keeps the race as subtype, the class as tag), AC and HP. */
export function characterSummary(c: Creature): string {
  return [
    c.level === null ? '' : `Level ${c.level}`,
    c.subtype,
    ...c.tags.filter((t) => t !== AURORA_TAG),
    `AC ${c.armorClass}`,
    `HP ${c.hitPoints.average}`,
  ]
    .filter((part) => part !== '')
    .join(' · ');
}

/** Compendium header actions of the Players tab. */
export function PlayerActions() {
  const navigate = useAppStore((s) => s.navigate);
  const desktop = isTauri();
  return (
    <>
      <Button
        icon="plus"
        label="New player character"
        variant="primary"
        onClick={() => navigate({ page: 'creature-editor', ref: null, kind: 'player' })}
      />
      <Button
        icon="upload"
        label="Import from Aurora Builder…"
        disabled={!desktop}
        title={desktop ? 'Import characters from Aurora Builder' : 'Needs the desktop app'}
        onClick={openAuroraImport}
      />
    </>
  );
}

/** Library creatures of kind player with the campaigns whose party they are in. */
export function PlayerLibrary() {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const listing = useLibraryStore((s) => s.listings.creature);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const actions = useCreatureActions(setSelectedId);

  useEffect(() => {
    let ignore = false;
    repository.listCampaigns().then((l) => {
      if (!ignore) setCampaigns(l.campaigns);
    }, reportError);
    return () => {
      ignore = true;
    };
  }, [repository, reportError]);

  const characters = useMemo(
    () => listing.listed.filter((e) => e.doc.kind === 'player').sort((a, b) => a.doc.name.localeCompare(b.doc.name)),
    [listing],
  );
  const selected = characters.find((e) => e.ref.id === selectedId) ?? null;
  // By creature id only: a user override keeps the pack character's id.
  const partiesByCreature = useMemo(() => {
    const byCreature = new Map<string, string[]>();
    for (const campaign of campaigns) {
      for (const member of campaign.party) {
        byCreature.set(member.creature.id, [...(byCreature.get(member.creature.id) ?? []), campaign.name]);
      }
    }
    return byCreature;
  }, [campaigns]);
  const selectedParties = (selected && partiesByCreature.get(selected.ref.id)) ?? [];

  const showMenu = (e: MouseEvent, entry: Entry) => {
    e.preventDefault();
    setSelectedId(entry.ref.id);
    openContextMenu(e.clientX, e.clientY, actions.menuItems(entry));
  };

  return (
    <div className="compendium-split">
      <div className="compendium-list">
        <div className="list" role="listbox" aria-label="Player characters">
          {characters.map((entry) => {
            const parties = partiesByCreature.get(entry.ref.id) ?? [];
            return (
              <div
                key={`${entry.ref.area}:${entry.ref.id}`}
                role="option"
                tabIndex={0}
                aria-selected={entry.ref.id === selectedId}
                className={entry.ref.id === selectedId ? 'list-item selected' : 'list-item'}
                onClick={() => setSelectedId(entry.ref.id)}
                onDoubleClick={() => actions.edit(entry)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') actions.edit(entry);
                  if (e.key === ' ') {
                    // Space would otherwise scroll the list.
                    e.preventDefault();
                    setSelectedId(entry.ref.id);
                  }
                }}
                onContextMenu={(e) => showMenu(e, entry)}
              >
                <CreatureThumb creature={entry.doc} className="creature-row-thumb" />
                <span className="row-name">
                  {entry.doc.name}
                  <br />
                  <span className="muted small">{characterSummary(entry.doc)}</span>
                </span>
                {parties.length > 0 && <span className="muted small">Party of {parties.join(', ')}</span>}
                <OriginBadge entry={entry} />
              </div>
            );
          })}
        </div>
        {characters.length === 0 && (
          <EmptyState icon="users" title="No player characters yet.">
            Import them from Aurora Builder or create one with the buttons above; campaign parties pick their characters
            from here.
          </EmptyState>
        )}
      </div>
      <div className="creature-preview">
        {selected ? (
          <CreaturePreview entry={selected} actions={actions}>
            <p className="muted">
              {selectedParties.length > 0
                ? `In the party of ${selectedParties.join(', ')}.`
                : 'In no campaign party yet.'}
            </p>
          </CreaturePreview>
        ) : (
          <EmptyState icon="user" title="Select a player character to see its stat block." />
        )}
      </div>
    </div>
  );
}
