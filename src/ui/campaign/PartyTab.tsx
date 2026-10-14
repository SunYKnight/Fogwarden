import { isTauri } from '@tauri-apps/api/core';
import { useState } from 'react';
import { newId, type Campaign, type PartyMember } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { TextField } from '../components/fields';
import { CreatureThumb } from '../creatureTypes/CreatureThumb';
import { useCreature, useDisabledPackOf } from '../encounter/creatureLookup';
import { Button, Dialog, EmptyState, Section } from '../kit';
import { openAuroraImport } from '../library/compendiumUi';
import { characterSummary } from '../library/PlayerLibrary';

interface PartyTabProps {
  campaign: Campaign;
  /** Saves the campaign with its changed party. */
  onChange: (campaign: Campaign) => Promise<void>;
}

function AuroraButton() {
  const desktop = isTauri();
  return (
    <Button
      icon="upload"
      label="Import from Aurora…"
      disabled={!desktop}
      title={desktop ? 'Import characters from Aurora Builder' : 'Needs the desktop app'}
      onClick={openAuroraImport}
    />
  );
}

interface MemberRowProps {
  member: PartyMember;
  busy: boolean;
  onChange: (member: PartyMember) => void;
  onRemove: () => void;
}

function MemberRow({ member, busy, onChange, onRemove }: MemberRowProps) {
  const creature = useCreature(member.creature);
  const disabledPack = useDisabledPackOf(member.creature);
  const missing = disabledPack
    ? `Its pack "${disabledPack}" is disabled.`
    : 'This character is no longer in the compendium.';
  return (
    <div className="encounter-row">
      {creature && <CreatureThumb creature={creature} alt="" className="creature-thumb" />}
      <div className="encounter-info">
        <strong>{creature?.name ?? member.creature.id}</strong>
        <span className="muted">{creature ? characterSummary(creature) : missing}</span>
      </div>
      <TextField label="Player" value={member.player} onChange={(player) => onChange({ ...member, player })} />
      <Button icon="trash" label="Remove from the party" iconOnly variant="danger" disabled={busy} onClick={onRemove} />
    </div>
  );
}

/** Library player characters not in the party yet; a click adds one unless the last add is still saving. */
function AddMembersDialog(props: {
  party: PartyMember[];
  busy: boolean;
  onAdd: (member: PartyMember) => void;
  onClose: () => void;
}) {
  const { party, busy, onAdd, onClose } = props;
  const entries = useLibraryStore((s) => s.listings.creature.entries);
  const inParty = new Set(party.map((m) => m.creature.id));
  const candidates = entries
    .filter((e) => e.doc.kind === 'player' && !inParty.has(e.ref.id))
    .sort((a, b) => a.doc.name.localeCompare(b.doc.name));
  return (
    <Dialog title="Add to the party" onClose={onClose} width={480}>
      <div className="col">
        <div className="row">
          <span className="muted grow">Player characters of the compendium; a click adds one.</span>
          <AuroraButton />
        </div>
        <div className="list add-matches">
          {candidates.map((e) => {
            const add = () => {
              if (!busy) onAdd({ id: newId(), creature: e.ref, player: '' });
            };
            return (
              <div
                key={e.ref.id}
                role="button"
                tabIndex={0}
                aria-disabled={busy}
                className="list-item"
                onClick={add}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') add();
                }}
              >
                <CreatureThumb creature={e.doc} className="creature-row-thumb" />
                <span className="grow">{e.doc.name}</span>
                <span className="muted small">{characterSummary(e.doc)}</span>
              </div>
            );
          })}
          {candidates.length === 0 && (
            <span className="muted small">
              Every player character is in the party. Import more from Aurora Builder or create them under Compendium
              &gt; Players.
            </span>
          )}
        </div>
        <div className="dialog-actions">
          <Button label="Done" variant="primary" onClick={onClose} />
        </div>
      </div>
    </Dialog>
  );
}

/** The campaign's player characters: compendium characters and who plays them. */
export function PartyTab({ campaign, onChange }: PartyTabProps) {
  const reportError = useAppStore((s) => s.reportError);
  const [adding, setAdding] = useState(false);
  // Each change builds on the saved party, so it waits for the last save.
  const [saving, setSaving] = useState(false);
  const { party } = campaign;
  const save = (next: PartyMember[]) => {
    setSaving(true);
    onChange({ ...campaign, party: next })
      .catch(reportError)
      .finally(() => setSaving(false));
  };
  const addButton = <Button icon="plus" label="Add characters…" variant="primary" onClick={() => setAdding(true)} />;
  return (
    <Section
      title={`Party (${party.length})`}
      actions={
        party.length > 0 && (
          <>
            <AuroraButton />
            {addButton}
          </>
        )
      }
    >
      <div className="col">
        {party.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            busy={saving}
            onChange={(changed) => save(party.map((m) => (m.id === changed.id ? changed : m)))}
            onRemove={() => save(party.filter((m) => m.id !== member.id))}
          />
        ))}
      </div>
      {party.length === 0 && (
        <EmptyState icon="users" title="No party yet." action={addButton}>
          Pick the player characters from the compendium; encounters then add them all at once, and each player keeps
          one link for the whole campaign.
        </EmptyState>
      )}
      {adding && (
        <AddMembersDialog
          party={party}
          busy={saving}
          onAdd={(m) => save([...party, m])}
          onClose={() => setAdding(false)}
        />
      )}
    </Section>
  );
}
