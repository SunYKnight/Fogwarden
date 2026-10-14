import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow, type CloseRequestedEvent } from '@tauri-apps/api/window';
import { useEffect, useState, type ReactNode } from 'react';
import { PARTY_VIEW } from '@/core/model';
import { startDmSound } from '@/sound/dmSound';
import { useAppStore, type Route } from '@/state/appStore';
import { flushEncounter, flushMap, startAutosave } from '@/state/autosave';
import { useEditorStore } from '@/state/editorStore';
import { useEncounterStore } from '@/state/encounterStore';
import { startCalendarSync } from '@/state/calendarStore';
import { startJournalRecorder } from '@/state/journalRecorder';
import { useLanStore } from '@/state/lanStore';
import { useLibraryStore } from '@/state/libraryStore';
import { useRelayStore } from '@/state/relayStore';
import { startAutoUpdateCheck } from '@/state/updateStore';
import { startAtmospherePublisher } from '@/sync/atmospherePublisher';
import { startDmPublisher } from '@/sync/dmPublisher';
import { startFogTracker } from '@/sync/fogTracker';
import { createLocalTransport, LocalViewTransport } from '@/sync/transports';
import { startViewLinks, useViewLinksStore } from '@/sync/views';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CreatureEditorPage } from './creature/CreatureEditorPage';
import { MapEditorPage } from './editor/MapEditorPage';
import { useActiveEncounter } from './encounter/useActiveEncounter';
import { HomePage } from './home/HomePage';
import { ConfirmHost, ContextMenuHost, ShortcutHost, ToastHost } from './kit';
import { CompendiumDialogHost } from './library/CompendiumDialogHost';
import { NewMapWizardHost } from './library/NewMapWizard';
import { CampaignsPage } from './pages/CampaignsPage';
import { CompendiumPage } from './pages/CompendiumPage';
import { MapsPage } from './pages/MapsPage';
import { PlayPage } from './pages/PlayPage';
import { refreshPlayerWindowState, usePlayerWindowStore } from './playerWindow';
import { SettingsPage } from './settings/SettingsPage';
import { CommandPalette } from './shell/CommandPalette';
import { NavRail } from './shell/NavRail';

function Page({ route }: { route: Route }) {
  let page: ReactNode;
  switch (route.page) {
    case 'home':
      page = <HomePage />;
      break;
    case 'maps':
      page = <MapsPage />;
      break;
    case 'map-editor':
      page = <MapEditorPage mapRef={route.map} />;
      break;
    case 'compendium':
      page = <CompendiumPage tab={route.tab} entryId={route.entryId} />;
      break;
    case 'campaigns':
      page = <CampaignsPage campaignId={route.campaignId} />;
      break;
    case 'play':
      page = <PlayPage />;
      break;
    case 'settings':
      page = <SettingsPage section={route.section ?? 'data'} />;
      break;
    case 'creature-editor':
      page = (
        <CreatureEditorPage
          key={route.ref ? `${route.ref.area}:${route.ref.id}` : `new-${route.kind ?? 'monster'}`}
          creatureRef={route.ref}
          kind={route.kind ?? 'monster'}
        />
      );
      break;
  }
  return page;
}

// The window closes once this resolves; a declined leave guard or a failed
// save keeps it open, so no edit is lost without the DM seeing why.
async function confirmClose(event: CloseRequestedEvent): Promise<void> {
  const { leaveGuard, reportError } = useAppStore.getState();
  try {
    const leave = leaveGuard ? await leaveGuard() : true;
    if (leave) {
      await Promise.all([flushMap(), flushEncounter()]);
    } else {
      event.preventDefault();
    }
  } catch (error) {
    event.preventDefault();
    reportError(error);
  }
}

// A browser tab cannot be held open until a save ends: the browser asks
// whether to leave while edits are unsaved, and the save starts meanwhile.
function warnUnsaved(event: BeforeUnloadEvent): void {
  const editor = useEditorStore.getState();
  const encounter = useEncounterStore.getState();
  if (editor.revision !== editor.savedRevision || encounter.revision !== encounter.savedRevision) {
    event.preventDefault();
    Promise.all([flushMap(), flushEncounter()]).catch(useAppStore.getState().reportError);
  }
}

export function DmApp() {
  const route = useAppStore((s) => s.route);
  const reportError = useAppStore((s) => s.reportError);
  const [ready, setReady] = useState(false);
  const [local] = useState(() => new LocalViewTransport(createLocalTransport('dm')));
  const lan = useLanStore((s) => s.transport);
  const relay = useRelayStore((s) => s.transport);
  const windowOpen = usePlayerWindowStore((s) => s.open);
  const chosenView = useAppStore((s) => s.settings?.playerWindow.view ?? PARTY_VIEW);
  // A character of another encounter falls back to the party.
  const windowView = useViewLinksStore((s) => (s.views.some((v) => v.id === chosenView) ? chosenView : PARTY_VIEW));

  useActiveEncounter();
  useEffect(() => startFogTracker(), []);
  useEffect(() => startViewLinks(), []);
  useEffect(() => startCalendarSync(), []);
  useEffect(() => startJournalRecorder(), []);
  useEffect(() => startDmSound(), []);
  // Browser builds have no updater; they are served, not installed.
  useEffect(() => (isTauri() ? startAutoUpdateCheck() : undefined), []);
  // In the browser the window is a tab the app cannot track.
  useEffect(() => local.setView(windowOpen || !isTauri() ? windowView : null), [local, windowOpen, windowView]);
  useEffect(() => startDmPublisher([local, ...(lan ? [lan] : []), ...(relay ? [relay] : [])]), [local, lan, relay]);
  useEffect(
    () => startAtmospherePublisher([local, ...(lan ? [lan] : []), ...(relay ? [relay] : [])]),
    [local, lan, relay],
  );
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
    return () => {
      stop().catch(reportError);
    };
  }, [reportError]);

  useEffect(() => {
    let stopListening: () => void;
    if (isTauri()) {
      const listening = getCurrentWindow().onCloseRequested(confirmClose);
      stopListening = () => {
        listening.then((unlisten) => unlisten(), reportError);
      };
    } else {
      window.addEventListener('beforeunload', warnUnsaved);
      stopListening = () => window.removeEventListener('beforeunload', warnUnsaved);
    }
    return stopListening;
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
      {/* A dialog that throws (e.g. a stat block preview) must not blank the window. */}
      <ErrorBoundary resetKey={JSON.stringify(route)}>
        <ConfirmHost />
        <CompendiumDialogHost />
        <NewMapWizardHost />
        <CommandPalette />
      </ErrorBoundary>
      <ContextMenuHost />
      <ShortcutHost />
    </div>
  );
}
