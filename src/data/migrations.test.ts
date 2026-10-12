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
});
