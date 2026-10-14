import { isTauri } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { sideSchema, type AssetRef, type PartyMember, type Side } from '@/core/model';
import { formatCr } from '@/core/rules/abilities';
import { useAppStore } from '@/state/appStore';
import { addParty, createPc, spawnCombatant, type HpMode } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { useLibraryStore } from '@/state/libraryStore';
import { AssetImage } from '../components/AssetImage';
import { CheckboxField, Field, NumberField, SelectField, TextField } from '../components/fields';
import { CreatureThumb } from '../creatureTypes/CreatureThumb';
import { Button, Dialog, Tabs, type TabSpec } from '../kit';
import { openAuroraImport, openDndApiImport } from '../library/compendiumUi';
import { PictureLibraryDialog } from '../library/PictureLibraryDialog';
import { DifficultyBadge } from './EncounterDifficulty';
import { useEncounterUi } from './encounterUiStore';

const MAX_MATCHES = 12;

type AddTab = 'library' | 'pc';

const ADD_TABS: TabSpec<AddTab>[] = [
  { id: 'library', label: 'From the compendium', icon: 'book' },
  { id: 'pc', label: 'Player character', icon: 'user' },
];

// Module-level so the dialog's focus effect, keyed on `onClose`, runs once.
const close = () => useEncounterUi.setState({ addDialogOpen: false });

function FromLibrary() {
  const entries = useLibraryStore((s) => s.listings.creature.listed);
  const combatants = useEncounterStore((s) => s.encounter)?.combatants ?? [];
  const update = useEncounterStore((s) => s.update);
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const [search, setSearch] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [side, setSide] = useState<Side>('enemy');
  const [hpMode, setHpMode] = useState<HpMode>('average');
  const picked = entries.find((e) => e.ref.id === pickedId);
  const needle = search.toLowerCase();
  const matches = entries.filter((e) => e.doc.name.toLowerCase().includes(needle));

  // A library creature with a broken HP formula fails only when rolled.
  const add = () => {
    try {
      update((d) => {
        for (let i = 0; i < count && picked; i++) {
          const takenNames = d.combatants.map((c) => c.name);
          d.combatants.push(spawnCombatant(picked.doc, picked.ref, { hpMode, side, takenNames }));
        }
      }, `Add ${count} × ${picked?.doc.name}`);
      notify(`Added ${count} × ${picked?.doc.name}`);
      close();
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div className="col">
      <input
        placeholder="Search creatures"
        aria-label="Search creatures"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="list add-matches">
        {matches.slice(0, MAX_MATCHES).map((e) => (
          <div
            key={e.ref.id}
            className={e.ref.id === pickedId ? 'list-item selected' : 'list-item'}
            onClick={() => {
              setPickedId(e.ref.id);
              setSide(e.doc.kind === 'player' ? 'player' : 'enemy');
            }}
          >
            <CreatureThumb creature={e.doc} className="creature-row-thumb" />
            <span className="grow">{e.doc.name}</span>
            <span className="muted small">
              CR {formatCr(e.doc.challenge)} · {e.doc.xp} XP
            </span>
          </div>
        ))}
        {matches.length > MAX_MATCHES && (
          <span className="muted small">{matches.length - MAX_MATCHES} more, refine the search</span>
        )}
        {entries.length === 0 && (
          <div className="row">
            <span className="muted small grow">No monsters yet: the app ships none.</span>
            <Button icon="download" label="Import from the D&D 5e API…" onClick={openDndApiImport} />
          </div>
        )}
        {entries.length > 0 && matches.length === 0 && <span className="muted small">No creature matches.</span>}
      </div>
      <NumberField label="Count" min={1} max={30} value={count} onChange={(v) => setCount(Math.round(v))} />
      <SelectField label="Side" value={side} options={sideSchema.options} onChange={setSide} />
      <SelectField
        label="Hit points"
        value={hpMode}
        options={['average', 'rolled'] as const}
        format={(m) => (m === 'average' ? 'Average' : 'Roll the formula')}
        onChange={setHpMode}
      />
      <div className="dialog-actions">
        <DifficultyBadge
          combatants={combatants}
          extraXp={picked && side === 'enemy' ? Array<number>(count).fill(picked.doc.xp) : []}
        />
        <Button
          icon="plus"
          label={picked ? `Add ${count} × ${picked.doc.name}` : 'Pick a creature'}
          variant="primary"
          disabled={!picked}
          onClick={add}
        />
      </div>
    </div>
  );
}

/** A player character typed in at the table, with an optional picture from the picture library. */
function PlayerCharacterForm() {
  const update = useEncounterStore((s) => s.update);
  const notify = useAppStore((s) => s.notify);
  const [name, setName] = useState('');
  const [armorClass, setArmorClass] = useState(14);
  const [maxHp, setMaxHp] = useState(20);
  const [darkvision, setDarkvision] = useState(0);
  const [visionSource, setVisionSource] = useState(true);
  const [level, setLevel] = useState(1);
  const [token, setToken] = useState<AssetRef | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const add = () => {
    const senses = darkvision > 0 ? { darkvision } : {};
    const pc = createPc({ name: name.trim(), armorClass, maxHp, senses, visionSource, level, token });
    update((d) => void d.combatants.push(pc), `Add ${pc.name}`);
    notify(`Added ${pc.name}`);
    close();
  };

  return (
    <div className="col">
      <TextField label="Name" value={name} onChange={setName} />
      <NumberField label="Level" min={1} max={20} value={level} onChange={(v) => setLevel(Math.round(v))} />
      <NumberField label="Armor class" value={armorClass} onChange={(v) => setArmorClass(Math.round(v))} />
      <NumberField label="Max HP" min={1} value={maxHp} onChange={(v) => setMaxHp(Math.round(v))} />
      <NumberField label="Darkvision" min={0} suffix="ft" value={darkvision} onChange={setDarkvision} />
      <CheckboxField label="Vision source" value={visionSource} onChange={setVisionSource} />
      <Field label="Picture">
        <div className="row">
          <AssetImage asset={token} alt="Picture" className="creature-thumb" />
          <Button icon="image" label="Library…" onClick={() => setLibraryOpen(true)} />
          <Button label="Clear" disabled={!token} onClick={() => setToken(null)} />
        </div>
      </Field>
      {libraryOpen && <PictureLibraryDialog onPick={setToken} onClose={() => setLibraryOpen(false)} />}
      <div className="dialog-actions">
        <Button
          icon="plus"
          label="Add player character"
          variant="primary"
          disabled={name.trim() === ''}
          onClick={add}
        />
      </div>
    </div>
  );
}

/** Player characters of the library (Aurora imports, own ones) to pick, or one typed in by hand. */
function PlayerCharacters() {
  const all = useLibraryStore((s) => s.listings.creature.listed);
  const combatants = useEncounterStore((s) => s.encounter)?.combatants ?? [];
  const update = useEncounterStore((s) => s.update);
  const notify = useAppStore((s) => s.notify);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const characters = all.filter((e) => e.doc.kind === 'player');
  const picked = characters.find((e) => e.ref.id === pickedId);
  const inEncounter = new Set(combatants.map((c) => c.creature?.id));

  const add = () => {
    if (picked) {
      update((d) => {
        const takenNames = d.combatants.map((c) => c.name);
        d.combatants.push(spawnCombatant(picked.doc, picked.ref, { hpMode: 'average', side: 'player', takenNames }));
      }, `Add ${picked.doc.name}`);
      notify(`Added ${picked.doc.name}`);
      close();
    }
  };

  return (
    <div className="col">
      <div className="row">
        <span className="muted grow">Characters in your library and packs</span>
        <Button
          icon="upload"
          label="From Aurora…"
          disabled={!isTauri()}
          title={isTauri() ? 'Import characters from Aurora Builder' : 'Needs the desktop app'}
          onClick={openAuroraImport}
        />
      </div>
      <div className="list add-matches">
        {characters.map((e) => (
          <div
            key={e.ref.id}
            className={e.ref.id === pickedId ? 'list-item selected' : 'list-item'}
            onClick={() => setPickedId(e.ref.id)}
          >
            <CreatureThumb creature={e.doc} className="creature-row-thumb" />
            <span className="grow">{e.doc.name}</span>
            <span className="muted small">
              {e.doc.level === null ? '' : `Level ${e.doc.level} · `}AC {e.doc.armorClass} · HP{' '}
              {e.doc.hitPoints.average}
              {inEncounter.has(e.ref.id) ? ' · in this encounter' : ''}
            </span>
          </div>
        ))}
        {characters.length === 0 && (
          <span className="muted small">
            No player characters yet: import them from Aurora Builder or create a creature of kind &quot;player&quot;.
          </span>
        )}
      </div>
      <div className="dialog-actions">
        <DifficultyBadge combatants={combatants} />
        <Button
          icon="plus"
          label={picked ? `Add ${picked.doc.name}` : 'Pick a character'}
          variant="primary"
          disabled={!picked}
          onClick={add}
        />
      </div>
      <details>
        <summary>Enter by hand</summary>
        <PlayerCharacterForm />
      </details>
    </div>
  );
}

/** Every member of the campaign's party who is not in the encounter yet, as seeing player characters. */
function AddParty() {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const update = useEncounterStore((s) => s.update);
  const campaignId = useEncounterStore((s) => s.encounter?.campaignId);
  const combatants = useEncounterStore((s) => s.encounter)?.combatants ?? [];
  const entries = useLibraryStore((s) => s.listings.creature.entries);
  const [party, setParty] = useState<PartyMember[] | null>(null);

  useEffect(() => {
    repository
      .listCampaigns()
      .then(({ campaigns }) => setParty(campaigns.find((c) => c.id === campaignId)?.party ?? []), reportError);
  }, [repository, campaignId, reportError]);

  // By creature id only: a user override keeps the pack character's id.
  const members = (party ?? []).flatMap((member) => {
    const creature = entries.find((e) => e.ref.id === member.creature.id)?.doc;
    return creature ? [{ member, creature }] : [];
  });
  const present = new Set(combatants.map((c) => c.id));
  const joining = members.filter((m) => !present.has(m.member.id));
  const missing = (party?.length ?? 0) - members.length;
  const names = joining.map((m) => m.creature.name).join(', ');
  const status =
    party === null
      ? 'Loading the party…'
      : party.length === 0
        ? "The campaign has no party yet; pick it on the campaign's Party tab."
        : joining.length === 0
          ? 'The whole party is in this encounter.'
          : `Party: ${names}`;

  const add = () => {
    update((d) => void addParty(d, members), 'Add the party');
    notify(`Added ${names}`);
    close();
  };

  return (
    <div className="row">
      <span className="muted grow">
        {status}
        {missing > 0 && ` (${missing} no longer in the compendium)`}
      </span>
      <Button icon="users" label="Add party" disabled={joining.length === 0} onClick={add} />
    </div>
  );
}

/** "+ Add" of the initiative strip: the campaign's party, creatures from the compendium or a player character. */
export function AddCombatantsDialog() {
  const [tab, setTab] = useState<AddTab>('library');
  return (
    <Dialog title="Add combatants" onClose={close} width={480}>
      <div className="col">
        <AddParty />
        <Tabs tabs={ADD_TABS} value={tab} onChange={setTab} label="Add from" />
        {tab === 'library' ? <FromLibrary /> : <PlayerCharacters />}
      </div>
    </Dialog>
  );
}
