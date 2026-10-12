import { useEffect, useState } from 'react';
import type { Monitor } from '@tauri-apps/api/window';
import type { Settings } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { CheckboxField, Field, NumberField, SelectField } from '../components/fields';
import { listMonitors } from '../playerWindow';

function DataRootPanel() {
  const roots = useAppStore((s) => s.roots);
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const refreshAll = useLibraryStore((s) => s.refreshAll);
  const [path, setPath] = useState('');

  const apply = async () => {
    const next = await repository.storage.setDataRoot(path.trim());
    useAppStore.setState({ roots: next });
    await useAppStore.getState().init();
    await refreshAll();
    setPath('');
  };

  return (
    <div className="panel col">
      <h2>Data</h2>
      <Field label="Data folder">
        <code>{roots?.dataRoot}</code>
      </Field>
      <Field label="Shipped content">
        <code>{roots?.contentRoot}</code>
      </Field>
      <Field label="Move to">
        <div className="row">
          <input
            style={{ flex: 1 }}
            placeholder="e.g. D:\\Dropbox\\DnD"
            value={path}
            onChange={(e) => setPath(e.target.value)}
          />
          <button disabled={path.trim().length === 0} onClick={() => apply().catch(reportError)}>
            Use folder
          </button>
        </div>
      </Field>
      <p className="muted">
        Switching uses the new folder as is; existing files are not moved. Copy the old folder first to keep your data.
      </p>
    </div>
  );
}

function PlayerWindowPanel({ settings, save }: { settings: Settings; save: (s: Settings) => void }) {
  const reportError = useAppStore((s) => s.reportError);
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  useEffect(() => {
    listMonitors().then(setMonitors, reportError);
  }, [reportError]);
  const names = ['(primary)', ...monitors.map((m) => m.name ?? '').filter((n) => n.length > 0)];

  return (
    <div className="panel col">
      <h2>Player view</h2>
      <SelectField
        label="Monitor"
        value={settings.playerWindow.monitorName ?? '(primary)'}
        options={names}
        onChange={(v) =>
          save({ ...settings, playerWindow: { ...settings.playerWindow, monitorName: v === '(primary)' ? null : v } })
        }
      />
      <CheckboxField
        label="Fullscreen"
        value={settings.playerWindow.fullscreen}
        onChange={(v) => save({ ...settings, playerWindow: { ...settings.playerWindow, fullscreen: v } })}
      />
      <NumberField
        label="LAN port"
        value={settings.lan.port}
        min={1024}
        max={65535}
        onChange={(v) => save({ ...settings, lan: { port: v } })}
      />
    </div>
  );
}

export function SettingsPage() {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);
  const reportError = useAppStore((s) => s.reportError);
  const save = (next: Settings) => setSettings(next).catch(reportError);

  return settings ? (
    <div className="col" style={{ maxWidth: 720 }}>
      <DataRootPanel />
      <PlayerWindowPanel settings={settings} save={save} />
      <div className="panel col">
        <h2>Rules</h2>
        <SelectField
          label="Diagonals"
          value={settings.diagonalRule}
          options={['5-5-5', '5-10-5'] as const}
          format={(v) => (v === '5-5-5' ? 'Every diagonal 5 ft (PHB)' : 'Alternate 5/10 ft (DMG variant)')}
          onChange={(v) => save({ ...settings, diagonalRule: v })}
        />
      </div>
    </div>
  ) : (
    <div className="waiting">Loading settings…</div>
  );
}
