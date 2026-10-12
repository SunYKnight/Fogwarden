import { useState } from 'react';
import { sideSchema, type Side } from '@/core/model';
import { formatCr } from '@/core/rules/abilities';
import { useAppStore } from '@/state/appStore';
import { createPc, spawnCombatant, type HpMode } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { useLibraryStore } from '@/state/libraryStore';
import { CheckboxField, NumberField, SelectField, TextField } from '../components/fields';
import { CreatureThumb } from '../creatureTypes/CreatureThumb';
import { Button, Dialog, Tabs, type TabSpec } from '../kit';
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
  const entries = useLibraryStore((s) => s.listings.creature.entries);
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
        {matches.length === 0 && <span className="muted small">No creature matches.</span>}
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

function PlayerCharacterForm() {
  const update = useEncounterStore((s) => s.update);
  const combatants = useEncounterStore((s) => s.encounter)?.combatants ?? [];
  const notify = useAppStore((s) => s.notify);
  const [name, setName] = useState('');
  const [armorClass, setArmorClass] = useState(14);
  const [maxHp, setMaxHp] = useState(20);
  const [darkvision, setDarkvision] = useState(0);
  const [visionSource, setVisionSource] = useState(true);
  const [level, setLevel] = useState(1);

  const add = () => {
    const senses = darkvision > 0 ? { darkvision } : {};
    const pc = createPc({ name: name.trim(), armorClass, maxHp, senses, visionSource, level });
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
      <div className="dialog-actions">
        <DifficultyBadge combatants={combatants} />
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

/** "+ Add" of the initiative strip: creatures from the compendium or an ad-hoc player character. */
export function AddCombatantsDialog() {
  const [tab, setTab] = useState<AddTab>('library');
  return (
    <Dialog title="Add combatants" onClose={close} width={480}>
      <div className="col">
        <Tabs tabs={ADD_TABS} value={tab} onChange={setTab} label="Add from" />
        {tab === 'library' ? <FromLibrary /> : <PlayerCharacterForm />}
      </div>
    </Dialog>
  );
}
