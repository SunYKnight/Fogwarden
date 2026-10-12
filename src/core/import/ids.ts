/** Lower-case ASCII words joined by '-': diacritics dropped, any other character run becomes one '-'. */
export function slug(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Readable, file-name safe document id from source and name parts ("Monster Manual", "Adult Red Dragon" →
 * "monster-manual--adult-red-dragon"). Imports derive ids this way so re-importing overwrites instead of duplicating.
 */
export function slugId(...parts: string[]): string {
  const slugs = parts.map(slug);
  if (slugs.some((s) => s === '')) {
    throw new Error(`Cannot derive an id from ${JSON.stringify(parts)}`);
  }
  return slugs.join('--');
}

/** Keeps ids short enough for nested paths under Windows' 260 character limit. */
const MAX_ID_LENGTH = 60;
/** Device names Windows refuses as file names, even with an extension. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

/**
 * Id for a new document named `name` ("Goblin copy" → "goblin-copy"): its slug cut to 60 characters, `fallback`
 * when the name has no letters or digits, then `-2`, `-3` … while the id is in `taken` (lower-case ids already in
 * the document's folder) or a Windows device name.
 */
export function freeDocumentId(name: string, fallback: string, taken: ReadonlySet<string>): string {
  const base = slug(name).slice(0, MAX_ID_LENGTH).replace(/-+$/, '') || fallback;
  let id = base;
  for (let n = 2; taken.has(id) || WINDOWS_RESERVED.test(id); n++) {
    const suffix = `-${n}`;
    id = `${base.slice(0, MAX_ID_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`;
  }
  return id;
}
