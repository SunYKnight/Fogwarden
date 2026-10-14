import { useState } from 'react';
import { useEncounterStore } from '@/state/encounterStore';
import { Button, Dialog } from '../kit';
import { changeHp, HP_CHANGE_LABEL } from './combatantCommands';
import { useEncounterUi, type HpChange } from './encounterUiStore';

const close = () => useEncounterUi.setState({ hpPrompt: null });

function HpPrompt({ combatantId, change }: { combatantId: string; change: HpChange }) {
  const combatant = useEncounterStore((s) => s.encounter?.combatants.find((c) => c.id === combatantId));
  const [amount, setAmount] = useState('');
  const value = Math.round(Number(amount));
  const valid = amount.trim() !== '' && Number.isFinite(value) && value > 0;
  const apply = () => {
    if (valid) {
      changeHp(combatantId, change, value);
      close();
    }
  };
  return (
    <Dialog
      title={`${HP_CHANGE_LABEL[change]} ${combatant?.name ?? ''}`}
      onClose={close}
      width={320}
      footer={
        <>
          <Button label="Cancel" onClick={close} />
          <Button
            label={HP_CHANGE_LABEL[change]}
            variant={change === 'damage' ? 'danger' : 'primary'}
            disabled={!valid}
            onClick={apply}
          />
        </>
      }
    >
      <div className="col">
        <span className="muted">
          HP {combatant?.hp.current} / {combatant?.hp.max}
          {combatant && combatant.hp.temp > 0 ? ` + ${combatant.hp.temp} temp` : ''}
        </span>
        <input
          type="number"
          min={1}
          placeholder="Amount"
          aria-label="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply();
          }}
        />
      </div>
    </Dialog>
  );
}

/** Amount prompt opened by Damage… / Heal… in the combatant context menu. */
export function HpPromptDialog() {
  const prompt = useEncounterUi((s) => s.hpPrompt);
  return prompt && <HpPrompt key={`${prompt.combatantId}:${prompt.change}`} {...prompt} />;
}
