import { useState } from 'react';
import { ABILITIES, DAMAGE_TYPES, type AreaMarker, type Encounter } from '@/core/model';
import { countOf } from '@/core/plural';
import { formatModifier } from '@/core/rules/abilities';
import { combatantsInArea, damageResponse, saveBonus, type DamageResponse } from '@/core/rules/areaEffects';
import { rollDice } from '@/core/rules/dice';
import { useAppStore } from '@/state/appStore';
import { applyAreaDamage, rollAreaSaves } from '@/state/combatRules';
import { addLog, describeRoll } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { useLibraryStore } from '@/state/libraryStore';
import { CheckboxField, NumberField, SelectField, TextField } from '../components/fields';
import { Button, Section } from '../kit';
import { queueConcentrationChecks } from './encounterUiStore';

const RESPONSE_LABEL: Record<DamageResponse, string> = {
  normal: '',
  resistant: 'resists',
  immune: 'immune',
  vulnerable: 'vulnerable',
};

/**
 * Creatures inside a placed area, whatever anyone sees: save rolls with their own bonuses, then one damage
 * roll applied with half on a save and their resistances, as one undo step.
 */
export function AreaTargets({ marker, encounter }: { marker: AreaMarker; encounter: Encounter }) {
  const map = useEncounterStore((s) => s.map);
  const update = useEncounterStore((s) => s.update);
  const entries = useLibraryStore((s) => s.listings.creature.entries);
  const reportError = useAppStore((s) => s.reportError);
  const notify = useAppStore((s) => s.notify);
  const [ability, setAbility] = useState(marker.save?.ability ?? 'dex');
  const [dc, setDc] = useState(marker.save?.dc ?? 13);
  const [damage, setDamage] = useState(marker.save?.damage ?? '');
  const [damageType, setDamageType] = useState(marker.save?.damageType ?? 'fire');
  const [half, setHalf] = useState(marker.save?.halfOnSuccess ?? true);
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [left, setLeft] = useState<Record<string, true>>({});
  const inside = map ? combatantsInArea(marker, map.grid, encounter.combatants) : [];
  const rows = inside.map((c) => {
    const creature = entries.find((e) => e.ref.id === c.creature?.id)?.doc ?? null;
    return { c, bonus: saveBonus(creature, ability), response: damageResponse(creature, damageType) };
  });
  const targets = rows.filter((r) => !left[r.c.id]);
  const label = marker.label;

  const rollSaves = () => {
    let result: Record<string, boolean> = {};
    update((d) => {
      result = rollAreaSaves(
        d,
        label,
        { ability, dc },
        targets.map((t) => ({ id: t.c.id, bonus: t.bonus })),
      );
    });
    setSaved(result);
  };

  // The formula is typed at the table and may not parse.
  const applyDamage = () => {
    try {
      const roll = rollDice(damage);
      let owed: Record<string, number> = {};
      update((d) => {
        addLog(d, 'roll', `${label} damage: ${describeRoll(roll)} ${damageType}`);
        const hits = targets.map((t) => ({ id: t.c.id, saved: saved[t.c.id] ?? false, response: t.response }));
        owed = applyAreaDamage(d, label, roll.total, damageType, half, hits);
      }, `${label} damage`);
      queueConcentrationChecks(owed);
      notify(`${label}: ${roll.total} ${damageType} damage to ${countOf(targets.length, 'target')}`);
    } catch (error) {
      reportError(error);
    }
  };

  return (
    <Section title={`Targets in ${label} (${targets.length})`}>
      <div className="area-save-fields">
        <SelectField
          label="Save"
          value={ability}
          options={ABILITIES}
          format={(a) => a.toUpperCase()}
          onChange={setAbility}
        />
        <NumberField label="DC" min={1} max={40} value={dc} onChange={(v) => setDc(Math.round(v))} />
        <TextField label="Damage" placeholder="8d6" value={damage} onChange={setDamage} />
        <SelectField label="Type" value={damageType} options={DAMAGE_TYPES} onChange={setDamageType} />
      </div>
      <CheckboxField label="Half damage on a successful save" value={half} onChange={setHalf} />
      {rows.length > 0 ? (
        <ul className="area-targets">
          {rows.map(({ c, bonus, response }) => {
            const out = left[c.id] === true;
            const result = saved[c.id];
            return (
              <li key={c.id} className={out ? 'row muted' : 'row'}>
                <input
                  type="checkbox"
                  aria-label={`Include ${c.name}`}
                  checked={!out}
                  onChange={() => {
                    const { [c.id]: _dropped, ...rest } = left;
                    setLeft(out ? rest : { ...left, [c.id]: true });
                  }}
                />
                <span className="grow">
                  {c.name}{' '}
                  <span className="muted small">
                    {formatModifier(bonus)}
                    {response !== 'normal' && ` · ${RESPONSE_LABEL[response]}`}
                  </span>
                </span>
                <Button
                  label={result === undefined ? 'Not rolled' : result ? 'Saved' : 'Failed'}
                  title="Click to switch between saved and failed"
                  variant={result ? 'default' : 'ghost'}
                  active={result === true}
                  disabled={out}
                  onClick={() => setSaved({ ...saved, [c.id]: !result })}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted small">No token stands in this area.</p>
      )}
      <div className="row">
        <Button icon="dice" label="Roll saves" disabled={targets.length === 0} onClick={rollSaves} />
        <Button
          icon="swords"
          label="Apply damage"
          disabled={targets.length === 0 || damage.trim() === ''}
          onClick={applyDamage}
        />
      </div>
    </Section>
  );
}
