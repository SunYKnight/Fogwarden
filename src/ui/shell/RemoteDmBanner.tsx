import { useRemoteDmStore } from '@/sync/dmMirror';
import { Button, Icon } from '../kit';

/** Tells a remote DM window which desktop app it controls and how the connection stands. */
export function RemoteDmBanner({ host }: { host: string }) {
  const { connected, synced, revoked } = useRemoteDmStore();
  const status = revoked
    ? 'The DM link was turned off or replaced; open the current one'
    : !connected
      ? 'Disconnected, reconnecting…'
      : synced
        ? 'Connected'
        : 'Waiting for the desktop app…';
  return (
    <div className={`remote-dm-banner${connected && synced ? '' : ' remote-dm-banner-off'}`} role="status">
      <Icon name="link" />
      <span className="grow">
        <strong>Remote DM</strong> — controlled desktop: {host} · {status}
      </span>
      {!revoked && (
        <Button
          icon="wifi"
          label="Reconnect"
          variant="ghost"
          onClick={() => useRemoteDmStore.setState((s) => ({ generation: s.generation + 1 }))}
        />
      )}
    </div>
  );
}
