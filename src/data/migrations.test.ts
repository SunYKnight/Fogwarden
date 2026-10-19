import { describe, expect, it } from 'vitest';
import {
  campaignFileSchema,
  createCampaign,
  createEncounter,
  defaultGraphicsSettings,
  defaultPackSettings,
  defaultPlayerLinks,
  defaultRemoteSettings,
  defaultSettings,
  encounterSchema,
  noPlayerFeatures,
  PARTY_VIEW,
  settingsSchema,
  SETTINGS_SCHEMA_VERSION,
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
    expect(migrated.packs).toEqual(defaultPackSettings());
    expect(migrated.diagonalRule).toBe('5-10-5');
  });

  it('drops the old tool import step from v9 settings and keeps the other steps', () => {
    const done = { dataFolder: true, legacyImport: true, mapFromImage: false, sampleEncounter: true };
    const v9 = { ...defaultSettings(), version: 9, onboarding: { dismissed: true, done } };
    const migrated = migrate('settings', v9);
    expect(migrated.onboarding).toEqual({
      dismissed: true,
      done: { dataFolder: true, mapFromImage: false, sampleEncounter: true },
    });
    expect(settingsSchema.parse(migrated).version).toBe(SETTINGS_SCHEMA_VERSION);
  });

  it('adds the default graphics quality to v10 settings and keeps the rest', () => {
    const { graphics: _unused, ...v10 } = { ...defaultSettings(), tokenStandees: false };
    const migrated = settingsSchema.parse(migrate('settings', { ...v10, version: 10 }));
    expect(migrated.graphics).toEqual(defaultGraphicsSettings());
    expect(migrated.tokenStandees).toBe(false);
  });

  it('shows every kind and hides name duplicates in v11 settings, keeping order and disabled packs', () => {
    const v11 = { ...defaultSettings(), version: 11, packs: { order: ['mm', 'srd'], disabled: ['srd'] } };
    const migrated = settingsSchema.parse(migrate('settings', v11));
    expect(migrated.packs).toEqual({ order: ['mm', 'srd'], disabled: ['srd'], hiddenKinds: {}, hideDuplicates: true });
  });

  it('adds the former fixed texture, shadow, antialias and frame rate values to v12 graphics settings', () => {
    const v12 = {
      ...defaultSettings(),
      version: 12,
      graphics: { shadowedLights: 0, resolutionScale: 0.5, propShadows: false },
    };
    const migrated = settingsSchema.parse(migrate('settings', v12));
    expect(migrated.graphics).toEqual({
      shadowedLights: 0,
      resolutionScale: 0.5,
      propShadows: false,
      textureSizePx: 4096,
      shadowMapSizePx: 512,
      antialias: true,
      maxFps: null,
    });
  });

  it('adds the DM link, turned off, to v13 settings and keeps the rest', () => {
    const { dmRemote: _unused, ...v13 } = { ...defaultSettings(), tokenStandees: false };
    const migrated = settingsSchema.parse(migrate('settings', { ...v13, version: 13 }));
    expect(migrated.dmRemote).toEqual({ enabled: false, rotation: 0 });
    expect(migrated.tokenStandees).toBe(false);
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
    const {
      playersMoveTokens: _moves,
      turnStart: _start,
      chat: _chat,
      ...v5
    } = {
      ...createEncounter('e', 'c1', null),
      version: 5,
    };
    const migrated = encounterSchema.parse(migrate('encounter', v5));
    expect(migrated.version).toBe(8);
    expect(migrated.playersMoveTokens).toBe(false);
    expect(migrated.turnStart).toBeNull();
  });

  it('starts a v7 encounter without chat lines', () => {
    const { chat: _chat, ...v7 } = { ...createEncounter('e', 'c1', null), version: 7 };
    expect(encounterSchema.parse(migrate('encounter', v7)).chat).toEqual([]);
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

  it('names the field a malformed v2 map lacks', () => {
    expect(() => migrate('map', { schema: 'map', version: 2 }, 3)).toThrow(/regions/);
  });

  it('adds default volumes to v7 settings', () => {
    const { audio: _unused, ...v7 } = defaultSettings();
    const migrated = settingsSchema.parse(migrate('settings', { ...v7, version: 7 }));
    expect(migrated.audio).toEqual(defaultSettings().audio);
  });
});

describe('update settings migration', () => {
  it('turns the automatic release check on for v8 settings', () => {
    const { updates: _unused, ...v8 } = defaultSettings();
    const migrated = settingsSchema.parse(migrate('settings', { ...v8, version: 8 }));
    expect(migrated.updates).toEqual({ autoCheck: true, lastCheck: null });
  });
});

describe('campaign migration', () => {
  it('gives v2 campaigns an empty party and no player features and keeps the rest', () => {
    const {
      notes: _notes,
      party: _party,
      playerFeatures: _features,
      ...v2
    } = {
      ...createCampaign('Saga'),
      id: 'saga',
      version: 2,
    };
    const migrated = campaignFileSchema.parse(migrate('campaign', v2));
    expect(migrated).toEqual({ ...v2, version: 4, party: [], playerFeatures: noPlayerFeatures() });
  });

  it('turns player features off for v3 campaigns', () => {
    const { notes: _notes, playerFeatures: _features, ...v3 } = { ...createCampaign('Saga'), version: 3 };
    const migrated = campaignFileSchema.parse(migrate('campaign', v3));
    expect(migrated.playerFeatures).toEqual({
      uploads: false,
      sheets: false,
      chat: false,
      sharedRolls: false,
      playerNotes: false,
      sheetEdits: 'off',
    });
  });

  it('refuses to read a campaign of the old file layout as a current one', () => {
    const { party: _party, ...v1 } = { ...createCampaign('Saga'), version: 1 };
    expect(() => migrate('campaign', v1)).toThrow(/version 1 uses the old file layout/);
  });
});
