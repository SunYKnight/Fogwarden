import type { ReactNode } from 'react';
import {
  ATTACK_KINDS,
  DAMAGE_TYPES,
  type AttackRoll,
  type CreatureAction,
  type DamageRoll,
  type LegendaryAction,
  type Trait,
} from '@/core/model';
import { CheckboxField, NumberField, SelectField, TextField } from '../components/fields';
import { OptionalNumberField } from './creatureFields';

interface ListEditorProps<T> {
  title: string;
  items: T[];
  onChange: (items: T[]) => void;
  create: () => T;
  renderItem: (item: T, set: (next: T) => void) => ReactNode;
}

/** Ordered list with add, remove and move-up; items are edited by `renderItem`. */
export function ListEditor<T>({ title, items, onChange, create, renderItem }: ListEditorProps<T>) {
  const moveUp = (i: number) => onChange(items.map((x, j) => (j === i - 1 ? items[i]! : j === i ? items[i - 1]! : x)));
  return (
    <div className="col">
      <div className="row">
        <h3 style={{ margin: 0 }}>{title}</h3>
        <div className="spacer" />
        <button onClick={() => onChange([...items, create()])}>+ Add</button>
      </div>
      {items.map((item, i) => (
        <div key={i} className="entry-editor">
          <div className="row entry-tools">
            <button disabled={i === 0} title="Move up" onClick={() => moveUp(i)}>
              ↑
            </button>
            <button className="danger" title="Remove" onClick={() => onChange(items.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
          {renderItem(item, (next) => onChange(items.map((x, j) => (j === i ? next : x))))}
        </div>
      ))}
    </div>
  );
}

export function TraitListEditor(props: { title: string; items: Trait[]; onChange: (items: Trait[]) => void }) {
  return (
    <ListEditor
      {...props}
      create={() => ({ name: 'New trait', description: '' })}
      renderItem={(t, set) => (
        <>
          <TextField label="Name" value={t.name} onChange={(name) => set({ ...t, name })} />
          <TextField
            label="Description"
            multiline
            value={t.description}
            onChange={(description) => set({ ...t, description })}
          />
        </>
      )}
    />
  );
}

export function LegendaryListEditor(props: { items: LegendaryAction[]; onChange: (items: LegendaryAction[]) => void }) {
  return (
    <ListEditor
      {...props}
      title="Legendary actions"
      create={() => ({ name: 'New legendary action', description: '', cost: 1 })}
      renderItem={(l, set) => (
        <>
          <TextField label="Name" value={l.name} onChange={(name) => set({ ...l, name })} />
          <NumberField label="Cost" value={l.cost} min={1} max={3} onChange={(cost) => set({ ...l, cost })} />
          <TextField
            label="Description"
            multiline
            value={l.description}
            onChange={(description) => set({ ...l, description })}
          />
        </>
      )}
    />
  );
}

const DEFAULT_ATTACK: AttackRoll = {
  kind: 'melee-weapon',
  toHit: 4,
  reachFt: 5,
  rangeFt: null,
  targets: 'one target',
  damage: [{ formula: '1d6+2', type: 'slashing' }],
};

function AttackEditor({ attack, set }: { attack: AttackRoll; set: (next: AttackRoll) => void }) {
  return (
    <div className="attack-editor">
      <SelectField
        label="Attack"
        value={attack.kind}
        options={ATTACK_KINDS}
        onChange={(kind) => set({ ...attack, kind })}
      />
      <NumberField label="To hit" value={attack.toHit} onChange={(toHit) => set({ ...attack, toHit })} />
      <OptionalNumberField
        label="Reach"
        suffix="ft"
        value={attack.reachFt ?? undefined}
        onChange={(reach) => set({ ...attack, reachFt: reach ?? null })}
      />
      <OptionalNumberField
        label="Range"
        suffix="ft"
        value={attack.rangeFt?.normal}
        onChange={(normal) =>
          set({ ...attack, rangeFt: normal === undefined ? null : { normal, long: attack.rangeFt?.long ?? normal } })
        }
      />
      {attack.rangeFt && (
        <NumberField
          label="Long range"
          suffix="ft"
          min={0}
          value={attack.rangeFt.long}
          onChange={(long) => set({ ...attack, rangeFt: { normal: attack.rangeFt!.normal, long } })}
        />
      )}
      <TextField label="Targets" value={attack.targets} onChange={(targets) => set({ ...attack, targets })} />
      <ListEditor<DamageRoll>
        title="Damage"
        items={attack.damage}
        onChange={(damage) => set({ ...attack, damage })}
        create={() => ({ formula: '1d6', type: 'slashing' })}
        renderItem={(d, setDamage) => (
          <>
            <TextField label="Dice" value={d.formula} onChange={(formula) => setDamage({ ...d, formula })} />
            <SelectField
              label="Type"
              value={d.type}
              options={DAMAGE_TYPES}
              onChange={(type) => setDamage({ ...d, type })}
            />
          </>
        )}
      />
    </div>
  );
}

export function ActionListEditor(props: {
  title: string;
  items: CreatureAction[];
  onChange: (items: CreatureAction[]) => void;
}) {
  return (
    <ListEditor
      {...props}
      create={() => ({ name: 'New action', description: '', attack: null })}
      renderItem={(a, set) => (
        <>
          <TextField label="Name" value={a.name} onChange={(name) => set({ ...a, name })} />
          <TextField
            label="Description"
            multiline
            value={a.description}
            placeholder="Empty: generated from the attack data"
            onChange={(description) => set({ ...a, description })}
          />
          <CheckboxField
            label="Attack roll"
            value={a.attack !== null}
            onChange={(on) => set({ ...a, attack: on ? DEFAULT_ATTACK : null })}
          />
          {a.attack && <AttackEditor attack={a.attack} set={(attack) => set({ ...a, attack })} />}
        </>
      )}
    />
  );
}
