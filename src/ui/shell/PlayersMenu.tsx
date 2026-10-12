import { useAppStore } from '@/state/appStore';
import { useLanStore } from '@/state/lanStore';
import { LanPanel } from '../encounter/LanPanel';
import { Button, Icon, Popover } from '../kit';
import { closePlayerWindow, openPlayerWindow, usePlayerWindowStore } from '../playerWindow';

/** Short status of what players can see right now, e.g. "Window · LAN 2". */
export function usePlayersStatus(): string {
  const windowOpen = usePlayerWindowStore((s) => s.open);
  const lan = useLanStore((s) => s.info);
  const parts = [windowOpen ? 'Window' : null, lan ? `LAN ${lan.players}` : null].filter((p) => p !== null);
  return parts.length > 0 ? parts.join(' · ') : 'Off';
}

/** Rail entry for the player view: status at a glance, window and LAN controls in a popover. */
export function PlayersMenu() {
  const settings = useAppStore((s) => s.settings);
  const reportError = useAppStore((s) => s.reportError);
  const windowOpen = usePlayerWindowStore((s) => s.open);
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
          title={`Player view: ${status}`}
        >
          <span className="rail-icon">
            <Icon name="monitor" size={22} />
            {live && <span className="rail-dot" />}
          </span>
          <span className="rail-label">Players</span>
        </button>
      )}
    >
      <div className="col" style={{ width: 340 }}>
        <h2>Player view</h2>
        <div className="row">
          <Button
            icon={windowOpen ? 'close' : 'external'}
            label={windowOpen ? 'Close player window' : 'Open player window'}
            variant={windowOpen ? 'default' : 'primary'}
            disabled={!settings}
            onClick={() =>
              (windowOpen ? closePlayerWindow() : settings ? openPlayerWindow(settings) : Promise.resolve()).catch(
                reportError,
              )
            }
          />
        </div>
        <p className="muted">
          The window opens on the monitor chosen in Settings. Players only see what their characters see.
        </p>
        <LanPanel />
      </div>
    </Popover>
  );
}
