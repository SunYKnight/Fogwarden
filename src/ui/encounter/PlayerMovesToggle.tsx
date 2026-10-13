import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { CheckboxField } from '../components/fields';

/** Table switch: players may drag their own character's token; every move stays undoable here. */
export function PlayerMovesToggle({ allowed }: { allowed: boolean }) {
  return (
    <CheckboxField
      label="Players move their own tokens"
      value={allowed}
      onChange={(allow) => {
        const label = allow ? 'Let players move their tokens' : 'Stop players moving their tokens';
        useEncounterStore.getState().update((d) => void (d.playersMoveTokens = allow), label);
        useAppStore
          .getState()
          .notify(allow ? 'Players may move their own tokens' : 'Players can no longer move their tokens', 'info');
      }}
    />
  );
}
