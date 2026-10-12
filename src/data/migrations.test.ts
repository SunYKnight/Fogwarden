import { describe, expect, it } from 'vitest';
import {
  createEncounter,
  defaultPlayerLinks,
  defaultRemoteSettings,
  defaultSettings,
  encounterSchema,
  PARTY_VIEW,
  settingsSchema,
} from '@/core/model';
import { createPc } from '@/state/encounterActions';
import { migrate, MigrationError } from './migrations';
import { MemoryStorage } from './memoryStorage';
import { Repository } from './repository';

const V1_SETTINGS = {
  schema: 'settings',
  version: 1,
  playerWindow: { monitorName: 'DISPLAY2', fullscreen: false },
  diagonalRule: '5-10-5',
  lan: { port: 8000 },
  lastCampaignId: 'c1',
};

describe('settings migration', () => {
  it('upgrades v1 settings to the current schema with first steps not done', () => {
    const migrated = settingsSchema.parse(migrate('settings', V1_SETTINGS));
    expect(migrated).toEqual({
      ...defaultSettings(),
      playerWindow: { monitorName: 'DISPLAY2', fullscreen: false, view: PARTY_VIEW },
      diagonalRule: '5-10-5',
      lan: { port: 8000 },
    });
    expect('lastCampaignId' in migrated).toBe(false);
  });

  it('keeps the last encounter of v2 settings and adds the first steps progress', () => {
    const lastEncounter = { campaignId: 'c1', encounterId: 'e1' };
    const { onboarding: _unused, ...v3 } = defaultSettings();
    const migrated = settingsSchema.parse(migrate('settings', { ...v3, version: 2, lastEncounter }));
    expect(migrated.lastEncounter).toEqual(lastEncounter);
    expect(migrated.onboarding).toEqual(defaultSettings().onboarding);
    expect(migrated.onboarding.dismissed).toBe(false);
  });

  it('leaves current settings untouched', () => {
    const current = { ...defaultSettings(), onboarding: { ...defaultSettings().onboarding, dismissed: true } };
    expect(migrate('settings', current)).toEqual(current);
  });

  it('rejects settings from a newer app version', () => {
    expect(() => migrate('settings', { ...defaultSettings(), version: 99 })).toThrow(MigrationError);
  });

  it('loads stored v2 settings through the repository', async () => {
    const storage = new MemoryStorage();
    const { onboarding: _unused, ...v3 } = defaultSettings();
    storage.files.data.set('settings.json', JSON.stringify({ ...v3, version: 2 }));
    const loaded = await new Repository(storage).loadSettings();
    expect(loaded).toEqual(defaultSettings());
  });

  it('adds empty relay settings to v4 settings and keeps the rest', () => {
    const { remote: _unused, ...v4 } = { ...defaultSettings(), tokenStandees: false, lan: { port: 9000 } };
    const migrated = settingsSchema.parse(migrate('settings', { ...v4, version: 4 }));
    expect(migrated.remote).toEqual(defaultRemoteSettings());
    expect(migrated.remote.url).toBe('');
    expect(migrated.tokenStandees).toBe(false);
    expect(migrated.lan.port).toBe(9000);
  });

  it('adds the party view and unset player links to v5 settings', () => {
    const { playerLinks: _unused, ...v5 } = defaultSettings();
    const playerWindow = { monitorName: 'DISPLAY2', fullscreen: false };
    const migrated = settingsSchema.parse(migrate('settings', { ...v5, version: 5, playerWindow }));
    expect(migrated.playerWindow).toEqual({ ...playerWindow, view: PARTY_VIEW });
    expect(migrated.playerLinks).toEqual(defaultPlayerLinks());
  });

  it('enables every content pack in v6 settings and keeps the rest', () => {
    const { packs: _unused, ...v6 } = { ...defaultSettings(), diagonalRule: '5-10-5' as const };
    const migrated = settingsSchema.parse(migrate('settings', { ...v6, version: 6 }));
    expect(migrated.packs).toEqual({ order: [], disabled: [] });
    expect(migrated.diagonalRule).toBe('5-10-5');
  });
});

describe('encounter migration', () => {
  const pc = (name: string, visionSource: boolean) =>
    createPc({ name, armorClass: 10, maxHp: 10, senses: {}, visionSource });

  function v1Encounter(explored: string) {
    const encounter = createEncounter('e', 'c1', null);
    const { exploredBy: _unused, ...fog } = encounter.fog;
    const thorin = pc('Thorin', true);
    const blind = pc('Elara', false);
    const owl = { ...pc('Owl', true), side: 'ally' as const };
    const goblin = { ...pc('Goblin', false), side: 'enemy' as const };
    const doc = { ...encounter, version: 1, combatants: [thorin, blind, owl, goblin], fog: { ...fog, explored } };
    return { doc, thorin, blind, owl };
  }

  it('gives every player character and vision source the shared explored cells of a v1 encounter', () => {
    const { doc, thorin, blind, owl } = v1Encounter('/w==');
    const migrated = encounterSchema.parse(migrate('encounter', doc, 2));
    expect(migrated.version).toBe(2);
    expect(migrated.fog.exploredBy).toEqual({ [thorin.id]: '/w==', [blind.id]: '/w==', [owl.id]: '/w==' });
    expect('explored' in migrated.fog).toBe(false);
  });

  it('starts with nobody having explored anything when the v1 encounter had no explored cells', () => {
    const migrated = encounterSchema.parse(migrate('encounter', v1Encounter('').doc, 2));
    expect(migrated.fog.exploredBy).toEqual({});
  });

  it('refuses to read an encounter of the old file layout as a current one', () => {
    expect(() => migrate('encounter', v1Encounter('').doc)).toThrow(/version 2 uses the old file layout/);
  });

  it('keeps players from moving their own tokens in a v5 encounter', () => {
    const { playersMoveTokens: _unused, ...v5 } = { ...createEncounter('e', 'c1', null), version: 5 };
    const migrated = encounterSchema.parse(migrate('encounter', v5));
    expect(migrated.version).toBe(6);
    expect(migrated.playersMoveTokens).toBe(false);
  });

  it('gives combatants of a v4 encounter no level, effects, death saves, spent resources or light', () => {
    const {
      level: _l,
      effects: _e,
      concentrating: _c,
      deathSaves: _d,
      resources: _r,
      light: _li,
      ...thorin
    } = {
      ...pc('Thorin', true),
      hp: { current: 3, max: 10, temp: 0 },
    };
    const { playersMoveTokens: _p, ...encounter } = createEncounter('e', 'c1', null);
    const migrated = encounterSchema.parse(migrate('encounter', { ...encounter, version: 4, combatants: [thorin] }));
    expect(migrated.combatants).toEqual([
      {
        ...thorin,
        level: null,
        effects: [],
        concentrating: false,
        deathSaves: { successes: 0, failures: 0 },
        resources: { legendaryUsed: 0, recharging: [], slotsUsed: {}, dailyUsed: {} },
        light: null,
      },
    ]);
  });
});

describe('atmosphere migrations', () => {
  it('gives v3 encounters a silent scene with the combat mood for combat', () => {
    const { atmosphere: _unused, ...v3 } = { ...createEncounter('Ambush', 'c1', null), version: 3 };
    const migrated = migrate('encounter', v3, 4);
    expect(migrated.atmosphere).toEqual({ mood: null, combatMood: 'combat', minute: null, weather: 'none' });
  });

  it('gives v2 map regions no ambient sound', () => {
    const region = { id: 'r1', name: 'Dark', kind: 'light', light: 'darkness' };
    const migrated = migrate('map', { schema: 'map', version: 2, regions: [region] }, 3);
    expect(migrated.regions).toEqual([{ ...region, sound: null }]);
  });

  it('adds default volumes to v7 settings', () => {
    const { audio: _unused, ...v7 } = defaultSettings();
    const migrated = settingsSchema.parse(migrate('settings', { ...v7, version: 7 }));
    expect(migrated.audio).toEqual(defaultSettings().audio);
  });
});
