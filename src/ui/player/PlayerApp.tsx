import { useEffect, useState } from 'react';
import { SCENE_LAYERS } from '@/render/layers';
import { MapView } from '@/render/MapView';
import { SIDE_COLORS } from '@/render/tokens/tokenMaterials';
import type { PlayerEncounter, SyncTransport } from '@/sync/protocol';
import type { WebSocketTransport } from '@/sync/wsTransport';
import { usePlayerStore } from './playerStore';

type Link = 'connecting' | 'open' | 'reconnecting' | 'revoked';

/** Turn order as big readable names; the current turn is highlighted. */
function InitiativeRibbon({ encounter }: { encounter: PlayerEncounter }) {
  return (
    <ol className="initiative-ribbon" aria-label={`Turn order, round ${encounter.round}`}>
      <li className="ribbon-round">Round {encounter.round}</li>
      {encounter.combatants.map((c) => (
        <li
          key={c.id}
          className={c.id === encounter.activeCombatantId ? 'ribbon-entry active' : 'ribbon-entry'}
          aria-current={c.id === encounter.activeCombatantId ? 'step' : undefined}
        >
          <span className="side-dot" style={{ background: SIDE_COLORS[c.side] }} />
          {c.name}
        </li>
      ))}
    </ol>
  );
}

/**
 * Player view: renders only what the DM sends over `transport`. `lan` is the same transport when players
 * connect over the LAN, so the view can tell a lost connection from a DM who shows nothing.
 */
export function PlayerApp({ transport, lan }: { transport: SyncTransport; lan: WebSocketTransport | null }) {
  const map = usePlayerStore((s) => s.map);
  const terrain = usePlayerStore((s) => s.terrain);
  const mapRevision = usePlayerStore((s) => s.mapRevision);
  const camera = usePlayerStore((s) => s.camera);
  const encounter = usePlayerStore((s) => s.encounter);
  const viewName = usePlayerStore((s) => s.viewName);
  const [link, setLink] = useState<Link>(lan ? 'connecting' : 'open');

  useEffect(() => {
    const stop = transport.subscribe((payload) => usePlayerStore.getState().receive(payload));
    transport.send({ type: 'hello' });
    return stop;
  }, [transport]);

  useEffect(
    () =>
      lan?.watchConnection((open) => {
        const revoked = !open && lan.revoked;
        if (revoked) {
          // A withdrawn link must not keep showing what it showed.
          usePlayerStore.setState({ map: null, terrain: null, encounter: null, fog: null, viewName: null });
        }
        setLink((prev) => (open ? 'open' : revoked ? 'revoked' : prev === 'open' ? 'reconnecting' : prev));
      }),
    [lan],
  );

  const linkStatus: Record<Link, string | null> = {
    connecting: 'Connecting to the DM…',
    reconnecting: 'Connection lost, reconnecting…',
    revoked: 'This link no longer works; ask the DM for the new one',
    open: map ? null : 'Waiting for the DM to show a map',
  };
  const corner = [viewName, linkStatus[link]].filter((part) => part !== null).join(' · ');
  const ribbon = encounter && encounter.showTurnOrder && encounter.round > 0 && encounter.combatants.length > 0;

  return (
    <div className="player-app">
      {map && terrain && (
        <MapView
          map={map}
          terrain={terrain}
          terrainVersion={mapRevision}
          mode="player"
          fogMode="player"
          camera={camera?.mode ?? 'top'}
          ambient={map.ambientLight}
          followCamera={camera}
        >
          {SCENE_LAYERS.map(({ id, Component }) => (
            <Component key={id} />
          ))}
        </MapView>
      )}
      {ribbon && <InitiativeRibbon encounter={encounter} />}
      {corner && (
        <div className="player-status" role="status">
          {corner}
        </div>
      )}
    </div>
  );
}
