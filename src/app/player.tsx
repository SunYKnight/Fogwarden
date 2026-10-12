import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LanStorage } from '@/data/lanStorage';
import { Repository } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { createLocalTransport } from '@/sync/transports';
import { WebSocketTransport } from '@/sync/wsTransport';
import { IdentifyScreen } from '@/ui/player/IdentifyScreen';
import { PlayerApp } from '@/ui/player/PlayerApp';
import '@/ui/app.css';

// `?token=` means a LAN browser. The LAN server serves this page itself; in
// development Vite serves it and `?ws=ws://127.0.0.1:<port>/ws` names the
// server. Assets then come from that server instead of local storage.
function lanTransport(params: URLSearchParams, token: string): WebSocketTransport {
  const sameOrigin = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
  const socketUrl = new URL(params.get('ws') ?? sameOrigin);
  const serverUrl = `${socketUrl.protocol === 'wss:' ? 'https:' : 'http:'}//${socketUrl.host}`;
  useAppStore.setState({ repository: new Repository(new LanStorage(serverUrl, token)) });
  socketUrl.searchParams.set('token', token);
  return new WebSocketTransport(socketUrl.href, 'player');
}

const root = document.getElementById('root');
if (!root) {
  throw new Error('player.html is missing #root');
}
const params = new URLSearchParams(location.search);
const token = params.get('token');
const identify = params.get('identify');
const lan = token === null ? null : lanTransport(params, token);
// `?identify=` windows only label a monitor for the DM's monitor test.
createRoot(root).render(
  <StrictMode>
    {identify === null ? (
      <PlayerApp transport={lan ?? createLocalTransport('player')} lan={lan} />
    ) : (
      <IdentifyScreen number={identify} name={params.get('name') ?? ''} />
    )}
  </StrictMode>,
);
