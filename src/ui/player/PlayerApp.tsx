import { useEffect } from 'react';
import { SCENE_LAYERS } from '@/render/layers';
import { MapView } from '@/render/MapView';
import type { SyncTransport } from '@/sync/protocol';
import { usePlayerStore } from './playerStore';

/** Player view: renders only what the DM sends over `transport`. */
export function PlayerApp({ transport }: { transport: SyncTransport }) {
  const map = usePlayerStore((s) => s.map);
  const terrain = usePlayerStore((s) => s.terrain);
  const mapRevision = usePlayerStore((s) => s.mapRevision);
  const camera = usePlayerStore((s) => s.camera);

  useEffect(() => {
    const stop = transport.subscribe((payload) => usePlayerStore.getState().receive(payload));
    transport.send({ type: 'hello' });
    return stop;
  }, [transport]);

  return map && terrain ? (
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
  ) : (
    <div className="waiting">Waiting for the DM to show a map…</div>
  );
}
