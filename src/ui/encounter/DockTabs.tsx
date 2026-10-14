import { SENSES, SIZES, sideSchema, type Combatant, type Creature, type CreatureAction } from '@/core/model';
import type { RollMode } from '@/core/rules/dice';
import { useAppStore } from '@/state/appStore';
import { CheckboxField, NumberField, SelectField, TextField } from '../components/fields';
import { OptionalNumberField } from '../creature/creatureFields';
import { StatBlock, titleCase } from '../creature/StatBlock';
import { Button, Section } from '../kit';
import { attackActions, attackLabel } from './attacks';
import {
  confirmRemoveFromEncounter,
  patchCombatant,
  removeFromMap,
  setCurrentHp,
  setHidden,
} from './combatantCommands';
import { CarriedLightField, DeathSaves, EffectsSection, ResourcesSection } from './CombatantRules';
import { startPlacing, useEncounterUi } from './encounterUiStore';

const ROLL_MODE_LABEL: Record<RollMode, string> = {
  normal: 'Normal',
  advantage: 'Advantage',
  disadvantage: 'Disadvantage',
};
const ROLL_MODES = Object.keys(ROLL_MODE_LABEL) as RollMode[];

export type Attack = (action: CreatureAction) => void;

/** Fixed-height line: a roll never pushes the controls around it. */
export function AttackResultLine({ result }: { result: string | null }) {
  return (
    <output className={result ? 'attack-result' : 'attack-result muted'} title={result ?? undefined}>
      {result ?? 'No attack rolled this turn'}
    </output>
  );
}

export function ActionsTab(props: { c: Combatant; creature: Creature | null; result: string | null; attack: Attack }) {
  const { c, creature, result, attack } = props;
  const rollMode = useEncounterUi((s) => s.rollMode);
  const attacks = attackActions(creature);
  return (
    <div className="col">
      <div className="dock-attacks">
        {attacks.map((a) => (
          <Button
            key={a.name}
            icon="swords"
            label={attackLabel(a)}
            title="Roll to hit and damage"
            onClick={() => attack(a)}
          />
        ))}
        {attacks.length > 0 ? (
          <select
            aria-label="Roll mode"
            value={rollMode}
            onChange={(e) =>
              useEncounterUi.setState({ rollMode: ROLL_MODES.find((m) => m === e.target.value) ?? 'normal' })
            }
          >
            {ROLL_MODES.map((m) => (
              <option key={m} value={m}>
                {ROLL_MODE_LABEL[m]}
              </option>
            ))}
          </select>
        ) : (
          <span className="muted small">No attack rolls; Stats shows everything {c.name} can do.</span>
        )}
      </div>
      <AttackResultLine result={result} />
      {creature && <ResourcesSection c={c} creature={creature} />}
    </div>
  );
}

export function EffectsTab({ c }: { c: Combatant }) {
  return (
    <div className="col">
      {c.side === 'player' && c.hp.current <= 0 && <DeathSaves c={c} />}
      <EffectsSection c={c} />
    </div>
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

export function TokenTab({ c, hasMap }: { c: Combatant; hasMap: boolean }) {
  const reportError = useAppStore((s) => s.reportError);
  return (
    <div className="col">
      <CheckboxField label="Hidden" value={c.hiddenFromPlayers} onChange={(v) => setHidden(c.id, v)} />
      <CheckboxField
        label="Vision source"
        value={c.visionSource}
        onChange={(v) => patchCombatant(c.id, `Vision of ${c.name}`, (d) => void (d.visionSource = v))}
      />
      <CarriedLightField c={c} />
      {hasMap && <MapPlacement c={c} />}
      <Button
        icon="trash"
        label="Remove from encounter"
        variant="danger"
        onClick={() => void confirmRemoveFromEncounter(c.id).catch(reportError)}
      />
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

interface StatsProps {
  c: Combatant;
  creature: Creature | null;
  /** Pack name when the stat block is missing because its pack is disabled. */
  disabledPack: string | null;
  result: string | null;
  attack: Attack;
}

export function StatsTab({ c, creature, disabledPack, result, attack }: StatsProps) {
  return (
    <div className="col">
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
      <Section title="Combat stats" collapsible defaultOpen={creature === null}>
        <CombatStats c={c} />
      </Section>
      {creature && (
        <Section title="Stat block">
          <AttackResultLine result={result} />
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
    </div>
  );
}

export function NotesTab({ c }: { c: Combatant }) {
  return (
    <TextField
      label="Notes"
      multiline
      value={c.notes}
      onChange={(v) => patchCombatant(c.id, `Notes of ${c.name}`, (d) => void (d.notes = v))}
    />
  );
}
