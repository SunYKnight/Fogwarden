import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RemoteDmStorage } from '@/data/remoteDmStorage';
import { Repository } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import { useRemoteDmStore } from '@/sync/dmMirror';
import { DmApp } from '@/ui/DmApp';
import '@/ui/app.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('index.html is missing #root');
}
// The DM link (`/dm.html?token=`) makes this window the remote DM of the
// desktop app that serves it: its files and encounter are the desktop's.
const token = new URLSearchParams(window.location.search).get('token');
if (token) {
  useAppStore.setState({ repository: new Repository(new RemoteDmStorage(window.location.origin, token)) });
  useRemoteDmStore.setState({ host: window.location.host, token });
}
createRoot(root).render(
  <StrictMode>
    <DmApp />
  </StrictMode>,
);
