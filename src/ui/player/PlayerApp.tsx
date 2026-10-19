import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SCENE_LAYERS } from '@/render/layers';
import type { MapPointerEvent } from '@/render/mapRenderContext';
import { MapView } from '@/render/MapView';
import { SIDE_COLORS } from '@/render/tokens/tokenMaterials';
import { useAppStore } from '@/state/appStore';
import type { PlayerEncounter, SyncPayload, SyncTransport } from '@/sync/protocol';
import type { WebSocketTransport } from '@/sync/wsTransport';
import { InterludeVideo } from './InterludeVideo';
import { PlayerDragOverlay } from './PlayerDragOverlay';
import { HandoutOverlay, TurnBanner } from './PlayerOverlays';
import { PictureUpload, type UploadTarget } from './PictureUpload';
import { cancelHold, playerPointer, pointerMoved } from './playerPointer';
import { PlayerChat, PlayerNotice } from './PlayerChat';
import { PlayerSheetPanel } from './PlayerSheet';
import { PlayerSound } from './PlayerSound';
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
 * connect over the LAN or the relay, so the view can tell a lost connection from a DM who shows nothing;
 * `uploadTo` is that server, where a character's link may send pictures while the DM allows it.
 */
export function PlayerApp(props: {
  transport: SyncTransport;
  lan: WebSocketTransport | null;
  uploadTo: UploadTarget | null;
}) {
  const { transport, lan, uploadTo } = props;
  const map = usePlayerStore((s) => s.map);
  const terrain = usePlayerStore((s) => s.terrain);
  const mapRevision = usePlayerStore((s) => s.mapRevision);
  const camera = usePlayerStore((s) => s.camera);
  const encounter = usePlayerStore((s) => s.encounter);
  const viewName = usePlayerStore((s) => s.viewName);
  const minute = usePlayerStore((s) => s.scene?.minute ?? null);
  const [link, setLink] = useState<Link>(lan ? 'connecting' : 'open');
  const press = useRef({ x: 0, y: 0 });
  const send = useCallback((payload: SyncPayload) => transport.send(payload), [transport]);
  const onPointer = useCallback((event: MapPointerEvent) => playerPointer(event, press.current, send), [send]);

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
          usePlayerStore.setState({ audio: null, scene: null, interlude: null, viewCombatantId: null });
          usePlayerStore.setState({ rolls: [], handout: null });
        }
        setLink((prev) => (open ? 'open' : revoked ? 'revoked' : prev === 'open' ? 'reconnecting' : prev));
      }),
    [lan],
  );

  // The window on the DM's second screen is fullscreen without a title bar;
  // browser players close their own tab.
  const local = lan === null && isTauri();
  useEffect(() => {
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        getCurrentWindow().close().catch(useAppStore.getState().reportError);
      }
    };
    if (local) window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [local]);

  const linkStatus: Record<Link, string | null> = {
    connecting: 'Connecting to the DM…',
    reconnecting: 'Connection lost, reconnecting…',
    revoked: 'This link no longer works; ask the DM for the new one',
    open: map ? null : 'Waiting for the DM to show a map',
  };
  const hint = map && link === 'open' ? 'Hold the map to point at a spot' : null;
  const closeHint = local ? 'Esc closes this window' : null;
  const corner = [viewName, linkStatus[link], hint, closeHint].filter((part) => part !== null).join(' · ');
  const ribbon = encounter && encounter.showTurnOrder && encounter.round > 0 && encounter.combatants.length > 0;

  return (
    <div
      className="player-app"
      onPointerDownCapture={(e) => {
        // A second finger means a pinch, not a ping.
        if (!e.isPrimary) cancelHold();
        press.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => pointerMoved(e.clientX, e.clientY)}
      onPointerCancel={cancelHold}
    >
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
          minute={minute}
          onPointer={onPointer}
        >
          {SCENE_LAYERS.map(({ id, Component }) => (
            <Component key={id} />
          ))}
          <PlayerDragOverlay />
        </MapView>
      )}
      {ribbon && <InitiativeRibbon encounter={encounter} />}
      {encounter && <TurnBanner encounter={encounter} />}
      {encounter?.sheet && <PlayerSheetPanel sheet={encounter.sheet} flags={encounter} send={send} />}
      <div className="player-bottom">
        <div className="player-tools">
          {encounter && (encounter.chat || encounter.sharedRolls) && (
            <PlayerChat canWrite={encounter.chat === true} send={send} />
          )}
          {encounter?.uploads && uploadTo && <PictureUpload target={uploadTo} />}
          <PlayerSound />
        </div>
        {corner && (
          <div className={link === 'open' ? 'player-status' : 'player-status problem'} role="status">
            {corner}
          </div>
        )}
      </div>
      <PlayerNotice />
      <HandoutOverlay />
      <InterludeVideo />
    </div>
  );
}
