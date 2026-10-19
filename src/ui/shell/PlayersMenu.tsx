import { countOf } from '@/core/plural';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { useLanStore } from '@/state/lanStore';
import { usePlayerUploadStore } from '@/state/playerUploadStore';
import { useRelayStore } from '@/state/relayStore';
import { usePlayerDataStore } from '@/sync/playerData';
import { Button, Icon, Popover } from '../kit';
import { monitorLabel, usePlayerWindowStore } from '../playerWindow';
import { PlayerEditsLine } from './PlayerEdits';
import { LanLine, OnlineLine, WindowLine } from './PlayerLines';
import { PlayerUploadsLine } from './PlayerUploads';

/** Short status of how players see the game right now, e.g. "Window on DISPLAY2 · LAN 2 players". */
function usePlayersStatus(): string {
  const playerWindow = usePlayerWindowStore((s) => s);
  const lan = useLanStore((s) => s.info);
  const remoteLink = useRelayStore((s) => s.link);
  const remotePlayers = useRelayStore((s) => s.players);
  const pictures = usePlayerUploadStore((s) => s.pending.length);
  const edits = usePlayerDataStore((s) => s.pending.length);
  const parts = [
    playerWindow.open && playerWindow.monitor ? `Window on ${monitorLabel(playerWindow.monitor)}` : null,
    playerWindow.open && !playerWindow.monitor ? 'Window' : null,
    lan ? `LAN ${countOf(lan.players, 'player')}` : null,
    remoteLink === 'online' ? `Remote ${countOf(remotePlayers, 'player')}` : null,
    remoteLink === 'connecting' || remoteLink === 'reconnecting' ? 'Remote connecting' : null,
    pictures > 0 ? `${countOf(pictures, 'picture')} to review` : null,
    edits > 0 ? `${countOf(edits, 'sheet change')} to review` : null,
  ].filter((p) => p !== null);
  return parts.length > 0 ? parts.join(' · ') : 'Off';
}

/** What the publisher currently sends: the open encounter and its map. */
function PlayersSee() {
  const encounterName = useEncounterStore((s) => s.encounter?.name ?? null);
  const mapName = useEncounterStore((s) => s.map?.name ?? null);
  const shown = mapName === null ? 'no map shown' : encounterName ? `${encounterName} on ${mapName}` : mapName;
  return (
    <p className="players-see">
      <Icon name="eye" size={16} />
      <span>
        Players see: <strong>{shown}</strong>
      </span>
    </p>
  );
}

/** Rail entry for the player view: status at a glance and quick actions; setup lives in Settings > Players. */
export function PlayersMenu() {
  const status = usePlayersStatus();
  const navigate = useAppStore((s) => s.navigate);
  const live = status !== 'Off';

  return (
    <Popover
      label="Player view"
      placement="right"
      trigger={(open, toggle) => (
        <button
          type="button"
          className={open ? 'rail-item active' : 'rail-item'}
          onClick={toggle}
          aria-expanded={open}
          aria-label={`Players: ${status}`}
          title={`Players: ${status}`}
        >
          <span className="rail-icon">
            <Icon name="monitor" size={22} />
            {live && <span className="rail-dot" />}
          </span>
          <span className="rail-label">Players</span>
        </button>
      )}
    >
      {(close) => (
        <div className="players-menu col">
          <div className="row">
            <h2 className="grow">Player view</h2>
            <span className={live ? 'players-status live' : 'players-status'}>{status}</span>
          </div>
          <PlayersSee />
          <WindowLine />
          {/* Links open: the QR code is what phones need to join. */}
          <LanLine linksOpen />
          <OnlineLine />
          <PlayerUploadsLine />
          <PlayerEditsLine />
          <div className="row">
            <Button
              icon="settings"
              label="Player settings"
              variant="ghost"
              onClick={() => {
                close();
                navigate({ page: 'settings', section: 'players' });
              }}
            />
          </div>
        </div>
      )}
    </Popover>
  );
}
