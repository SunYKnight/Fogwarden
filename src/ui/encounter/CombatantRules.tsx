import { useState } from 'react';
import { CONDITIONS, type CarriedLight, type Combatant, type Condition, type Creature } from '@/core/model';
import { creatureResources } from '@/core/rules/resources';
import { useAppStore } from '@/state/appStore';
import {
  addEffect,
  describeExpiry,
  effectExpiry,
  removeEffect,
  rollDeathSave,
  stabilize,
  type EffectDuration,
} from '@/state/combatRules';
import { addLog, currentCombatant } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { CheckboxField, NumberField, SelectField, TextField } from '../components/fields';
import { titleCase } from '../creature/StatBlock';
import { Button, Section } from '../kit';
import { patchCombatant } from './combatantCommands';

/** Row of `total` pips, the first `used` filled; clicking a pip fills up to it or empties from it. */
function Pips({
  label,
  total,
  used,
  tone,
  onChange,
}: {
  label: string;
  total: number;
  used: number;
  tone: 'good' | 'bad' | 'spent';
  onChange: (used: number) => void;
}) {
  return (
    <span className="pips" role="group" aria-label={`${label}: ${used} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <button
          key={i}
          type="button"
          className={i < used ? `pip filled ${tone}` : 'pip'}
          aria-pressed={i < used}
          aria-label={`${label} ${i + 1}`}
          onClick={() => onChange(i < used ? i : i + 1)}
        />
      ))}
    </span>
  );
}

/** Success and failure pips, roll and stabilize for a player character at 0 hit points. */
export function DeathSaves({ c }: { c: Combatant }) {
  const notify = useAppStore((s) => s.notify);
  const { successes, failures } = c.deathSaves;
  const status = failures >= 3 ? 'Dead' : successes >= 3 ? 'Stable' : 'Dying';
  const set = (key: 'successes' | 'failures', value: number) =>
    patchCombatant(c.id, `Death saves of ${c.name}`, (d) => void (d.deathSaves[key] = value));
  const roll = () => {
    let natural = 0;
    patchCombatant(c.id, `Death save ${c.name}`, (d, encounter) => {
      natural = rollDeathSave(encounter, d).total;
    });
    notify(`${c.name} rolls ${natural} on a death save`, 'info');
  };
  return (
    <Section title={`Death saves · ${status}`}>
      <div className="death-saves">
        <span className="muted small">Successes</span>
        <Pips label="Success" total={3} used={successes} tone="good" onChange={(v) => set('successes', v)} />
        <span className="muted small">Failures</span>
        <Pips label="Failure" total={3} used={failures} tone="bad" onChange={(v) => set('failures', v)} />
      </div>
      <div className="row">
        <Button icon="dice" label="Roll death save" variant="primary" disabled={status !== 'Dying'} onClick={roll} />
        <Button
          icon="heart"
          label="Stabilize"
          disabled={status !== 'Dying'}
          onClick={() => patchCombatant(c.id, `Stabilize ${c.name}`, (d, e) => stabilize(e, d))}
        />
      </div>
    </Section>
  );
}

type DurationKind = 'none' | 'rounds' | 'end' | 'start';

const DURATION_LABEL: Record<DurationKind, string> = {
  none: 'Until removed',
  rounds: 'Rounds',
  end: 'Until end of a turn',
  start: 'Until start of a turn',
};
const DURATION_KINDS = Object.keys(DURATION_LABEL) as DurationKind[];
const NO_CONDITION = 'none';

function AddEffectForm({ c }: { c: Combatant }) {
  const combatants = useEncounterStore((s) => s.encounter)?.combatants ?? [];
  const current = useEncounterStore((s) => s.encounter && currentCombatant(s.encounter));
  const [name, setName] = useState('');
  const [condition, setCondition] = useState<Condition | typeof NO_CONDITION>(NO_CONDITION);
  const [kind, setKind] = useState<DurationKind>('rounds');
  const [rounds, setRounds] = useState(10);
  const [turnOf, setTurnOf] = useState<string>(current?.id ?? c.id);
  const ofId = combatants.some((x) => x.id === turnOf) ? turnOf : c.id;
  const effectName = name.trim() || (condition === NO_CONDITION ? '' : titleCase(condition));
  const duration: EffectDuration =
    kind === 'none' ? { kind } : kind === 'rounds' ? { kind, rounds } : { kind: 'turn', of: ofId, at: kind };

  const add = () => {
    patchCombatant(c.id, `${effectName} on ${c.name}`, (d, encounter) =>
      addEffect(
        encounter,
        d,
        effectName,
        condition === NO_CONDITION ? null : condition,
        effectExpiry(encounter, d.id, duration),
      ),
    );
    setName('');
    setCondition(NO_CONDITION);
  };

  return (
    <div className="col effect-form">
      <div className="row">
        <TextField label="Effect" placeholder="Bless, Hold Person…" value={name} onChange={setName} />
        <SelectField
          label="Condition"
          value={condition}
          options={[NO_CONDITION, ...CONDITIONS]}
          format={(v) => (v === NO_CONDITION ? 'None' : titleCase(v))}
          onChange={setCondition}
        />
      </div>
      <div className="row">
        <SelectField
          label="Lasts"
          value={kind}
          options={DURATION_KINDS}
          format={(k) => DURATION_LABEL[k]}
          onChange={setKind}
        />
        {kind === 'rounds' && (
          <NumberField label="Rounds" min={1} max={100} value={rounds} onChange={(v) => setRounds(Math.round(v))} />
        )}
        {(kind === 'end' || kind === 'start') && (
          <SelectField
            label="Of"
            value={ofId}
            options={combatants.map((x) => x.id)}
            format={(id) => combatants.find((x) => x.id === id)?.name ?? id}
            onChange={setTurnOf}
          />
        )}
      </div>
      <Button icon="plus" label="Add effect" disabled={effectName === ''} onClick={add} />
    </div>
  );
}

/** Timed effects and concentration; expired effects are removed when turns advance. */
export function EffectsSection({ c }: { c: Combatant }) {
  const encounter = useEncounterStore((s) => s.encounter);
  return (
    <Section title="Timed effects">
      <CheckboxField
        label="Concentrating (asks for a CON save on damage)"
        value={c.concentrating}
        onChange={(v) =>
          patchCombatant(c.id, `Concentration of ${c.name}`, (d, e) => {
            d.concentrating = v;
            addLog(e, 'note', `${d.name} ${v ? 'concentrates' : 'stops concentrating'}`);
          })
        }
      />
      {c.effects.length > 0 && encounter && (
        <ul className="effect-list">
          {c.effects.map((effect) => (
            <li key={effect.id} className="row">
              <span className="grow">
                {effect.name}
                <span className="muted small">
                  {' '}
                  {effect.expires ? `until ${describeExpiry(encounter, effect.expires)}` : 'until removed'}
                </span>
              </span>
              <Button
                icon="close"
                label={`End ${effect.name}`}
                iconOnly
                variant="ghost"
                onClick={() => patchCombatant(c.id, `End ${effect.name}`, (d, e) => removeEffect(e, d, effect.id))}
              />
            </li>
          ))}
        </ul>
      )}
      <AddEffectForm c={c} />
    </Section>
  );
}

const ORDINAL: Record<string, string> = {
  '1': '1st',
  '2': '2nd',
  '3': '3rd',
  '4': '4th',
  '5': '5th',
  '6': '6th',
  '7': '7th',
  '8': '8th',
  '9': '9th',
};

/** Legendary actions, recharge abilities, spell slots and per-day uses the stat block lists. */
export function ResourcesSection({ c, creature }: { c: Combatant; creature: Creature }) {
  const r = creatureResources(creature);
  const any = r.legendary > 0 || r.recharge.length > 0 || Object.keys(r.slots).length > 0 || r.daily.length > 0;
  const used = c.resources;
  const patch = (label: string, recipe: (d: Combatant['resources']) => void) =>
    patchCombatant(c.id, `${label} of ${c.name}`, (d) => recipe(d.resources));
  return any || r.lair ? (
    <Section title="Resources">
      <div className="resource-grid">
        {r.legendary > 0 && (
          <span className="resource-row">
            <span>Legendary actions</span>
            <Pips
              label="Legendary action"
              total={r.legendary}
              used={used.legendaryUsed}
              tone="spent"
              onChange={(v) => patch('Legendary actions', (d) => void (d.legendaryUsed = v))}
            />
          </span>
        )}
        {r.recharge.map(({ name, min }) => {
          const spent = used.recharging.includes(name);
          return (
            <span key={name} className="resource-row">
              <span title={min === null ? 'Recharges after a rest' : `Recharges on ${min}-6 at its turn start`}>
                {name}
              </span>
              <Button
                label={spent ? 'Spent' : 'Ready'}
                active={!spent}
                onClick={() =>
                  patch(name, (d) => {
                    d.recharging = spent ? d.recharging.filter((n) => n !== name) : [...d.recharging, name];
                  })
                }
              />
            </span>
          );
        })}
        {Object.entries(r.slots).map(([level, total]) => (
          <span key={level} className="resource-row">
            <span>{ORDINAL[level] ?? level} level slots</span>
            <Pips
              label={`${ORDINAL[level] ?? level} level slot`}
              total={total}
              used={used.slotsUsed[level] ?? 0}
              tone="spent"
              onChange={(v) => patch('Spell slots', (d) => void (d.slotsUsed[level] = v))}
            />
          </span>
        ))}
        {r.daily.map(({ name, max }) => (
          <span key={name} className="resource-row">
            <span>{name} (per day)</span>
            <Pips
              label={name}
              total={max}
              used={used.dailyUsed[name] ?? 0}
              tone="spent"
              onChange={(v) => patch(name, (d) => void (d.dailyUsed[name] = v))}
            />
          </span>
        ))}
      </div>
      {r.lair && <p className="muted small">Lair actions: a reminder appears on initiative 20.</p>}
    </Section>
  ) : null;
}

type LightPreset = 'none' | 'candle' | 'torch' | 'lantern' | 'light';

// PHB light sources: bright radius, then as much dim light again.
const LIGHT_PRESETS: Record<LightPreset, CarriedLight | null> = {
  none: null,
  candle: { name: 'Candle', brightFt: 5, dimFt: 5, color: '#ffc46b' },
  torch: { name: 'Torch', brightFt: 20, dimFt: 20, color: '#ffb347' },
  lantern: { name: 'Lantern', brightFt: 30, dimFt: 30, color: '#ffd28a' },
  light: { name: 'Light (cantrip)', brightFt: 20, dimFt: 20, color: '#fff4dc' },
};
const LIGHT_KINDS = Object.keys(LIGHT_PRESETS) as LightPreset[];

/** Light following the token; it lights the map for every vision source. */
export function CarriedLightField({ c }: { c: Combatant }) {
  const value = LIGHT_KINDS.find((k) => LIGHT_PRESETS[k]?.name === c.light?.name) ?? 'none';
  return (
    <SelectField
      label="Carries light"
      value={value}
      options={LIGHT_KINDS}
      format={(k) => {
        const light = LIGHT_PRESETS[k];
        return light ? `${light.name} (${light.brightFt} ft + ${light.dimFt} ft dim)` : 'None';
      }}
      onChange={(k) =>
        patchCombatant(c.id, `Light of ${c.name}`, (d, e) => {
          d.light = LIGHT_PRESETS[k];
          addLog(
            e,
            'note',
            d.light ? `${d.name} carries a ${d.light.name.toLowerCase()}` : `${d.name} carries no light`,
          );
        })
      }
    />
  );
}
