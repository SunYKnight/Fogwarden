import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/state/appStore';
import { usePlayerStore } from './playerStore';
import { usePlayerVolume, useSoundBlocked } from './PlayerSound';

/**
 * The DM's interlude: a fullscreen video over the map from where it stands now, with sound at the master
 * times the player's volume. A browser that blocks sound gets it muted until "Tap to enable sound".
 */
export function InterludeVideo() {
  const interlude = usePlayerStore((s) => s.interlude);
  const masterVolume = usePlayerStore((s) => s.audio?.value.volume ?? 1);
  const volume = usePlayerVolume((s) => s.volume);
  const blocked = useSoundBlocked((s) => s.blocked);
  const video = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<{ key: number; url: string } | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const asset = interlude?.value.asset ?? null;
  const key = interlude?.atMs ?? 0;

  useEffect(() => {
    let cancelled = false;
    if (asset) {
      useAppStore
        .getState()
        .repository.storage.assetUrl(asset)
        .then((resolved) => !cancelled && setUrl({ key, url: resolved }))
        .catch((error: unknown) => useAppStore.getState().reportError(error));
    }
    return () => {
      cancelled = true;
    };
  }, [asset, key]);

  useEffect(() => {
    if (video.current) video.current.volume = Math.min(1, masterVolume * volume);
  }, [masterVolume, volume, url]);

  useEffect(() => {
    const element = video.current;
    if (element && !blocked && element.muted) {
      element.muted = false;
      element.play().catch((error: unknown) => useAppStore.getState().reportError(error));
    }
  }, [blocked]);

  const showing = interlude && url?.key === key && endedAt !== key;
  return showing ? (
    <div className="interlude">
      <video
        ref={video}
        src={url.url}
        playsInline
        onLoadedMetadata={(e) => {
          const element = e.currentTarget;
          const position = interlude.value.positionSec + (Date.now() - interlude.atMs) / 1000;
          element.currentTime = position;
          if (position >= element.duration) {
            setEndedAt(key);
          } else {
            element
              .play()
              .catch((error: unknown) => {
                const name = error instanceof DOMException ? error.name : '';
                if (name !== 'NotAllowedError') throw error;
                // Muted video may autoplay; the sound follows the player's tap.
                element.muted = true;
                useSoundBlocked.setState({ blocked: true });
                return element.play();
              })
              .catch((error: unknown) => useAppStore.getState().reportError(error));
          }
        }}
        onEnded={() => setEndedAt(key)}
      />
    </div>
  ) : null;
}
