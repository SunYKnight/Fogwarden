import type { Draft } from 'immer';
import type { Combatant, Condition, CreatureAction, Encounter, LogEntry } from '@/core/model';
import type { RollMode } from '@/core/rules/dice';
import { useAppStore } from '@/state/appStore';
import { advanceTurn, settleHpChange } from '@/state/combatRules';
import {
  addLog,
  applyDamage,
  applyHealing,
  currentCombatant,
  describeRoll,
  grantTempHp,
  previousTurn,
  removeCombatant,
  rollAttack,
  rollInitiative,
  sortByInitiative,
  type AttackResult,
  type HitPoints,
} from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { confirmDialog } from '../kit';
import { COMBAT_ENDED_TEXT } from '../library/encounterStatus';
import { dexScore, findCreature } from './creatureLookup';
import { queueConcentrationChecks, type HpChange } from './encounterUiStore';

/**
 * Play commands shared by the initiative strip, turn bar, inspector, token context menu and shortcuts.
 * Each is one labelled undo step.
 */

type CombatantRecipe = (combatant: Draft<Combatant>, encounter: Draft<Encounter>) => void;

function nameOf(id: string): string {
  return useEncounterStore.getState().encounter?.combatants.find((c) => c.id === id)?.name ?? 'combatant';
}

/** Changes one combatant as one undo step named `label`. */
export function patchCombatant(id: string, label: string, recipe: CombatantRecipe): void {
  useEncounterStore.getState().update((d) => {
    const target = d.combatants.find((c) => c.id === id);
    if (target) recipe(target, d);
  }, label);
}

const HP_CHANGES: Record<HpChange, { apply: (hp: HitPoints, n: number) => HitPoints; log: LogEntry['kind'] }> = {
  damage: { apply: applyDamage, log: 'damage' },
  heal: { apply: applyHealing, log: 'heal' },
  temp: { apply: grantTempHp, log: 'note' },
};

export const HP_CHANGE_LABEL: Record<HpChange, string> = { damage: 'Damage', heal: 'Heal', temp: 'Temp HP' };

function hpLogText(change: HpChange, name: string, amount: number, before: number, after: number): string {
  const verb = change === 'damage' ? `takes ${amount} damage` : `heals ${amount}`;
  return change === 'temp' ? `${name} gains ${amount} temporary HP` : `${name} ${verb}: ${before} → ${after} HP`;
}

/** Damage also settles death saves and concentration and asks for the concentration save it calls for. */
export function changeHp(id: string, change: HpChange, amount: number): void {
  const owed: Record<string, number> = {};
  patchCombatant(id, `${HP_CHANGE_LABEL[change]} ${nameOf(id)}`, (c, encounter) => {
    const before = c.hp.current;
    c.hp = HP_CHANGES[change].apply(c.hp, amount);
    addLog(encounter, HP_CHANGES[change].log, hpLogText(change, c.name, amount, before, c.hp.current));
    const dc = settleHpChange(encounter, c, before, change === 'damage' ? amount : 0);
    if (dc !== null) owed[c.id] = dc;
  });
  queueConcentrationChecks(owed);
}

/** Hit points typed in directly; no damage was taken, so no saves follow. */
export function setCurrentHp(id: string, value: number): void {
  patchCombatant(id, `HP of ${nameOf(id)}`, (c, encounter) => {
    const before = c.hp.current;
    c.hp.current = value;
    settleHpChange(encounter, c, before, 0);
  });
}

export function toggleCondition(id: string, condition: Condition): void {
  patchCombatant(id, `Toggle ${condition} on ${nameOf(id)}`, (c, encounter) => {
    const on = c.conditions.includes(condition);
    c.conditions = on ? c.conditions.filter((x) => x !== condition) : [...c.conditions, condition];
    // A timed effect imposing the condition ends when the DM lifts it by hand.
    if (on) c.effects = c.effects.filter((e) => e.condition !== condition);
    addLog(encounter, 'note', `${c.name} ${on ? 'is no longer' : 'is'} ${condition}`);
  });
}

export function setHidden(id: string, hidden: boolean): void {
  patchCombatant(id, `${hidden ? 'Hide' : 'Show'} ${nameOf(id)}`, (c) => void (c.hiddenFromPlayers = hidden));
}

export function removeFromMap(id: string): void {
  patchCombatant(id, `Remove ${nameOf(id)} from map`, (c) => void (c.position = null));
}

/** Asks first: the combatant's HP, conditions and notes go with it. */
export async function confirmRemoveFromEncounter(id: string): Promise<void> {
  const name = nameOf(id);
  const ok = await confirmDialog({
    title: 'Remove combatant',
    message: `${name} leaves the encounter with its HP, conditions and notes. Ctrl+Z brings it back.`,
    confirmLabel: 'Remove',
    danger: true,
  });
  if (ok) useEncounterStore.getState().update((d) => removeCombatant(d, id), `Remove ${name}`);
}

/** Rolls initiative for `ids` (all combatants for null) and sorts the order. */
export function rollInitiativeFor(ids: string[] | null): void {
  useEncounterStore.getState().update((d) => {
    d.combatants
      .filter((c) => ids === null || ids.includes(c.id))
      .forEach((c) => {
        const roll = rollInitiative(dexScore(c));
        c.initiative = roll.total;
        addLog(d, 'roll', `${c.name} initiative ${describeRoll(roll)}`);
      });
    sortByInitiative(d, dexScore);
  }, 'Roll initiative');
}

export function sortInitiative(): void {
  useEncounterStore.getState().update((d) => sortByInitiative(d, dexScore), 'Sort initiative');
}

/**
 * Turn changes select the combatant whose turn it is, so its stat block and actions show up. Next turn runs
 * the turn upkeep (effects, legendary actions, recharges) and announces lair actions.
 */
export function stepTurn(direction: 'next' | 'previous'): void {
  let lair: string[] = [];
  useEncounterStore.getState().update(
    (d) => {
      if (direction === 'next') {
        lair = advanceTurn(d, (c) => findCreature(c.creature));
      } else {
        previousTurn(d);
        const current = currentCombatant(d);
        if (current) addLog(d, 'turn', `Round ${d.round}: ${current.name}`);
      }
    },
    direction === 'next' ? 'Next turn' : 'Previous turn',
  );
  if (lair.length > 0) useAppStore.getState().notify(`Lair action (initiative 20): ${lair.join(', ')}`, 'info');
  const { encounter, select } = useEncounterStore.getState();
  const current = encounter && currentCombatant(encounter);
  if (current) select(current.id);
}

/**
 * Logs the experience line and loot first; the campaign page reads the closing "Combat ended" entry to mark
 * the encounter finished.
 */
export function endCombat(xp: string | null, loot: readonly string[]): void {
  useEncounterStore.getState().update((d) => {
    if (xp) addLog(d, 'xp', xp);
    loot.forEach((line) => addLog(d, 'loot', `Loot: ${line}`));
    d.round = 0;
    d.turnIndex = 0;
    d.turnStart = null;
    addLog(d, 'turn', COMBAT_ENDED_TEXT);
  }, 'End combat');
}

/** Rolls to-hit and damage of `action` and logs them; throws for dice formulas that don't parse. */
export function rollAction(attacker: Combatant, action: CreatureAction, mode: RollMode): AttackResult | null {
  const result = action.attack && rollAttack(attacker.name, action.name, action.attack, mode);
  if (result) useEncounterStore.getState().update((d) => addLog(d, 'roll', result.text));
  return result ?? null;
}
