import type { Combatant, MapPoint } from '@/core/model';
import { useEncounterStore } from '@/state/encounterStore';
import { currentCombatant } from '@/state/encounterActions';
import { useCombatantToken } from '@/state/libraryStore';
import type { PlayerCombatant } from '@/sync/protocol';
import { useCombatantTypeIcon } from '@/ui/encounter/creatureLookup';
import { useEncounterUi } from '@/ui/encounter/encounterUiStore';
import { usePlayerPointer } from '@/ui/player/playerPointer';
import { usePlayerStore } from '@/ui/player/playerStore';
import { useMapRender } from '../mapRenderContext';
import { TokenView } from './TokenView';

const BAND_HEALTH: Record<NonNullable<PlayerCombatant['health']>, number> = {
  unhurt: 1,
  hurt: 0.75,
  bloodied: 0.4,
  down: 0,
};

interface DmTokenProps {
  combatant: Combatant;
  position: MapPoint;
  selected: boolean;
  current: boolean;
  interactive: boolean;
}

function DmToken({ combatant: c, position, selected, current, interactive }: DmTokenProps) {
  const token = useCombatantToken(c);
  const icon = useCombatantTypeIcon(c.creature);
  return (
    <TokenView
      id={c.id}
      name={c.name}
      side={c.side}
      size={c.size}
      position={position}
      token={token}
      icon={icon}
      health={c.hp.max > 0 ? Math.max(0, c.hp.current) / c.hp.max : null}
      ghost={c.hiddenFromPlayers}
      selected={selected}
      current={current}
      interactive={interactive}
    />
  );
}

function DmTokens() {
  const encounter = useEncounterStore((s) => s.encounter);
  const selectedId = useEncounterStore((s) => s.selectedCombatantId);
  // Standees are tall: while a token is dragged or placed, cards in front of
  // the target square must not catch the pointer meant for the floor.
  const busy = useEncounterUi((s) => s.drag !== null || s.placingId !== null);
  const currentId = encounter ? currentCombatant(encounter)?.id : undefined;
  return encounter?.combatants.map(
    (c) =>
      c.position && (
        <DmToken
          key={c.id}
          combatant={c}
          position={c.position}
          selected={c.id === selectedId}
          current={c.id === currentId}
          interactive={!busy}
        />
      ),
  );
}

function PlayerTokens() {
  const encounter = usePlayerStore((s) => s.encounter);
  // Like the DM's drag: standees must not catch the pointer meant for the floor.
  const dragging = usePlayerPointer((s) => s.drag !== null);
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
          icon={c.typeIcon}
          health={c.health ? BAND_HEALTH[c.health] : null}
          current={c.id === encounter.activeCombatantId}
          interactive={!dragging}
        />
      ),
  );
}

/** Combatant tokens: the DM sees every combatant (hidden ones ghosted), players only what the DM sent. */
export function TokenLayer() {
  const { mode } = useMapRender();
  return mode === 'dm' ? <DmTokens /> : mode === 'player' ? <PlayerTokens /> : null;
}
