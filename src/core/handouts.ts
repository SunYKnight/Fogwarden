/** What a handout file shows players; its extension decides. */
export type HandoutKind = 'image' | 'video' | 'text';

const KINDS: Record<string, HandoutKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
  avif: 'image',
  mp4: 'video',
  webm: 'video',
  md: 'text',
  txt: 'text',
};

/** Kind of a handout file by name; null for files players cannot be shown. */
export function handoutKind(fileName: string): HandoutKind | null {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? null : (KINDS[fileName.slice(dot + 1).toLowerCase()] ?? null);
}

/** Folder of a campaign's handouts in the data area. */
export function handoutsDir(campaignId: string): string {
  return `campaigns/${campaignId}/handouts`;
}
