import type { Draft } from 'immer';
import { useState } from 'react';
import {
  CONDITIONS,
  SENSES,
  SIZES,
  sideSchema,
  type Combatant,
  type CreatureAction,
  type Encounter,
  type LogEntry,
} from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { addLog, applyDamage, applyHealing, grantTempHp, rollAttack, type HitPoints } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { CheckboxField, NumberField, SelectField, TextField } from '../components/fields';
import { OptionalNumberField } from '../creature/creatureFields';
import { StatBlock, titleCase } from '../creature/StatBlock';
import { useCreature } from './creatureLookup';
import { useEncounterUi } from './encounterUiStore';

type HpChange = 'damage' | 'heal' | 'temp';

const HP_CHANGES: Record<HpChange, { apply: (hp: HitPoints, n: number) => HitPoints; log: LogEntry['kind'] }> = {
  damage: { apply: applyDamage, log: 'damage' },
  heal: { apply: applyHealing, log: 'heal' },
  temp: { apply: grantTempHp, log: 'note' },
};

function hpLogText(change: HpChange, name: string, amount: number, before: number, after: number): string {
  const verb = change === 'damage' ? `takes ${amount} damage` : `heals ${amount}`;
  return change === 'temp' ? `${name} gains ${amount} temporary HP` : `${name} ${verb}: ${before} → ${after} HP`;
}

type Patch = (recipe: (combatant: Draft<Combatant>, encounter: Draft<Encounter>) => void) => void;

function HitPointControls({ c, patch }: { c: Combatant; patch: Patch }) {
  const [amount, setAmount] = useState('');
  const value = Math.round(Number(amount));
  const valid = amount.trim() !== '' && Number.isFinite(value) && value > 0;

  const apply = (change: HpChange) => {
    patch((d, encounter) => {
      const before = d.hp.current;
      d.hp = HP_CHANGES[change].apply(d.hp, value);
      addLog(encounter, HP_CHANGES[change].log, hpLogText(change, d.name, value, before, d.hp.current));
    });
    setAmount('');
  };

  return (
    <div className="col">
      <div className="hp-line">
        <strong>
          HP {c.hp.current} / {c.hp.max}
        </strong>
        {c.hp.temp > 0 && <span className="muted"> + {c.hp.temp} temp</span>}
      </div>
      <div className="row">
        <input
          type="number"
          min={1}
          placeholder="Amount"
          value={amount}
          className="grow"
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid) apply('damage');
          }}
        />
        <button className="danger" disabled={!valid} onClick={() => apply('damage')}>
          Damage
        </button>
        <button disabled={!valid} onClick={() => apply('heal')}>
          Heal
        </button>
        <button disabled={!valid} onClick={() => apply('temp')}>
          Temp
        </button>
      </div>
    </div>
  );
}

function ConditionChips({ c, patch }: { c: Combatant; patch: Patch }) {
  return (
    <div className="chips">
      {CONDITIONS.map((cond) => {
        const on = c.conditions.includes(cond);
        return (
          <button
            key={cond}
            className={on ? 'chip active' : 'chip'}
            onClick={() =>
              patch((d, encounter) => {
                d.conditions = on ? d.conditions.filter((x) => x !== cond) : [...d.conditions, cond];
                addLog(encounter, 'note', `${d.name} ${on ? 'is no longer' : 'is'} ${cond}`);
              })
            }
          >
            {cond}
          </button>
        );
      })}
    </div>
  );
}

function CombatantDetails({ c, hasMap }: { c: Combatant; hasMap: boolean }) {
  const update = useEncounterStore((s) => s.update);
  const reportError = useAppStore((s) => s.reportError);
  const rollMode = useEncounterUi((s) => s.rollMode);
  const placingId = useEncounterUi((s) => s.placingId);
  const creature = useCreature(c.creature);
  const patch: Patch = (recipe) =>
    update((encounter) => {
      const target = encounter.combatants.find((x) => x.id === c.id);
      if (target) recipe(target, encounter);
    });

  // Library data may carry dice formulas that don't parse.
  const attack = (action: CreatureAction) => {
    try {
      const result = action.attack && rollAttack(c.name, action.name, action.attack, rollMode);
      if (result) update((d) => addLog(d, 'roll', result.text));
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div className="col">
      <div className="panel">
        <TextField label="Name" value={c.name} onChange={(v) => patch((d) => void (d.name = v))} />
        <HitPointControls c={c} patch={patch} />
        <h3>Conditions</h3>
        <ConditionChips c={c} patch={patch} />
        <h3>Players</h3>
        <CheckboxField
          label="Hidden"
          value={c.hiddenFromPlayers}
          onChange={(v) => patch((d) => void (d.hiddenFromPlayers = v))}
        />
        <CheckboxField
          label="Vision source"
          value={c.visionSource}
          onChange={(v) => patch((d) => void (d.visionSource = v))}
        />
        {hasMap && (
          <div className="row wrap">
            {c.position ? (
              <>
                <NumberField
                  label="Elevation"
                  suffix="ft"
                  value={c.position.elevationFt}
                  onChange={(v) => patch((d) => void (d.position && (d.position.elevationFt = v)))}
                />
                <button onClick={() => patch((d) => void (d.position = null))}>Remove from map</button>
              </>
            ) : (
              <button
                className={placingId === c.id ? 'active' : ''}
                onClick={() => useEncounterUi.setState({ placingId: c.id, placement: null, tool: 'select' })}
              >
                Place on map…
              </button>
            )}
          </div>
        )}
        <TextField label="Notes" multiline value={c.notes} onChange={(v) => patch((d) => void (d.notes = v))} />
        <details>
          <summary className="muted">Combat stats</summary>
          <SelectField
            label="Side"
            value={c.side}
            options={sideSchema.options}
            onChange={(v) => patch((d) => void (d.side = v))}
          />
          <SelectField label="Size" value={c.size} options={SIZES} onChange={(v) => patch((d) => void (d.size = v))} />
          <NumberField
            label="Armor class"
            value={c.armorClass}
            onChange={(v) => patch((d) => void (d.armorClass = v))}
          />
          <NumberField
            label="Current HP"
            value={c.hp.current}
            onChange={(v) => patch((d) => void (d.hp.current = Math.round(v)))}
          />
          <NumberField
            label="Max HP"
            min={0}
            value={c.hp.max}
            onChange={(v) => patch((d) => void (d.hp.max = Math.round(v)))}
          />
          {SENSES.map((s) => (
            <OptionalNumberField
              key={s}
              label={titleCase(s)}
              suffix="ft"
              value={c.senses[s]}
              onChange={(v) =>
                patch((d) => {
                  if (v === undefined) delete d.senses[s];
                  else d.senses[s] = Math.max(0, v);
                })
              }
            />
          ))}
        </details>
      </div>
      {creature && (
        <div className="panel">
          <StatBlock creature={creature} onAttack={attack} />
        </div>
      )}
    </div>
  );
}

/** Details of the selected combatant: hit points, conditions, visibility, notes, stat block with attacks. */
export function CombatantPanel() {
  const combatant = useEncounterStore((s) => s.encounter?.combatants.find((c) => c.id === s.selectedCombatantId));
  const hasMap = useEncounterStore((s) => s.map !== null);
  return combatant ? (
    <CombatantDetails key={combatant.id} c={combatant} hasMap={hasMap} />
  ) : (
    <div className="panel muted">Select a combatant in the tracker or on the map.</div>
  );
}
