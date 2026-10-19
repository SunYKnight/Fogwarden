import {
  ABILITIES,
  CHARACTER_SHEET_SCHEMA_VERSION,
  SKILL_ABILITY,
  SKILLS,
  type CharacterSheet,
  type Creature,
  type ProficiencyLevel,
} from '../model';
import type { Spell } from '../spells';
import { abilityModifier } from './abilities';

/** What the Spells tab shows of a library spell besides the sheet's name, level and status. */
export type SheetSpellInfo = Pick<
  Spell,
  'school' | 'castingTime' | 'range' | 'components' | 'duration' | 'ritual' | 'description'
>;

/** Proficiency bonus of a character level (+2 at 1, +6 at 17). */
export function proficiencyForLevel(level: number): number {
  return 2 + Math.floor((Math.max(1, level) - 1) / 4);
}

/**
 * The sheet of a character without a sheet file (entered by hand or from a stat block): scores, saves and skills
 * from the stat block, its traits as features. A listed skill whose bonus holds the proficiency bonus twice
 * counts as expertise.
 */
export function sheetFromCreature(creature: Creature): CharacterSheet {
  const proficiencyBonus = proficiencyForLevel(creature.level ?? 1);
  return {
    schema: 'character-sheet',
    version: CHARACTER_SHEET_SCHEMA_VERSION,
    race: creature.subtype,
    classes: '',
    background: '',
    proficiencyBonus,
    abilities: { ...creature.abilities },
    savingThrows: Object.fromEntries(
      ABILITIES.map((a) => {
        const bonus = creature.savingThrows[a];
        return [a, { proficient: bonus !== undefined, bonus: bonus ?? abilityModifier(creature.abilities[a]) }];
      }),
    ) as CharacterSheet['savingThrows'],
    skills: Object.fromEntries(
      SKILLS.map((s) => {
        const base = abilityModifier(creature.abilities[SKILL_ABILITY[s]]);
        const bonus = creature.skills[s];
        const proficiency: ProficiencyLevel =
          bonus === undefined ? 'none' : bonus - base >= 2 * proficiencyBonus ? 'expertise' : 'proficient';
        return [s, { proficiency, bonus: bonus ?? base }];
      }),
    ) as CharacterSheet['skills'],
    features: creature.traits.map((t) => ({ name: t.name, source: '', text: t.description })),
    spellcasting: [],
    spells: [],
    inventory: [],
    currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    personality: { traits: '', ideals: '', bonds: '', flaws: '' },
    appearance: { age: '', height: '', weight: '', eyes: '', skin: '', hair: '' },
    backstory: '',
  };
}

/** Library details of the sheet's spells by library spell id; spells the library lacks are left out. */
export function sheetSpellInfo(
  sheet: CharacterSheet,
  spells: ReadonlyMap<string, Spell>,
): Record<string, SheetSpellInfo> {
  const info: Record<string, SheetSpellInfo> = {};
  for (const { spell: id } of sheet.spells) {
    const spell = id === null ? undefined : spells.get(id);
    if (id !== null && spell) {
      const { school, castingTime, range, components, duration, ritual, description } = spell;
      info[id] = { school, castingTime, range, components, duration, ritual, description };
    }
  }
  return info;
}
