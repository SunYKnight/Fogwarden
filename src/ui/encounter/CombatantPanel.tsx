import { useState } from 'react';
import { CONDITIONS, SENSES, SIZES, sideSchema, type Combatant, type CreatureAction } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { CheckboxField, NumberField, SelectField, TextField } from '../components/fields';
import { OptionalNumberField } from '../creature/creatureFields';
import { StatBlock, titleCase } from '../creature/StatBlock';
import { Button, EmptyState, Section } from '../kit';
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

function ConditionChips({ c }: { c: Combatant }) {
  return (
    <div className="chips">
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

  const attack = (action: CreatureAction) => {
    try {
      rollAction(c, action, rollMode);
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
        <ConditionChips c={c} />
      </Section>
      <EffectsSection c={c} />
      {creature && <ResourcesSection c={c} creature={creature} />}
      <Section title="Players and map">
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
        <Section title="Stat block" collapsible>
          <StatBlock creature={creature} onAttack={attack} />
        </Section>
      )}
      {disabledPack && (
        <p className="hint-bar" role="note">
          No stat block: this creature is in the disabled pack &quot;{disabledPack}&quot;. Enable it under Compendium
          &gt; Packs.
        </p>
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

/** Creature tab: hit points, conditions, visibility, notes and stat block of the selected combatant. */
export function CombatantPanel() {
  const combatant = useEncounterStore((s) => s.encounter?.combatants.find((c) => c.id === s.selectedCombatantId));
  const hasMap = useEncounterStore((s) => s.map !== null);
  return combatant ? (
    <CombatantDetails key={combatant.id} c={combatant} hasMap={hasMap} />
  ) : (
    <EmptyState icon="cursor" title="No combatant selected">
      Click a token on the map or a name in the initiative list.
    </EmptyState>
  );
}
