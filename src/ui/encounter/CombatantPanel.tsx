import { useState } from 'react';
import {
  CONDITIONS,
  SENSES,
  SIZES,
  sideSchema,
  type Combatant,
  type CreatureAction,
  type Encounter,
} from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { CheckboxField, NumberField, SelectField, TextField } from '../components/fields';
import { OptionalNumberField } from '../creature/creatureFields';
import { StatBlock, titleCase } from '../creature/StatBlock';
import { Button, Popover, Section } from '../kit';
import { attackActions, attackLabel, resultSummary } from './attacks';
import {
  changeHp,
  confirmRemoveFromEncounter,
  patchCombatant,
  removeFromMap,
  rollAction,
  setCurrentHp,
  setHidden,
  toggleCondition,
} from './combatantCommands';
import { CarriedLightField, DeathSaves, EffectsSection, ResourcesSection } from './CombatantRules';
import { useCreature, useDisabledPackOf } from './creatureLookup';
import { EncounterOverview } from './EncounterOverview';
import { HpBar } from './HpBar';
import { startPlacing, useEncounterUi, type HpChange } from './encounterUiStore';

function HitPointControls({ c }: { c: Combatant }) {
  const [amount, setAmount] = useState('');
  const value = Math.round(Number(amount));
  const valid = amount.trim() !== '' && Number.isFinite(value) && value > 0;

  const apply = (change: HpChange) => {
    changeHp(c.id, change, value);
    setAmount('');
  };

  return (
    <div className="col">
      <div className="row">
        <strong className="hp">
          HP {c.hp.current} / {c.hp.max}
        </strong>
        {c.hp.temp > 0 && <span className="muted"> + {c.hp.temp} temp</span>}
        <div className="spacer" />
        <span className="muted">AC {c.armorClass}</span>
      </div>
      <HpBar hp={c.hp} />
      <div className="row">
        <Button
          icon="minus"
          label="Damage"
          iconOnly
          variant="danger"
          disabled={!valid}
          onClick={() => apply('damage')}
        />
        <input
          type="number"
          min={1}
          placeholder="Amount"
          aria-label="Hit point amount"
          value={amount}
          className="grow"
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid) apply('damage');
          }}
        />
        <Button icon="plus" label="Heal" iconOnly disabled={!valid} onClick={() => apply('heal')} />
        <Button label="Temp" disabled={!valid} onClick={() => apply('temp')} />
      </div>
    </div>
  );
}

/** Active conditions as chips (click removes); the picker holds all of them. */
function ConditionPicker({ c }: { c: Combatant }) {
  return (
    <div className="chips">
      {c.conditions.map((cond) => (
        <button
          key={cond}
          type="button"
          className="chip active"
          title={`Remove ${cond}`}
          onClick={() => toggleCondition(c.id, cond)}
        >
          {cond}
        </button>
      ))}
      <Popover
        label="Conditions"
        trigger={(open, toggle) => <Button icon="plus" label="Condition" active={open} onClick={toggle} />}
      >
        <div className="chips condition-popover">
          {CONDITIONS.map((cond) => (
            <button
              key={cond}
              type="button"
              aria-pressed={c.conditions.includes(cond)}
              className={c.conditions.includes(cond) ? 'chip active' : 'chip'}
              onClick={() => toggleCondition(c.id, cond)}
            >
              {cond}
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

function CombatStats({ c }: { c: Combatant }) {
  return (
    <>
      <SelectField
        label="Side"
        value={c.side}
        options={sideSchema.options}
        onChange={(v) => patchCombatant(c.id, `Side of ${c.name}`, (d) => void (d.side = v))}
      />
      <SelectField
        label="Size"
        value={c.size}
        options={SIZES}
        onChange={(v) => patchCombatant(c.id, `Size of ${c.name}`, (d) => void (d.size = v))}
      />
      <NumberField
        label="Armor class"
        value={c.armorClass}
        onChange={(v) => patchCombatant(c.id, `AC of ${c.name}`, (d) => void (d.armorClass = v))}
      />
      <NumberField label="Current HP" value={c.hp.current} onChange={(v) => setCurrentHp(c.id, Math.round(v))} />
      <NumberField
        label="Max HP"
        min={0}
        value={c.hp.max}
        onChange={(v) => patchCombatant(c.id, `Max HP of ${c.name}`, (d) => void (d.hp.max = Math.round(v)))}
      />
      {SENSES.map((s) => (
        <OptionalNumberField
          key={s}
          label={titleCase(s)}
          suffix="ft"
          value={c.senses[s]}
          onChange={(v) =>
            patchCombatant(c.id, `${titleCase(s)} of ${c.name}`, (d) => {
              if (v === undefined) delete d.senses[s];
              else d.senses[s] = Math.max(0, v);
            })
          }
        />
      ))}
    </>
  );
}

function MapPlacement({ c }: { c: Combatant }) {
  const placingId = useEncounterUi((s) => s.placingId);
  return c.position ? (
    <div className="row">
      <NumberField
        label="Elevation"
        suffix="ft"
        value={c.position.elevationFt}
        onChange={(v) =>
          patchCombatant(c.id, `Elevation of ${c.name}`, (d) => void (d.position && (d.position.elevationFt = v)))
        }
      />
      <Button icon="close" label="Remove from map" onClick={() => removeFromMap(c.id)} />
    </div>
  ) : (
    <Button icon="map" label="Place on map" active={placingId === c.id} onClick={() => startPlacing(c.id, false)} />
  );
}

function CombatantDetails({ c, hasMap }: { c: Combatant; hasMap: boolean }) {
  const reportError = useAppStore((s) => s.reportError);
  const rollMode = useEncounterUi((s) => s.rollMode);
  const creature = useCreature(c.creature);
  const disabledPack = useDisabledPackOf(c.creature);
  const [result, setResult] = useState<string | null>(null);
  const attacks = attackActions(creature);

  // Library data may carry dice formulas that don't parse.
  const attack = (action: CreatureAction) => {
    try {
      const rolled = rollAction(c, action, rollMode);
      if (rolled) setResult(`${action.name}: ${resultSummary(rolled)}`);
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <div className="col inspector-creature">
      <TextField
        label="Name"
        value={c.name}
        onChange={(v) => patchCombatant(c.id, `Rename ${c.name}`, (d) => void (d.name = v))}
      />
      {c.side === 'player' && (
        <OptionalNumberField
          label="Level"
          value={c.level ?? undefined}
          onChange={(v) =>
            patchCombatant(c.id, `Level of ${c.name}`, (d) => {
              d.level = v === undefined ? null : Math.min(20, Math.max(1, Math.round(v)));
            })
          }
        />
      )}
      <HitPointControls c={c} />
      {c.side === 'player' && c.hp.current <= 0 && <DeathSaves c={c} />}
      <Section title="Conditions">
        <ConditionPicker c={c} />
      </Section>
      {attacks.length > 0 && (
        <Section title="Attacks">
          <div className="col">
            {attacks.map((a) => (
              <Button
                key={a.name}
                icon="swords"
                label={attackLabel(a)}
                title="Roll to hit and damage"
                onClick={() => attack(a)}
              />
            ))}
            {result && (
              <span className="turn-result" title={result}>
                {result}
              </span>
            )}
          </div>
        </Section>
      )}
      {creature && <ResourcesSection c={c} creature={creature} />}
      <EffectsSection c={c} />
      <Section title="Token" collapsible defaultOpen={false}>
        <CheckboxField label="Hidden" value={c.hiddenFromPlayers} onChange={(v) => setHidden(c.id, v)} />
        <CheckboxField
          label="Vision source"
          value={c.visionSource}
          onChange={(v) => patchCombatant(c.id, `Vision of ${c.name}`, (d) => void (d.visionSource = v))}
        />
        <CarriedLightField c={c} />
        {hasMap && <MapPlacement c={c} />}
      </Section>
      <Section title="Notes" collapsible defaultOpen={c.notes !== ''}>
        <TextField
          label="Notes"
          multiline
          value={c.notes}
          onChange={(v) => patchCombatant(c.id, `Notes of ${c.name}`, (d) => void (d.notes = v))}
        />
      </Section>
      <Section title="Combat stats" collapsible defaultOpen={false}>
        <CombatStats c={c} />
      </Section>
      {creature && (
        <Section title="Stat block" collapsible defaultOpen={false}>
          <StatBlock creature={creature} onAttack={attack} />
        </Section>
      )}
      {disabledPack && (
        <div className="hint-bar" role="note">
          No stat block: this creature is in the disabled pack &quot;{disabledPack}&quot;. Enable it under Settings &gt;
          Content.
          <Button
            label="Open Settings > Content"
            variant="ghost"
            onClick={() => useAppStore.getState().navigate({ page: 'settings', section: 'content' })}
          />
        </div>
      )}
      <Button
        icon="trash"
        label="Remove from encounter"
        variant="danger"
        onClick={() => void confirmRemoveFromEncounter(c.id).catch(reportError)}
      />
    </div>
  );
}

/**
 * Creature tab: hit points, conditions, attacks, token and stat block of the selected combatant; with
 * nothing selected, the encounter overview.
 */
export function CombatantPanel({ encounter }: { encounter: Encounter }) {
  const selectedId = useEncounterStore((s) => s.selectedCombatantId);
  const combatant = encounter.combatants.find((c) => c.id === selectedId);
  const hasMap = useEncounterStore((s) => s.map !== null);
  return combatant ? (
    <CombatantDetails key={combatant.id} c={combatant} hasMap={hasMap} />
  ) : (
    <EncounterOverview encounter={encounter} />
  );
}
