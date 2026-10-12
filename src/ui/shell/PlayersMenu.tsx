import { isTauri } from '@tauri-apps/api/core';
import { useAppStore } from '@/state/appStore';
import { useEncounterStore } from '@/state/encounterStore';
import { useLanStore } from '@/state/lanStore';
import { useRelayStore } from '@/state/relayStore';
import { useDmCameraStore } from '@/sync/cameraStore';
import { usePlayerViewStore } from '@/sync/playerViewStore';
import { CheckboxField, SelectField } from '../components/fields';
import { Button, Icon, Popover, Section } from '../kit';
import { closePlayerWindow, monitorLabel, openPlayerWindow, usePlayerWindowStore } from '../playerWindow';
import { describeMonitor, useMonitors } from '../settings/useMonitors';
import { LanControls } from './LanControls';

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

/** Monitor and fullscreen for the player window; the same settings as on the Settings page. */
function WindowSection() {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const reportError = useAppStore((s) => s.reportError);
  const windowOpen = usePlayerWindowStore((s) => s.open);
  const { monitors, primary } = useMonitors();
  const toggle = () =>
    (windowOpen ? closePlayerWindow() : settings ? openPlayerWindow(settings) : Promise.resolve()).catch(reportError);
  const chosen = settings?.playerWindow.monitorName ?? '';
  const connected = monitors.map((m) => m.name ?? '').filter((n) => n.length > 0);
  // A monitor chosen earlier stays selectable while it is unplugged.
  const names = ['', ...connected, ...(chosen === '' || connected.includes(chosen) ? [] : [chosen])];
  const describe = (name: string) => {
    const index = monitors.findIndex((m) => m.name === name);
    const monitor = monitors[index];
    return monitor
      ? describeMonitor(monitor, index)
      : name === ''
        ? `Primary (${monitorLabel(primary)})`
        : `${monitorLabel(name)} (not connected)`;
  };

  return (
    <Section title="Window">
      <div className="col">
        <Button
          icon={windowOpen ? 'close' : 'external'}
          label={windowOpen ? 'Close player window' : 'Open player window'}
          variant={windowOpen ? 'default' : 'primary'}
          disabled={!settings}
          onClick={toggle}
        />
        {settings && isTauri() && (
          <>
            <SelectField
              label="Monitor"
              value={chosen}
              options={names}
              format={describe}
              onChange={(v) =>
                setSettings({
                  ...settings,
                  playerWindow: { ...settings.playerWindow, monitorName: v === '' ? null : v },
                }).catch(reportError)
              }
            />
            <CheckboxField
              label="Fullscreen"
              value={settings.playerWindow.fullscreen}
              onChange={(v) =>
                setSettings({ ...settings, playerWindow: { ...settings.playerWindow, fullscreen: v } }).catch(
                  reportError,
                )
              }
            />
            {windowOpen && <p className="muted small">Monitor and fullscreen apply when the window opens next.</p>}
          </>
        )}
        {!isTauri() && <p className="muted small">In the browser the player view opens in a new tab.</p>}
      </div>
    </Section>
  );
}

function ShowSection() {
  const push = useDmCameraStore((s) => s.push);
  const setPush = useDmCameraStore((s) => s.setPush);
  const showTurnOrder = usePlayerViewStore((s) => s.showTurnOrder);
  return (
    <Section title="Show">
      <CheckboxField label="Push my camera to players" value={push} onChange={setPush} />
      <CheckboxField
        label="Show turn order to players"
        value={showTurnOrder}
        onChange={(v) => usePlayerViewStore.setState({ showTurnOrder: v })}
      />
    </Section>
  );
}

/** Rail entry for the player view: status at a glance, window, LAN and what players see in a popover. */
export function PlayersMenu() {
  const status = usePlayersStatus();
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
      <div className="players-menu col">
        <div className="row">
          <h2 className="grow">Player view</h2>
          <span className={live ? 'players-status live' : 'players-status'}>{status}</span>
        </div>
        <PlayersSee />
        <WindowSection />
        <ShowSection />
        <Section title="LAN">
          <LanControls />
        </Section>
      </div>
    </Popover>
  );
}
