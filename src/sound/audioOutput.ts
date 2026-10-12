import { crossfadeGains } from '@/core/atmosphere/playlist';
import type { AssetRef } from '@/core/model';

const CROSSFADE_MS = 2500;
const FADE_TICK_MS = 50;
// Players drift a little behind; seeking for less would stutter audibly.
const MAX_DRIFT_SEC = 2;

export interface AudioOutputEvents {
  resolve(ref: AssetRef): Promise<string>;
  /** The browser refused to start sound until the user interacts with the page. */
  onBlocked(): void;
  onError(error: unknown): void;
  /** The current music track played to its end. */
  onTrackEnded?(): void;
}

/** Ambient loop at a volume 0..1 before the master volume. */
export interface AmbientLoop {
  id: string;
  asset: AssetRef;
  gain: number;
}

interface Voice {
  key: string;
  audio: HTMLAudioElement;
  /** Volume 0..1 before the master volume. */
  gain: number;
}

const refKey = (ref: AssetRef) => `${ref.area}:${ref.path}`;

/**
 * Sound of one window: music with crossfades, one-shot effects and ambient loops, all scaled by one volume.
 * Media elements rather than Web Audio: they stream long tracks instead of decoding them whole, and need no
 * CORS for the Tauri asset protocol.
 */
export class AudioOutput {
  private volume = 1;
  private music: Voice | null = null;
  private wantMusic: { key: string; playing: boolean } | null = null;
  private fading: { from: Voice | null; to: Voice; startMs: number } | null = null;
  private fadeTimer: number | undefined;
  private readonly loops = new Map<string, Voice>();
  /** Track whose URL is being resolved; repeated requests for it wait for that. */
  private resolving: string | null = null;
  private disposed = false;

  constructor(private readonly events: AudioOutputEvents) {}

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyVolumes();
  }

  /** Plays `asset` from `positionSec`; another track crossfades, the same one only corrects drift and pauses. */
  setMusic(asset: AssetRef | null, positionSec: number, playing: boolean): void {
    const key = asset ? refKey(asset) : null;
    this.wantMusic = key === null ? null : { key, playing };
    if (this.music && key === this.music.key) {
      const audio = this.music.audio;
      if (Math.abs(audio.currentTime - positionSec) > MAX_DRIFT_SEC && audio.readyState > 0) {
        audio.currentTime = positionSec;
      }
      this.run(audio, playing);
    } else if (asset && key && key !== this.resolving) {
      this.resolving = key;
      this.events
        .resolve(asset)
        .then((url) => {
          if (!this.disposed && this.wantMusic?.key === key) {
            this.crossfadeTo(this.voice(key, url, positionSec), this.wantMusic.playing);
          }
        })
        .catch((error: unknown) => this.events.onError(error))
        .finally(() => {
          if (this.resolving === key) this.resolving = null;
        });
    } else if (!asset) {
      this.crossfadeTo(null, false);
    }
  }

  /** One-shot effect at `gain` 0..1 of the volume. */
  playEffect(asset: AssetRef, gain: number): void {
    this.events
      .resolve(asset)
      .then((url) => {
        const audio = new Audio(url);
        audio.volume = Math.min(1, gain * this.volume);
        this.run(audio, !this.disposed);
      })
      .catch((error: unknown) => this.events.onError(error));
  }

  /** Keeps one loop per entry at its gain; loops missing from `loops` stop. */
  setAmbient(loops: readonly AmbientLoop[]): void {
    const wanted = new Map(loops.map((loop) => [refKey(loop.asset) + '|' + loop.id, loop]));
    for (const [id, voice] of this.loops) {
      if (!wanted.has(id)) {
        voice.audio.pause();
        this.loops.delete(id);
      }
    }
    for (const [id, loop] of wanted) {
      const playing = this.loops.get(id);
      if (playing) {
        playing.gain = loop.gain;
        playing.audio.volume = Math.min(1, loop.gain * this.volume);
      } else {
        this.startLoop(id, loop);
      }
    }
  }

  /** Retries what should be playing; call from a user gesture after `onBlocked`. */
  unlock(): void {
    if (this.music) this.run(this.music.audio, this.wantMusic?.playing ?? false);
    for (const voice of this.loops.values()) {
      this.run(voice.audio, true);
    }
  }

  dispose(): void {
    this.disposed = true;
    clearInterval(this.fadeTimer);
    for (const voice of [this.music, this.fading?.from, ...this.loops.values()]) {
      voice?.audio.pause();
    }
    this.loops.clear();
  }

  private startLoop(id: string, loop: AmbientLoop): void {
    const voice: Voice = { key: id, audio: new Audio(), gain: loop.gain };
    voice.audio.loop = true;
    voice.audio.volume = Math.min(1, loop.gain * this.volume);
    this.loops.set(id, voice);
    this.events
      .resolve(loop.asset)
      .then((url) => {
        if (this.loops.get(id) === voice) {
          voice.audio.src = url;
          this.run(voice.audio, true);
        }
      })
      .catch((error: unknown) => this.events.onError(error));
  }

  private voice(key: string, url: string, positionSec: number): Voice {
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.volume = 0;
    audio.addEventListener('loadedmetadata', () => (audio.currentTime = Math.min(positionSec, audio.duration)), {
      once: true,
    });
    audio.addEventListener('ended', () => {
      if (this.music?.audio === audio) this.events.onTrackEnded?.();
    });
    return { key, audio, gain: 1 };
  }

  private crossfadeTo(next: Voice | null, playing: boolean): void {
    this.fading?.from?.audio.pause();
    const from = this.music;
    this.music = next;
    if (next) {
      this.fading = { from, to: next, startMs: performance.now() };
      this.run(next.audio, playing);
      clearInterval(this.fadeTimer);
      this.fadeTimer = window.setInterval(() => this.fadeStep(), FADE_TICK_MS);
    } else {
      this.fading = null;
      from?.audio.pause();
    }
  }

  private fadeStep(): void {
    const fading = this.fading;
    const t = fading ? (performance.now() - fading.startMs) / CROSSFADE_MS : 1;
    if (fading) {
      const gains = crossfadeGains(t);
      fading.to.gain = gains.in;
      if (fading.from) fading.from.gain = gains.out;
      this.applyVolumes();
    }
    if (t >= 1) {
      fading?.from?.audio.pause();
      this.fading = null;
      clearInterval(this.fadeTimer);
    }
  }

  private applyVolumes(): void {
    for (const voice of [this.music, this.fading?.from, ...this.loops.values()]) {
      if (voice) voice.audio.volume = Math.min(1, voice.gain * this.volume);
    }
  }

  private run(audio: HTMLAudioElement, playing: boolean): void {
    if (!playing) {
      audio.pause();
    } else if (audio.paused) {
      audio.play().catch((error: unknown) => {
        const name = error instanceof DOMException ? error.name : '';
        // AbortError: a pause or a new source interrupted the start on purpose.
        if (name === 'NotAllowedError') {
          this.events.onBlocked();
        } else if (name !== 'AbortError') {
          this.events.onError(error);
        }
      });
    }
  }
}
