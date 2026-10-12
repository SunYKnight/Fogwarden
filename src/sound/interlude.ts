import { create } from 'zustand';
import { isVideoAsset } from '@/core/atmosphere/media';
import type { AssetRef } from '@/core/model';

interface InterludeState {
  /** Video the players watch fullscreen, with the DM clock time it started; null shows the map. */
  interlude: { asset: AssetRef; startedAtMs: number } | null;
}

export const useInterludeStore = create<InterludeState>(() => ({ interlude: null }));

/** Shows `asset` (MP4/WebM) fullscreen in every player view from its start. */
export function startInterlude(asset: AssetRef): void {
  if (!isVideoAsset(asset)) {
    throw new Error(`An interlude needs an MP4 or WebM video, not ${asset.path}`);
  }
  useInterludeStore.setState({ interlude: { asset, startedAtMs: Date.now() } });
}

export function stopInterlude(): void {
  useInterludeStore.setState({ interlude: null });
}
