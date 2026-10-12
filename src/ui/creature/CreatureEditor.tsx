import type { Draft } from 'immer';
import { useId, useRef, useState } from 'react';
import {
  ABILITIES,
  ALIGNMENTS,
  CONDITIONS,
  CREATURE_TYPES,
  SENSES,
  SIZES,
  SKILL_ABILITY,
  SKILLS,
  SPEEDS,
  creatureKindSchema,
  type AssetRef,
  type Creature,
} from '@/core/model';
import { abilityModifier, formatCr, formatModifier, proficiencyBonusForCr, xpForCr } from '@/core/rules/abilities';
import { averageDice } from '@/core/rules/dice';
import { useAppStore } from '@/state/appStore';
import { AssetImage } from '../components/AssetImage';
import { CheckboxField, Field, NumberField, SelectField, TextField } from '../components/fields';
import { Section } from '../kit';
import { PictureLibraryDialog } from '../library/PictureLibraryDialog';
import { ListField, OptionalNumberField } from './creatureFields';
import { ActionListEditor, LegendaryListEditor, TraitListEditor } from './EntryEditors';
import { titleCase } from './StatBlock';

const CR_VALUES = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)].map(String);

/** Writes or clears one entry of a partial record (speeds, senses, saves, skills, alignment weights). */
function setEntry<K extends string>(record: Partial<Record<K, number>>, key: K, value: number | undefined): void {
  if (value === undefined) {
    delete record[key];
  } else {
    record[key] = value;
  }
}

function ImageField(props: {
  label: string;
  kind: 'image' | 'token';
  creature: Creature;
  onChange: (a: AssetRef | null) => void;
}) {
  const { label, kind, creature, onChange } = props;
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const input = useRef<HTMLInputElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const asset = creature[kind];
  return (
    <Field label={label}>
      <div className="row">
        <AssetImage asset={asset} alt={label} className="creature-thumb" />
        <button onClick={() => input.current?.click()}>Import…</button>
        <button onClick={() => setLibraryOpen(true)}>Library…</button>
        <button disabled={!asset} onClick={() => onChange(null)}>
          Clear
        </button>
        {libraryOpen && <PictureLibraryDialog onPick={onChange} onClose={() => setLibraryOpen(false)} />}
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // The file's name makes it the creature's picture, so it applies
            // at once, before the stat block is saved.
            if (file) {
              file
                .arrayBuffer()
                .then((bytes) => repository.importCreaturePicture(creature.id, kind, file.name, new Uint8Array(bytes)))
                .then(onChange, reportError);
            }
            e.target.value = '';
          }}
        />
      </div>
    </Field>
  );
}

export type Change = (recipe: (draft: Draft<Creature>) => void) => void;

function BasicsSection({ c, change }: { c: Creature; change: Change }) {
  return (
    <Section title="Basics" collapsible>
      <TextField label="Name" value={c.name} onChange={(v) => change((d) => void (d.name = v))} />
      <SelectField
        label="Kind"
        value={c.kind}
        options={creatureKindSchema.options}
        onChange={(v) => change((d) => void (d.kind = v))}
      />
      {c.kind === 'player' && (
        <OptionalNumberField
          label="Level"
          value={c.level ?? undefined}
          onChange={(v) =>
            change((d) => void (d.level = v === undefined ? null : Math.min(20, Math.max(1, Math.round(v)))))
          }
        />
      )}
      <SelectField label="Size" value={c.size} options={SIZES} onChange={(v) => change((d) => void (d.size = v))} />
      <SelectField
        label="Type"
        value={c.type}
        options={CREATURE_TYPES}
        onChange={(v) => change((d) => void (d.type = v))}
      />
      <TextField label="Subtype" value={c.subtype} onChange={(v) => change((d) => void (d.subtype = v))} />
      <TextField
        label="Alignment"
        value={c.alignmentText}
        onChange={(v) => change((d) => void (d.alignmentText = v))}
      />
      <details>
        <summary className="muted">Alignment weights (used when spawning)</summary>
        {ALIGNMENTS.map((a) => (
          <OptionalNumberField
            key={a}
            label={titleCase(a)}
            value={c.alignmentWeights[a]}
            onChange={(v) => change((d) => setEntry(d.alignmentWeights, a, v === undefined ? v : Math.max(0, v)))}
          />
        ))}
      </details>
      <ListField label="Tags" value={c.tags} onChange={(v) => change((d) => void (d.tags = v))} />
      <TextField label="Source" value={c.source} onChange={(v) => change((d) => void (d.source = v))} />
      <TextField label="License" value={c.license} onChange={(v) => change((d) => void (d.license = v))} />
      <ImageField label="Image" kind="image" creature={c} onChange={(v) => change((d) => void (d.image = v))} />
      <ImageField label="Token" kind="token" creature={c} onChange={(v) => change((d) => void (d.token = v))} />
    </Section>
  );
}

function DefenseSection({ c, change }: { c: Creature; change: Change }) {
  const reportError = useAppStore((s) => s.reportError);
  const formulaId = useId();
  const averageFromFormula = () => {
    try {
      const average = averageDice(c.hitPoints.formula);
      change((d) => void (d.hitPoints.average = Math.max(0, average)));
    } catch (error) {
      reportError(error);
    }
  };
  return (
    <Section title="Defense and movement" collapsible>
      <NumberField label="Armor class" value={c.armorClass} onChange={(v) => change((d) => void (d.armorClass = v))} />
      <TextField label="Armor note" value={c.armorNote} onChange={(v) => change((d) => void (d.armorNote = v))} />
      <NumberField
        label="Hit points"
        min={0}
        value={c.hitPoints.average}
        onChange={(v) => change((d) => void (d.hitPoints.average = Math.round(v)))}
      />
      <Field label="HP formula" htmlFor={formulaId}>
        <div className="row">
          <input
            id={formulaId}
            key={c.hitPoints.formula}
            defaultValue={c.hitPoints.formula}
            style={{ flex: 1 }}
            onBlur={(e) => {
              const formula = e.target.value.trim();
              change((d) => void (d.hitPoints.formula = formula));
            }}
          />
          <button title="Set hit points to the formula average" onClick={averageFromFormula}>
            Avg
          </button>
        </div>
      </Field>
      {SPEEDS.map((s) => (
        <OptionalNumberField
          key={s}
          label={`Speed ${s}`}
          suffix="ft"
          value={c.speeds[s]}
          onChange={(v) => change((d) => setEntry(d.speeds, s, v === undefined ? v : Math.max(0, v)))}
        />
      ))}
      <CheckboxField label="Hover" value={c.hover} onChange={(v) => change((d) => void (d.hover = v))} />
      <ListField
        label="Vulnerabilities"
        value={c.damageVulnerabilities}
        onChange={(v) => change((d) => void (d.damageVulnerabilities = v))}
      />
      <ListField
        label="Resistances"
        value={c.damageResistances}
        onChange={(v) => change((d) => void (d.damageResistances = v))}
      />
      <ListField
        label="Immunities"
        value={c.damageImmunities}
        onChange={(v) => change((d) => void (d.damageImmunities = v))}
      />
      <Field label="Condition imm.">
        <div className="chips">
          {CONDITIONS.map((cond) => (
            <button
              key={cond}
              className={c.conditionImmunities.includes(cond) ? 'chip active' : 'chip'}
              onClick={() =>
                change((d) => {
                  d.conditionImmunities = c.conditionImmunities.includes(cond)
                    ? c.conditionImmunities.filter((x) => x !== cond)
                    : [...c.conditionImmunities, cond];
                })
              }
            >
              {cond}
            </button>
          ))}
        </div>
      </Field>
    </Section>
  );
}

function AbilitiesSection({ c, change }: { c: Creature; change: Change }) {
  const pb = proficiencyBonusForCr(c.challenge);
  return (
    <Section title="Abilities, saves and skills" collapsible>
      {ABILITIES.map((a) => (
        <NumberField
          key={a}
          label={a.toUpperCase()}
          min={1}
          max={30}
          value={c.abilities[a]}
          suffix={formatModifier(abilityModifier(c.abilities[a]))}
          onChange={(v) => change((d) => void (d.abilities[a] = Math.round(v)))}
        />
      ))}
      <h3>Saving throws (total bonus, empty = not proficient)</h3>
      {ABILITIES.map((a) => (
        <OptionalNumberField
          key={a}
          label={`${a.toUpperCase()} save`}
          placeholder={`proficient ${formatModifier(abilityModifier(c.abilities[a]) + pb)}`}
          value={c.savingThrows[a]}
          onChange={(v) => change((d) => setEntry(d.savingThrows, a, v))}
        />
      ))}
      <h3>Skills (total bonus)</h3>
      {SKILLS.map((s) => (
        <OptionalNumberField
          key={s}
          label={titleCase(s)}
          placeholder={`proficient ${formatModifier(abilityModifier(c.abilities[SKILL_ABILITY[s]]) + pb)}`}
          value={c.skills[s]}
          onChange={(v) => change((d) => setEntry(d.skills, s, v))}
        />
      ))}
    </Section>
  );
}

function SensesSection({ c, change }: { c: Creature; change: Change }) {
  return (
    <Section title="Senses, languages and challenge" collapsible>
      {SENSES.map((s) => (
        <OptionalNumberField
          key={s}
          label={titleCase(s)}
          suffix="ft"
          value={c.senses[s]}
          onChange={(v) => change((d) => setEntry(d.senses, s, v === undefined ? v : Math.max(0, v)))}
        />
      ))}
      <NumberField
        label="Passive Perc."
        value={c.passivePerception}
        onChange={(v) => change((d) => void (d.passivePerception = Math.round(v)))}
      />
      <ListField label="Languages" value={c.languages} onChange={(v) => change((d) => void (d.languages = v))} />
      <SelectField
        label="Challenge"
        value={String(c.challenge)}
        options={CR_VALUES}
        format={(v) => formatCr(Number(v))}
        onChange={(v) =>
          change((d) => {
            d.challenge = Number(v);
            d.xp = xpForCr(Number(v));
          })
        }
      />
      <NumberField label="XP" min={0} value={c.xp} onChange={(v) => change((d) => void (d.xp = Math.round(v)))} />
    </Section>
  );
}

function ActionsSection({ c, change }: { c: Creature; change: Change }) {
  return (
    <Section title="Traits and actions" collapsible>
      <TraitListEditor title="Traits" items={c.traits} onChange={(v) => change((d) => void (d.traits = v))} />
      <ActionListEditor title="Actions" items={c.actions} onChange={(v) => change((d) => void (d.actions = v))} />
      <ActionListEditor
        title="Bonus actions"
        items={c.bonusActions}
        onChange={(v) => change((d) => void (d.bonusActions = v))}
      />
      <TraitListEditor title="Reactions" items={c.reactions} onChange={(v) => change((d) => void (d.reactions = v))} />
      <TextField
        label="Legendary intro"
        multiline
        value={c.legendaryDescription}
        onChange={(v) => change((d) => void (d.legendaryDescription = v))}
      />
      <LegendaryListEditor items={c.legendaryActions} onChange={(v) => change((d) => void (d.legendaryActions = v))} />
      <TextField label="DM notes" multiline value={c.notes} onChange={(v) => change((d) => void (d.notes = v))} />
    </Section>
  );
}

/** All creature fields grouped into collapsible sections. */
export function CreatureForm({ c, change }: { c: Creature; change: Change }) {
  return (
    <div className="col creature-form">
      <BasicsSection c={c} change={change} />
      <DefenseSection c={c} change={change} />
      <AbilitiesSection c={c} change={change} />
      <SensesSection c={c} change={change} />
      <ActionsSection c={c} change={change} />
    </div>
  );
}
