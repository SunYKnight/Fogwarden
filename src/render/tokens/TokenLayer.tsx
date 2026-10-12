import { useEncounterStore } from '@/state/encounterStore';
import { currentCombatant } from '@/state/encounterActions';
import type { PlayerCombatant } from '@/sync/protocol';
import { usePlayerStore } from '@/ui/player/playerStore';
import { useMapRender } from '../mapRenderContext';
import { TokenView } from './TokenView';

const BAND_HEALTH: Record<NonNullable<PlayerCombatant['health']>, number> = {
  unhurt: 1,
  hurt: 0.75,
  bloodied: 0.4,
  down: 0,
};

function DmTokens() {
  const encounter = useEncounterStore((s) => s.encounter);
  const selectedId = useEncounterStore((s) => s.selectedCombatantId);
  const currentId = encounter ? currentCombatant(encounter)?.id : undefined;
  return encounter?.combatants.map(
    (c) =>
      c.position && (
        <TokenView
          key={c.id}
          id={c.id}
          name={c.name}
          side={c.side}
          size={c.size}
          position={c.position}
          token={c.token}
          health={c.hp.max > 0 ? Math.max(0, c.hp.current) / c.hp.max : null}
          ghost={c.hiddenFromPlayers}
          selected={c.id === selectedId}
          current={c.id === currentId}
        />
      ),
  );
}

function PlayerTokens() {
  const encounter = usePlayerStore((s) => s.encounter);
  return encounter?.combatants.map(
    (c) =>
      c.position && (
        <TokenView
          key={c.id}
          id={c.id}
          name={c.name}
          side={c.side}
          size={c.size}
          position={c.position}
          token={c.token}
          health={c.health ? BAND_HEALTH[c.health] : null}
          current={c.id === encounter.activeCombatantId}
        />
      ),
  );
}

/** Combatant tokens: the DM sees every combatant (hidden ones ghosted), players only what the DM sent. */
export function TokenLayer() {
  const { mode } = useMapRender();
  return mode === 'dm' ? <DmTokens /> : mode === 'player' ? <PlayerTokens /> : null;
}
