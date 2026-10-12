import { useState } from 'react';
import { sideSchema, type Side } from '@/core/model';
import { formatCr } from '@/core/rules/abilities';
import { useAppStore } from '@/state/appStore';
import { createPc, spawnCombatant, type HpMode } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { useLibraryStore } from '@/state/libraryStore';
import { CheckboxField, NumberField, SelectField, TextField } from '../components/fields';

const MAX_MATCHES = 8;

function FromLibrary() {
  const entries = useLibraryStore((s) => s.listings.creature.entries);
  const update = useEncounterStore((s) => s.update);
  const reportError = useAppStore((s) => s.reportError);
  const [search, setSearch] = useState('');
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [count, setCount] = useState(1);
  const [side, setSide] = useState<Side>('enemy');
  const [hpMode, setHpMode] = useState<HpMode>('average');
  const picked = entries.find((e) => e.ref.id === pickedId);
  const needle = search.toLowerCase();
  const matches = needle === '' ? [] : entries.filter((e) => e.doc.name.toLowerCase().includes(needle));

  // A library creature with a broken HP formula fails only when rolled.
  const add = () => {
    try {
      update((d) => {
        for (let i = 0; i < count && picked; i++) {
          const takenNames = d.combatants.map((c) => c.name);
          d.combatants.push(spawnCombatant(picked.doc, picked.ref, { hpMode, side, takenNames }));
        }
      });
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div className="col">
      <h3>From the creature library</h3>
      <input placeholder="Search creatures" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="list">
        {matches.slice(0, MAX_MATCHES).map((e) => (
          <div
            key={e.ref.id}
            className={e.ref.id === pickedId ? 'list-item selected' : 'list-item'}
            onClick={() => {
              setPickedId(e.ref.id);
              setSide(e.doc.kind === 'player' ? 'player' : 'enemy');
            }}
          >
            <span className="grow">{e.doc.name}</span>
            <span className="muted small">CR {formatCr(e.doc.challenge)}</span>
          </div>
        ))}
        {matches.length > MAX_MATCHES && <span className="muted small">{matches.length - MAX_MATCHES} more…</span>}
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
      <button className="primary" disabled={!picked} onClick={add}>
        Add {picked ? `${count} × ${picked.doc.name}` : ''}
      </button>
    </div>
  );
}

function PlayerCharacterForm() {
  const update = useEncounterStore((s) => s.update);
  const [name, setName] = useState('');
  const [armorClass, setArmorClass] = useState(14);
  const [maxHp, setMaxHp] = useState(20);
  const [darkvision, setDarkvision] = useState(0);
  const [visionSource, setVisionSource] = useState(true);

  const add = () => {
    const senses = darkvision > 0 ? { darkvision } : {};
    update((d) => void d.combatants.push(createPc({ name: name.trim(), armorClass, maxHp, senses, visionSource })));
    setName('');
  };

  return (
    <div className="col">
      <h3>Player character</h3>
      <TextField label="Name" value={name} onChange={setName} />
      <NumberField label="Armor class" value={armorClass} onChange={(v) => setArmorClass(Math.round(v))} />
      <NumberField label="Max HP" min={1} value={maxHp} onChange={(v) => setMaxHp(Math.round(v))} />
      <NumberField label="Darkvision" min={0} suffix="ft" value={darkvision} onChange={setDarkvision} />
      <CheckboxField label="Vision source" value={visionSource} onChange={setVisionSource} />
      <button className="primary" disabled={name.trim() === ''} onClick={add}>
        Add player character
      </button>
    </div>
  );
}

export function AddCombatants() {
  return (
    <div className="panel">
      <h2>Add combatants</h2>
      <FromLibrary />
      <hr className="separator" />
      <PlayerCharacterForm />
    </div>
  );
}
