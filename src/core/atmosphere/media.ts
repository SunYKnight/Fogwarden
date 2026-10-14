import type { AssetRef } from '../model';

/** Audio files the app plays: music, sound board effects and ambient loops. */
export const AUDIO_EXTENSIONS = ['mp3', 'ogg', 'wav', 'm4a'] as const;
/** Videos the app plays: animated battlemaps and interludes. */
export const VIDEO_EXTENSIONS = ['mp4', 'webm'] as const;

/** `accept` attribute of file inputs for audio files. */
export const AUDIO_ACCEPT = AUDIO_EXTENSIONS.map((e) => `.${e}`).join(',');
/** `accept` attribute of file inputs for videos. */
export const VIDEO_ACCEPT = VIDEO_EXTENSIONS.map((e) => `.${e}`).join(',');

function splitName(path: string): { name: string; dot: number } {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return { name, dot: name.lastIndexOf('.') };
}

export function isVideoFile(path: string): boolean {
  const { name, dot } = splitName(path);
  const extension = dot < 1 ? '' : name.slice(dot + 1).toLowerCase();
  return (VIDEO_EXTENSIONS as readonly string[]).includes(extension);
}

/** A battlemap or handout stored as a video rather than a picture. */
export function isVideoAsset(ref: AssetRef): boolean {
  return isVideoFile(ref.path);
}

/** File name without folder and extension, e.g. a track title. */
export function mediaTitle(path: string): string {
  const { name, dot } = splitName(path);
  return dot < 1 ? name : name.slice(0, dot);
}
