import type { Condition } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { titleCase } from '../creature/StatBlock';
import { openContextMenu, type MenuItem } from '../kit';
import {
  confirmRemoveFromEncounter,
  removeFromMap,
  rollInitiativeFor,
  setHidden,
  toggleCondition,
} from './combatantCommands';
import { startPlacing, useEncounterUi } from './encounterUiStore';

// Conditions a DM toggles most mid-fight; the rest live in the creature dock.
const QUICK_CONDITIONS: Condition[] = ['prone', 'poisoned', 'frightened', 'restrained', 'unconscious'];

/** Context menu of a combatant (token right-click or initiative strip row); selects it as well. */
export function openCombatantMenu(id: string, x: number, y: number): void {
  const { encounter, map, select } = useEncounterStore.getState();
  const c = encounter?.combatants.find((m) => m.id === id);
  const reportError = useAppStore.getState().reportError;
  const conditionItems: MenuItem[] = QUICK_CONDITIONS.map((condition) => ({
    label: titleCase(condition),
    icon: c?.conditions.includes(condition) ? 'check' : undefined,
    run: () => toggleCondition(id, condition),
  }));
  const items: MenuItem[] = [
    {
      label: 'Damage…',
      icon: 'swords',
      run: () => useEncounterUi.setState({ hpPrompt: { combatantId: id, change: 'damage' } }),
    },
    {
      label: 'Heal…',
      icon: 'heart',
      run: () => useEncounterUi.setState({ hpPrompt: { combatantId: id, change: 'heal' } }),
    },
    ...conditionItems,
    { label: 'More conditions…', run: () => useEncounterUi.setState({ dockCollapsed: false }) },
    { label: 'Roll initiative', icon: 'dice', run: () => rollInitiativeFor([id]) },
    c?.hiddenFromPlayers
      ? { label: 'Show to players', icon: 'eye', run: () => setHidden(id, false) }
      : { label: 'Hide from players', icon: 'eyeOff', run: () => setHidden(id, true) },
    c?.position
      ? { label: 'Remove from map', icon: 'close', run: () => removeFromMap(id) }
      : { label: 'Place on map', icon: 'map', disabled: map === null, run: () => startPlacing(id, false) },
    {
      label: 'Remove from encounter…',
      icon: 'trash',
      danger: true,
      run: () => void confirmRemoveFromEncounter(id).catch(reportError),
    },
  ];
  if (c) {
    select(id);
    openContextMenu(x, y, items);
  }
}
