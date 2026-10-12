import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { Button } from '../kit';

/** Play header switch: players may drag their own character's token; every move stays undoable here. */
export function PlayerMovesToggle({ allowed }: { allowed: boolean }) {
  return (
    <Button
      icon="move"
      label="Players move"
      active={allowed}
      aria-pressed={allowed}
      title={allowed ? 'Players drag their own tokens; Ctrl+Z undoes a move' : 'Let players drag their own tokens'}
      onClick={() => {
        const allow = !allowed;
        const label = allow ? 'Let players move their tokens' : 'Stop players moving their tokens';
        useEncounterStore.getState().update((d) => void (d.playersMoveTokens = allow), label);
        useAppStore
          .getState()
          .notify(allow ? 'Players may move their own tokens' : 'Players can no longer move their tokens', 'info');
      }}
    />
  );
}
