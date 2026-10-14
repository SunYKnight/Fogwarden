import { countOf } from '@/core/plural';
import { formatModifier } from '@/core/rules/abilities';
import { saveBonus } from '@/core/rules/areaEffects';
import { useAppStore } from '@/state/appStore';
import { rollConcentrationSave } from '@/state/combatRules';
import { addLog } from '@/state/encounterActions';
import { useEncounterStore } from '@/state/encounterStore';
import { Button, Dialog } from '../kit';
import { patchCombatant } from './combatantCommands';
import { useCreature } from './creatureLookup';
import { useEncounterUi } from './encounterUiStore';

type Outcome = 'roll' | 'kept' | 'lost';

/** Drops the answered check and every queued check of combatants no longer concentrating. */
function settle(answered: { combatantId: string; dc: number }): void {
  const combatants = useEncounterStore.getState().encounter?.combatants ?? [];
  useEncounterUi.setState((s) => ({
    concentrationChecks: s.concentrationChecks.filter(
      (c) => c !== answered && combatants.some((x) => x.id === c.combatantId && x.concentrating),
    ),
  }));
}

/** Constitution save a concentrating combatant owes after taking damage: rolled, or answered by the DM. */
export function ConcentrationDialog() {
  const checks = useEncounterUi((s) => s.concentrationChecks);
  const encounter = useEncounterStore((s) => s.encounter);
  const check = checks.find((c) => encounter?.combatants.some((x) => x.id === c.combatantId && x.concentrating));
  const combatant = encounter?.combatants.find((c) => c.id === check?.combatantId);
  const creature = useCreature(combatant?.creature ?? null);
  const bonus = saveBonus(creature, 'con');
  const notify = useAppStore((s) => s.notify);

  const answer = (outcome: Outcome) => {
    if (check && combatant) {
      let kept = outcome === 'kept';
      patchCombatant(combatant.id, `Concentration save ${combatant.name}`, (c, d) => {
        if (outcome === 'roll') {
          kept = rollConcentrationSave(d, c, check.dc, bonus);
        } else {
          c.concentrating = kept;
          addLog(d, 'note', `${c.name} ${kept ? 'keeps' : 'loses'} concentration (DC ${check.dc})`);
        }
      });
      settle(check);
      notify(`${combatant.name} ${kept ? 'keeps' : 'loses'} concentration`, kept ? 'success' : 'info');
    }
  };

  return check && combatant ? (
    <Dialog
      title="Concentration"
      onClose={() => settle(check)}
      width={380}
      footer={
        <>
          <Button label="Lost it" variant="danger" onClick={() => answer('lost')} />
          <Button label="Kept it" onClick={() => answer('kept')} />
          <Button
            icon="dice"
            label={`Roll CON save ${formatModifier(bonus)}`}
            variant="primary"
            onClick={() => answer('roll')}
          />
        </>
      }
    >
      <p>
        {combatant.name} took damage while concentrating: Constitution save <strong>DC {check.dc}</strong>.
      </p>
      {checks.length > 1 && <p className="muted small">{countOf(checks.length - 1, 'more check')} waiting.</p>}
    </Dialog>
  ) : null;
}
