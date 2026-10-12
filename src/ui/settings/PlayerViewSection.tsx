import { isTauri } from '@tauri-apps/api/core';
import { useState } from 'react';
import type { Settings } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { CheckboxField } from '../components/fields';
import { Button, Section } from '../kit';
import { identifyMonitors, monitorLabel, openPlayerWindow } from '../playerWindow';
import { monitorLayout } from './monitorLayout';
import { useMonitors } from './useMonitors';

const MAP_SIZE = { width: 460, height: 160 };

/** The desktop's monitors drawn to scale; clicking one makes it the player window's monitor. */
function MonitorMap({ settings, save }: { settings: Settings; save: (s: Settings) => void }) {
  const { monitors, primary } = useMonitors();
  const indexed = monitors.map((monitor, index) => ({ monitor, index }));
  const layout = monitorLayout(
    indexed,
    ({ monitor: { position, size } }) => ({ x: position.x, y: position.y, width: size.width, height: size.height }),
    MAP_SIZE.width,
    MAP_SIZE.height,
  );
  const chosen = settings.playerWindow.monitorName ?? primary;
  const missing = chosen !== null && !monitors.some((m) => m.name === chosen);

  return (
    <div className="col">
      <div className="monitor-map" style={{ width: layout.width, height: layout.height }} role="radiogroup">
        {layout.placed.map(({ item: { monitor, index }, rect }) => (
          <button
            key={`${monitor.name}-${index}`}
            type="button"
            role="radio"
            aria-checked={monitor.name === chosen}
            className={monitor.name === chosen ? 'monitor active' : 'monitor'}
            style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
            disabled={monitor.name === null}
            title={`${monitorLabel(monitor.name)}: ${monitor.size.width}×${monitor.size.height}`}
            onClick={() => save({ ...settings, playerWindow: { ...settings.playerWindow, monitorName: monitor.name } })}
          >
            <span className="monitor-number">{index + 1}</span>
            <span className="small">{monitorLabel(monitor.name)}</span>
            <span className="small muted">
              {monitor.size.width}×{monitor.size.height}
              {monitor.name === primary ? ' · primary' : ''}
            </span>
          </button>
        ))}
      </div>
      {missing && (
        <p className="muted small">
          The chosen monitor {monitorLabel(chosen)} is not connected; the window opens on the primary monitor.
        </p>
      )}
    </div>
  );
}

/** Where the desktop player window opens, with a visual monitor picker and a test. */
export function PlayerViewSection({ settings, save }: { settings: Settings; save: (s: Settings) => void }) {
  const reportError = useAppStore((s) => s.reportError);
  const [identifying, setIdentifying] = useState(false);

  const identify = () => {
    setIdentifying(true);
    identifyMonitors()
      .catch(reportError)
      .finally(() => setIdentifying(false));
  };

  return (
    <Section title="Player view">
      {isTauri() ? (
        <div className="col">
          <p className="muted">Click the monitor the players look at. Numbers match the "Identify" labels.</p>
          <MonitorMap settings={settings} save={save} />
          <div className="row wrap">
            <Button icon="info" label="Identify monitors" disabled={identifying} onClick={identify} />
            <Button icon="external" label="Test window" onClick={() => openPlayerWindow(settings).catch(reportError)} />
          </div>
          <CheckboxField
            label="Fullscreen"
            value={settings.playerWindow.fullscreen}
            onChange={(v) => save({ ...settings, playerWindow: { ...settings.playerWindow, fullscreen: v } })}
          />
        </div>
      ) : (
        <p className="muted">
          In the browser the player view opens in a new tab you can drag to another screen; choosing a monitor needs the
          desktop app.
        </p>
      )}
    </Section>
  );
}
