import { useEffect, useState, type ReactNode } from 'react';
import { useAppStore, type Route } from '@/state/appStore';
import { startAutosave } from '@/state/autosave';
import { useLanStore } from '@/state/lanStore';
import { startDmPublisher } from '@/sync/dmPublisher';
import { startFogTracker } from '@/sync/fogTracker';
import { createLocalTransport } from '@/sync/transports';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MapEditorPage } from './editor/MapEditorPage';
import { EncounterPage } from './encounter/EncounterPage';
import { LibraryPage } from './library/LibraryPage';
import { openPlayerWindow } from './playerWindow';
import { SettingsPage } from './settings/SettingsPage';

function Toasts() {
  const errors = useAppStore((s) => s.errors);
  const dismiss = useAppStore((s) => s.dismissError);
  return (
    <div className="toasts">
      {errors.map((e) => (
        <div key={e.id} className="toast">
          <span style={{ flex: 1 }}>{e.message}</span>
          <button onClick={() => dismiss(e.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}

function Page({ route }: { route: Route }) {
  let page: ReactNode;
  switch (route.page) {
    case 'library':
      page = <LibraryPage />;
      break;
    case 'map-editor':
      page = <MapEditorPage mapRef={route.map} />;
      break;
    case 'settings':
      page = <SettingsPage />;
      break;
    case 'encounter':
      page = <EncounterPage campaignId={route.campaignId} encounterId={route.encounterId} />;
      break;
  }
  return page;
}

function TopBar() {
  const route = useAppStore((s) => s.route);
  const navigate = useAppStore((s) => s.navigate);
  const settings = useAppStore((s) => s.settings);
  const reportError = useAppStore((s) => s.reportError);
  const fullPage = route.page === 'map-editor' || route.page === 'encounter';
  return fullPage ? null : (
    <div className="topbar">
      <span className="title">DnD DM Tool</span>
      <button className={route.page === 'library' ? 'active' : ''} onClick={() => navigate({ page: 'library' })}>
        Library
      </button>
      <div className="spacer" />
      <button disabled={!settings} onClick={() => settings && openPlayerWindow(settings).catch(reportError)}>
        Player view
      </button>
      <button className={route.page === 'settings' ? 'active' : ''} onClick={() => navigate({ page: 'settings' })}>
        Settings
      </button>
    </div>
  );
}

export function DmApp() {
  const route = useAppStore((s) => s.route);
  const reportError = useAppStore((s) => s.reportError);
  const [ready, setReady] = useState(false);
  const [local] = useState(() => createLocalTransport('dm'));
  const lan = useLanStore((s) => s.transport);

  useEffect(() => startFogTracker(), []);
  useEffect(() => startDmPublisher(lan ? [local, lan] : [local]), [local, lan]);
  useEffect(() => {
    useLanStore.getState().refresh().catch(reportError);
  }, [reportError]);

  useEffect(() => {
    useAppStore
      .getState()
      .init()
      .then(() => setReady(true), reportError);
    const stop = startAutosave();
    const flush = () => void stop();
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      stop().catch(reportError);
    };
  }, [reportError]);

  const fullPage = route.page === 'map-editor' || route.page === 'encounter';
  return (
    <div className="app" style={fullPage ? { gridTemplateRows: '1fr' } : undefined}>
      <TopBar />
      <div className={fullPage ? 'page full' : 'page'}>
        {ready ? (
          <ErrorBoundary resetKey={JSON.stringify(route)}>
            <Page route={route} />
          </ErrorBoundary>
        ) : (
          <div className="waiting">Loading…</div>
        )}
      </div>
      <Toasts />
    </div>
  );
}
