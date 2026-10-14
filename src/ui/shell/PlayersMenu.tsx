import { isTauri } from '@tauri-apps/api/core';
import { useState, type ReactNode } from 'react';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { useLanStore } from '@/state/lanStore';
import { useRelayStore } from '@/state/relayStore';
import { Button, Icon, Popover, type IconName } from '../kit';
import { closePlayerWindow, monitorLabel, openPlayerWindow, usePlayerWindowStore } from '../playerWindow';
import { LINK_TEXT, ONLINE_PLAY_AVAILABLE, RelayButton } from '../server/OnlineSection';
import { LanButton, LanLinks } from './LanControls';

/** Short status of how players see the game right now, e.g. "Window on DISPLAY2 · LAN 2 players". */
export function usePlayersStatus(): string {
  const playerWindow = usePlayerWindowStore((s) => s);
  const lan = useLanStore((s) => s.info);
  const remoteLink = useRelayStore((s) => s.link);
  const remotePlayers = useRelayStore((s) => s.players);
  const parts = [
    playerWindow.open && playerWindow.monitor ? `Window on ${monitorLabel(playerWindow.monitor)}` : null,
    playerWindow.open && !playerWindow.monitor ? 'Window' : null,
    lan ? `LAN ${lan.players} ${lan.players === 1 ? 'player' : 'players'}` : null,
    remoteLink === 'online' ? `Remote ${remotePlayers} ${remotePlayers === 1 ? 'player' : 'players'}` : null,
    remoteLink === 'connecting' || remoteLink === 'reconnecting' ? 'Remote connecting' : null,
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

interface LineProps {
  icon: IconName;
  title: string;
  status: string;
  /** Buttons at the right end of the line. */
  actions: ReactNode;
}

function PlayersLine({ icon, title, status, actions }: LineProps) {
  return (
    <div className="players-line">
      <Icon name={icon} size={20} />
      <div className="players-line-text">
        <strong>{title}</strong>
        <span className="muted small">{status}</span>
      </div>
      <div className="row">{actions}</div>
    </div>
  );
}

function WindowLine() {
  const settings = useAppStore((s) => s.settings);
  const reportError = useAppStore((s) => s.reportError);
  const { open, monitor } = usePlayerWindowStore();
  const status = !isTauri()
    ? 'Opens in a new browser tab'
    : open
      ? `Open on ${monitor ? monitorLabel(monitor) : 'an unknown monitor'}`
      : 'Closed';
  return (
    <PlayersLine
      icon="monitor"
      title="Player window"
      status={status}
      actions={
        open ? (
          <Button icon="close" label="Close" onClick={() => closePlayerWindow().catch(reportError)} />
        ) : (
          <Button
            icon="external"
            label="Open"
            variant="primary"
            disabled={!settings}
            onClick={() => (settings ? openPlayerWindow(settings).catch(reportError) : undefined)}
          />
        )
      }
    />
  );
}

function LanLine() {
  const info = useLanStore((s) => s.info);
  // Open by default: the QR code is what phones need to join.
  const [showLinks, setShowLinks] = useState(true);
  const desktop = isTauri();
  const status = !desktop
    ? 'Needs the desktop app'
    : info
      ? `On · ${info.players} ${info.players === 1 ? 'player' : 'players'}`
      : 'Off';
  return (
    <>
      <PlayersLine
        icon="wifi"
        title="LAN"
        status={status}
        actions={
          desktop && (
            <>
              {info && (
                <Button
                  icon="qr"
                  label="Links and QR codes"
                  iconOnly
                  variant="ghost"
                  active={showLinks}
                  onClick={() => setShowLinks(!showLinks)}
                />
              )}
              <LanButton variant="default" />
            </>
          )
        }
      />
      {info && showLinks && (
        <div className="players-line-detail">
          <LanLinks info={info} />
        </div>
      )}
    </>
  );
}

function OnlineLine() {
  const remote = useAppStore((s) => s.settings?.remote ?? null);
  const link = useRelayStore((s) => s.link);
  const desktop = isTauri();
  const host = remote?.url.replace(/^https?:\/\//, '').replace(/\/+$/, '') ?? '';
  const status = !desktop ? 'Needs the desktop app' : link === 'online' ? `Connected to ${host}` : LINK_TEXT[link];
  return (
    <PlayersLine
      icon="server"
      title="Online"
      status={status}
      actions={desktop && remote && <RelayButton remote={remote} variant="default" />}
    />
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
          <LanLine />
          {ONLINE_PLAY_AVAILABLE && <OnlineLine />}
          <div className="row">
            <Button
              icon="settings"
              label="Player settings…"
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
