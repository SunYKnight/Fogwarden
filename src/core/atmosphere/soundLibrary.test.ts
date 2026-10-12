import { describe, expect, it } from 'vitest';
import { DEFAULT_MOODS, emptySoundLibrary, mergeSoundLibraries } from './soundLibrary';

describe('sound library', () => {
  it('offers the default moods without any file', () => {
    const merged = mergeSoundLibraries([]);
    expect(merged.moods.map((m) => m.id)).toEqual(DEFAULT_MOODS.map((m) => m.id));
    expect(merged.effects).toEqual([]);
  });

  it('joins the tracks of moods with the same id and keeps the first effect of an id', () => {
    const mine = {
      ...emptySoundLibrary(),
      moods: [
        { id: 'tavern', name: 'Inn', tracks: ['lute.ogg'] },
        { id: 'forest', name: 'Forest', tracks: ['birds.mp3'] },
      ],
      effects: [{ id: 'door', name: 'Door', file: 'door.wav', volume: 1 }],
    };
    const pack = {
      ...emptySoundLibrary(),
      moods: [{ id: 'tavern', name: 'Tavern', tracks: ['fiddle.ogg'] }],
      effects: [{ id: 'door', name: 'Creaky door', file: 'creak.ogg', volume: 0.5 }],
    };
    const merged = mergeSoundLibraries([
      { area: 'data', dir: 'library/sounds', file: mine, locked: false },
      { area: 'content', dir: 'packs/srd/sounds', file: pack, locked: true },
    ]);
    const tavern = merged.moods.find((m) => m.id === 'tavern')!;
    expect(tavern.name).toBe('Inn');
    expect(tavern.tracks).toEqual([
      { name: 'lute.ogg', asset: { area: 'data', path: 'library/sounds/lute.ogg' }, locked: false },
      { name: 'fiddle.ogg', asset: { area: 'content', path: 'packs/srd/sounds/fiddle.ogg' }, locked: true },
    ]);
    expect(merged.moods.map((m) => m.id)).toEqual(['tavern', 'forest', 'exploration', 'combat', 'boss']);
    expect(merged.effects).toEqual([
      { id: 'door', name: 'Door', volume: 1, asset: { area: 'data', path: 'library/sounds/door.wav' }, locked: false },
    ]);
  });
});
