import { useEffect, useState, type ReactNode } from 'react';
import { useAppStore, type Route } from '@/state/appStore';
import { startAutosave } from '@/state/autosave';
import { useLanStore } from '@/state/lanStore';
import { useLibraryStore } from '@/state/libraryStore';
import { startDmPublisher } from '@/sync/dmPublisher';
import { startFogTracker } from '@/sync/fogTracker';
import { createLocalTransport } from '@/sync/transports';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MapEditorPage } from './editor/MapEditorPage';
import { ConfirmHost, ContextMenuHost, ShortcutHost, ToastHost } from './kit';
import { CampaignsPage } from './pages/CampaignsPage';
import { CompendiumPage } from './pages/CompendiumPage';
import { MapsPage } from './pages/MapsPage';
import { PlayPage } from './pages/PlayPage';
import { refreshPlayerWindowState } from './playerWindow';
import { SettingsPage } from './settings/SettingsPage';
import { NavRail } from './shell/NavRail';

function Page({ route }: { route: Route }) {
  let page: ReactNode;
  switch (route.page) {
    case 'maps':
      page = <MapsPage />;
      break;
    case 'map-editor':
      page = <MapEditorPage mapRef={route.map} />;
      break;
    case 'compendium':
      page = <CompendiumPage tab={route.tab} />;
      break;
    case 'campaigns':
      page = <CampaignsPage campaignId={route.campaignId} />;
      break;
    case 'play':
      page = <PlayPage />;
      break;
    case 'settings':
      page = <SettingsPage />;
      break;
  }
  return page;
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
    refreshPlayerWindowState().catch(reportError);
  }, [reportError]);

  useEffect(() => {
    useAppStore
      .getState()
      .init()
      .then(() => useLibraryStore.getState().refreshAll())
      .then(() => setReady(true), reportError);
    const stop = startAutosave();
    const flush = () => void stop();
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      stop().catch(reportError);
    };
  }, [reportError]);

  return (
    <div className="shell">
      <NavRail />
      <main className="shell-main">
        {ready ? (
          <ErrorBoundary resetKey={JSON.stringify(route)}>
            <Page route={route} />
          </ErrorBoundary>
        ) : (
          <div className="waiting">Loading…</div>
        )}
      </main>
      <ToastHost />
      <ConfirmHost />
      <ContextMenuHost />
      <ShortcutHost />
    </div>
  );
}
