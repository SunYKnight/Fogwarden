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

// Players read health from the name tag's colour, never from a bar.
const BAND_TAG: Record<PlayerCombatant['health'], string> = {
  healthy: 'rgba(46, 140, 70, 0.9)',
  wounded: 'rgba(214, 120, 20, 0.9)',
  critical: 'rgba(190, 40, 40, 0.9)',
  down: 'rgba(0, 0, 0, 0.95)',
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
          health={null}
          nameTag={BAND_TAG[c.health]}
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
