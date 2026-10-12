import type { ReactNode } from 'react';
import {
  ABILITIES,
  SPEEDS,
  type AttackKind,
  type AttackRoll,
  type Creature,
  type CreatureAction,
  type Trait,
} from '@/core/model';
import { abilityModifier, formatCr, formatModifier, proficiencyBonusForCr } from '@/core/rules/abilities';
import { averageDice } from '@/core/rules/dice';

const ATTACK_LABEL: Record<AttackKind, string> = {
  'melee-weapon': 'Melee Weapon Attack',
  'ranged-weapon': 'Ranged Weapon Attack',
  'melee-spell': 'Melee Spell Attack',
  'ranged-spell': 'Ranged Spell Attack',
  'melee-or-ranged': 'Melee or Ranged Weapon Attack',
};

/** 'animal-handling' → 'Animal Handling'. */
export function titleCase(text: string): string {
  return text.replace(/(^|[-\s])(\w)/g, (_, gap: string, c: string) => `${gap === '-' ? ' ' : gap}${c.toUpperCase()}`);
}

function listLine(label: string, items: string[]): ReactNode {
  return (
    items.length > 0 && (
      <div>
        <strong>{label}</strong> {items.join(', ')}
      </div>
    )
  );
}

/** Stat block wording, e.g. "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 5 (1d6 + 2) slashing". */
export function attackSummary(attack: AttackRoll): string {
  const reach = attack.reachFt !== null ? `reach ${attack.reachFt} ft.` : null;
  const range = attack.rangeFt ? `range ${attack.rangeFt.normal}/${attack.rangeFt.long} ft.` : null;
  const distance = [reach, range].filter((d) => d !== null).join(' or ');
  const hits = attack.damage.map((d) => `${averageDice(d.formula)} (${d.formula}) ${d.type} damage`).join(' plus ');
  const target = attack.targets ? ` ${attack.targets}.` : '';
  return `${ATTACK_LABEL[attack.kind]}: ${formatModifier(attack.toHit)} to hit, ${distance},${target} Hit: ${hits}.`;
}

interface EntryProps {
  entry: Trait | CreatureAction;
  suffix?: string;
  onAttack?: (action: CreatureAction) => void;
}

function Entry({ entry, suffix, onAttack }: EntryProps) {
  const action = 'attack' in entry ? entry : null;
  const text = entry.description || (action?.attack ? attackSummary(action.attack) : '');
  return (
    <p>
      {action?.attack && onAttack && (
        <button className="roll-button" title={`Roll ${entry.name}`} onClick={() => onAttack(action)}>
          🎲
        </button>
      )}
      <em>
        <strong>
          {entry.name}
          {suffix}.
        </strong>
      </em>{' '}
      {text}
    </p>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h4>{title}</h4>
      {children}
    </>
  );
}

/** 5e-styled stat block; `onAttack` adds roll buttons to actions with attack data. */
export function StatBlock({ creature, onAttack }: { creature: Creature; onAttack?: (action: CreatureAction) => void }) {
  const c = creature;
  const speeds = SPEEDS.filter((s) => c.speeds[s] !== undefined).map(
    (s) => `${s === 'walk' ? '' : `${s} `}${c.speeds[s]} ft.${s === 'fly' && c.hover ? ' (hover)' : ''}`,
  );
  const saves = ABILITIES.filter((a) => c.savingThrows[a] !== undefined).map(
    (a) => `${titleCase(a)} ${formatModifier(c.savingThrows[a]!)}`,
  );
  const skills = Object.entries(c.skills).map(([skill, bonus]) => `${titleCase(skill)} ${formatModifier(bonus)}`);
  const senses = [
    ...Object.entries(c.senses).map(([sense, ft]) => `${sense} ${ft} ft.`),
    `passive Perception ${c.passivePerception}`,
  ];
  const subtype = c.subtype ? ` (${c.subtype})` : '';
  return (
    <div className="statblock">
      <div className="name">{c.name}</div>
      <div>
        <em>
          {titleCase(c.size)} {c.type}
          {subtype}, {c.alignmentText}
        </em>
      </div>
      <hr />
      <div>
        <strong>Armor Class</strong> {c.armorClass}
        {c.armorNote && ` (${c.armorNote})`}
      </div>
      <div>
        <strong>Hit Points</strong> {c.hitPoints.average}
        {c.hitPoints.formula && ` (${c.hitPoints.formula})`}
      </div>
      {listLine('Speed', speeds)}
      <hr />
      <div className="abilities">
        {ABILITIES.map((a) => (
          <div key={a}>
            <strong>{a.toUpperCase()}</strong>
            <div>
              {c.abilities[a]} ({formatModifier(abilityModifier(c.abilities[a]))})
            </div>
          </div>
        ))}
      </div>
      <hr />
      {listLine('Saving Throws', saves)}
      {listLine('Skills', skills)}
      {listLine('Damage Vulnerabilities', c.damageVulnerabilities)}
      {listLine('Damage Resistances', c.damageResistances)}
      {listLine('Damage Immunities', c.damageImmunities)}
      {listLine('Condition Immunities', c.conditionImmunities)}
      {listLine('Senses', senses)}
      {listLine('Languages', c.languages.length > 0 ? c.languages : ['—'])}
      <div>
        <strong>Challenge</strong> {formatCr(c.challenge)} ({c.xp.toLocaleString('en-US')} XP){' '}
        <strong>Proficiency Bonus</strong> {formatModifier(proficiencyBonusForCr(c.challenge))}
      </div>
      <hr />
      {c.traits.map((t, i) => (
        <Entry key={i} entry={t} />
      ))}
      {c.actions.length > 0 && (
        <Section title="Actions">
          {c.actions.map((a, i) => (
            <Entry key={i} entry={a} onAttack={onAttack} />
          ))}
        </Section>
      )}
      {c.bonusActions.length > 0 && (
        <Section title="Bonus Actions">
          {c.bonusActions.map((a, i) => (
            <Entry key={i} entry={a} onAttack={onAttack} />
          ))}
        </Section>
      )}
      {c.reactions.length > 0 && (
        <Section title="Reactions">
          {c.reactions.map((r, i) => (
            <Entry key={i} entry={r} />
          ))}
        </Section>
      )}
      {(c.legendaryActions.length > 0 || c.legendaryDescription) && (
        <Section title="Legendary Actions">
          {c.legendaryDescription && <p>{c.legendaryDescription}</p>}
          {c.legendaryActions.map((l, i) => (
            <Entry key={i} entry={l} suffix={l.cost > 1 ? ` (Costs ${l.cost} Actions)` : ''} />
          ))}
        </Section>
      )}
      {c.source && <div className="muted source">Source: {c.source}</div>}
    </div>
  );
}
