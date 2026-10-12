import { describe, expect, it } from 'vitest';
import { matchPortraits, portraitKey } from './portraitMatch';

const SRD = [
  { id: 'srd-goblin', name: 'Goblin' },
  { id: 'srd-yuan-ti-pureblood', name: 'Yuan-ti Pureblood' },
  { id: 'srd-will-o-wisp', name: "Will-o'-Wisp" },
];

describe('portraitKey', () => {
  it('drops extensions, source prefixes, case, diacritics and punctuation', () => {
    expect(portraitKey('homebrew--goblin.jpg')).toBe('goblin');
    expect(portraitKey('Yuan_Ti  Pureblood.PNG')).toBe('yuan-ti-pureblood');
    expect(portraitKey('Écorché.webp')).toBe('ecorche');
    expect(portraitKey('monster-manual--adult-red-dragon')).toBe('adult-red-dragon');
  });
});

describe('matchPortraits', () => {
  it('matches by name across prefixes and spelling and ignores non-image files', () => {
    const result = matchPortraits(
      ['homebrew--goblin.jpg', 'yuan_ti_pureblood.png', 'WILL-O-WISP.jpeg', 'notes.txt'],
      SRD,
    );
    expect(result.matches).toEqual([
      { fileName: 'WILL-O-WISP.jpeg', creatureId: 'srd-will-o-wisp' },
      { fileName: 'homebrew--goblin.jpg', creatureId: 'srd-goblin' },
      { fileName: 'yuan_ti_pureblood.png', creatureId: 'srd-yuan-ti-pureblood' },
    ]);
    expect(result.unmatched).toEqual([]);
    expect(result.duplicates).toEqual([]);
  });

  it('keeps suffixed variants distinct from the base creature', () => {
    const creatures = [...SRD, { id: 'homebrew--goblin-boss-hotd', name: 'Goblin Boss (HotD)' }];
    const result = matchPortraits(['homebrew--goblin-hotd.jpg', 'homebrew--goblin-boss-hotd.jpg'], creatures);
    expect(result.matches).toEqual([
      { fileName: 'homebrew--goblin-boss-hotd.jpg', creatureId: 'homebrew--goblin-boss-hotd' },
    ]);
    expect(result.unmatched).toEqual(['homebrew--goblin-hotd.jpg']);
  });

  it('gives a file to every creature of the same name and one file per creature', () => {
    const creatures = [...SRD, { id: '01J0OWNGOBLIN', name: 'goblin' }];
    const result = matchPortraits(['goblin.png', 'Goblin.jpg'], creatures);
    expect(result.matches).toEqual([
      { fileName: 'Goblin.jpg', creatureId: 'srd-goblin' },
      { fileName: 'Goblin.jpg', creatureId: '01J0OWNGOBLIN' },
    ]);
    expect(result.duplicates).toEqual(['goblin.png']);
  });

  it('prefers a file named like the id over one named like the name', () => {
    const creatures = [{ id: 'homebrew--ambush-drake-hotd', name: 'Ambush Drake' }];
    const result = matchPortraits(['ambush-drake.jpg', 'homebrew--ambush-drake-hotd.jpg'], creatures);
    expect(result.matches).toEqual([
      { fileName: 'homebrew--ambush-drake-hotd.jpg', creatureId: 'homebrew--ambush-drake-hotd' },
    ]);
    expect(result.duplicates).toEqual(['ambush-drake.jpg']);
  });

  it('gives a family picture to every form unless a form has its own', () => {
    const creatures = [
      { id: 'srd-werewolf-human', name: 'Werewolf, Human Form' },
      { id: 'srd-werewolf-wolf', name: 'Werewolf, Wolf Form' },
      { id: 'srd-succubus-incubus', name: 'Succubus/Incubus' },
    ];
    const result = matchPortraits(['werewolf.jpg', 'werewolf-wolf-form.jpg', 'incubus.png'], creatures);
    expect(result.matches).toEqual([
      { fileName: 'incubus.png', creatureId: 'srd-succubus-incubus' },
      { fileName: 'werewolf-wolf-form.jpg', creatureId: 'srd-werewolf-wolf' },
      { fileName: 'werewolf.jpg', creatureId: 'srd-werewolf-human' },
    ]);
  });
});
