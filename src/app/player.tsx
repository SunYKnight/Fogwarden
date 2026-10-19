import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LanStorage } from '@/data/lanStorage';
import { Repository } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { RELAY_LINK_PARAM } from '@/sync/relayApi';
import { createLocalTransport } from '@/sync/transports';
import { WebSocketTransport } from '@/sync/wsTransport';
import { IdentifyScreen } from '@/ui/player/IdentifyScreen';
import { PlayerApp } from '@/ui/player/PlayerApp';
import '@/ui/app.css';

// `?token=` (LAN) or `?t=` (relay link) means a browser player. The LAN
// server or the relay serves this page itself; in development Vite serves
// it and `?ws=ws://127.0.0.1:<port>/ws` names the server. Assets then come
// from that server instead of local storage, and uploads go there.
function lanConnection(params: URLSearchParams, token: string): { transport: WebSocketTransport; serverUrl: string } {
  const sameOrigin = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
  const socketUrl = new URL(params.get('ws') ?? sameOrigin);
  const serverUrl = `${socketUrl.protocol === 'wss:' ? 'https:' : 'http:'}//${socketUrl.host}`;
  useAppStore.setState({ repository: new Repository(new LanStorage(serverUrl, token)) });
  socketUrl.searchParams.set('token', token);
  return { transport: new WebSocketTransport(socketUrl.href), serverUrl };
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('player.html is missing #root');
}
const params = new URLSearchParams(location.search);
const token = params.get('token') ?? params.get(RELAY_LINK_PARAM);
const identify = params.get('identify');
const connection = token === null ? null : lanConnection(params, token);
const lan = connection?.transport ?? null;
const uploadTo = connection && token !== null ? { serverUrl: connection.serverUrl, token } : null;
// The player window on the DM's computer shares its GPU, so it follows the
// DM's graphics settings; browser players render with the defaults.
if (lan === null && identify === null) {
  const { repository, reportError } = useAppStore.getState();
  repository.loadSettings().then((settings) => useAppStore.setState({ settings }), reportError);
}
// `?identify=` windows only label a monitor for the DM's monitor test.
createRoot(root).render(
  <StrictMode>
    {identify === null ? (
      <PlayerApp transport={lan ?? createLocalTransport('player')} lan={lan} uploadTo={uploadTo} />
    ) : (
      <IdentifyScreen number={identify} name={params.get('name') ?? ''} />
    )}
  </StrictMode>,
);
