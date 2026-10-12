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
