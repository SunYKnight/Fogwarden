import { isTauri } from '@tauri-apps/api/core';
import { useState, type ReactNode } from 'react';
import { countOf } from '@/core/plural';
import { useAppStore } from '@/state/appStore';
import { useLanStore } from '@/state/lanStore';
import { useRelayStore } from '@/state/relayStore';
import { Button, Icon, type IconName } from '../kit';
import { closePlayerWindow, monitorLabel, openPlayerWindow, usePlayerWindowStore } from '../playerWindow';
import { LINK_TEXT, RelayButton } from '../server/OnlineSection';
import { LanButton, LanLinks } from './LanControls';

const DESKTOP_ONLY = 'Needs the desktop app';

/** Host and port of a server URL, for status text. */
function hostOf(url: string): string {
  return url.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
}

interface LineProps {
  icon: IconName;
  title: string;
  status: string;
  /** Buttons at the right end of the line. */
  actions: ReactNode;
}

function PlayersLine({ icon, title, status, actions }: LineProps) {
  return (
    <div className="players-line">
      <Icon name={icon} size={20} />
      <div className="players-line-text">
        <strong>{title}</strong>
        <span className="muted small">{status}</span>
      </div>
      <div className="row">{actions}</div>
    </div>
  );
}

/** Player window on a second screen: where it is open, with open and close. */
export function WindowLine() {
  const settings = useAppStore((s) => s.settings);
  const reportError = useAppStore((s) => s.reportError);
  const { open, monitor } = usePlayerWindowStore();
  const status = !isTauri()
    ? 'Opens in a new browser tab'
    : open
      ? `Open on ${monitor ? monitorLabel(monitor) : 'an unknown monitor'}`
      : 'Closed';
  return (
    <PlayersLine
      icon="monitor"
      title="Player window"
      status={status}
      actions={
        open ? (
          <Button icon="close" label="Close" onClick={() => closePlayerWindow().catch(reportError)} />
        ) : (
          <Button
            icon="external"
            label="Open"
            variant="primary"
            disabled={!settings}
            onClick={() => (settings ? openPlayerWindow(settings).catch(reportError) : undefined)}
          />
        )
      }
    />
  );
}

/** LAN server: address and players while it runs, start and stop, and its links on demand. */
export function LanLine({ linksOpen }: { linksOpen: boolean }) {
  const info = useLanStore((s) => s.info);
  const remoteDm = useLanStore((s) => (s.remoteDms > 0 ? ' · Remote DM connected' : ''));
  const [showLinks, setShowLinks] = useState(linksOpen);
  const desktop = isTauri();
  const address = info?.hosts[0];
  const status = !desktop
    ? DESKTOP_ONLY
    : !info
      ? 'Off'
      : `${address ? `Running at ${hostOf(address)}` : 'Running'} · ${countOf(info.players, 'player')}${remoteDm}`;
  return (
    <>
      <PlayersLine
        icon="wifi"
        title="LAN"
        status={status}
        actions={
          desktop && (
            <>
              {info && (
                <Button
                  icon="qr"
                  label="Links and QR codes"
                  iconOnly
                  variant="ghost"
                  active={showLinks}
                  onClick={() => setShowLinks(!showLinks)}
                />
              )}
              <LanButton variant="default" />
            </>
          )
        }
      />
      {info && showLinks && (
        <div className="players-line-detail">
          <LanLinks info={info} />
        </div>
      )}
    </>
  );
}

/** Relay connection: whether it is set up, its link state, players, and connect or disconnect. */
export function OnlineLine() {
  const remote = useAppStore((s) => s.settings?.remote ?? null);
  const link = useRelayStore((s) => s.link);
  const players = useRelayStore((s) => s.players);
  const lastError = useRelayStore((s) => s.lastError);
  const desktop = isTauri();
  const setUp = remote && remote.url.trim() !== '' ? remote : null;
  const status = !desktop
    ? DESKTOP_ONLY
    : !setUp
      ? 'Not set up'
      : link === 'online'
        ? `Connected to ${hostOf(setUp.url.trim())} · ${countOf(players, 'player')}`
        : link === 'off' && lastError
          ? `Error: ${lastError}`
          : LINK_TEXT[link];
  return (
    <PlayersLine
      icon="server"
      title="Online"
      status={status}
      actions={desktop && setUp && <RelayButton remote={setUp} variant="default" />}
    />
  );
}
