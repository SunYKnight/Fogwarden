import { describe, expect, it } from 'vitest';
import { defaultSettings, settingsSchema } from '@/core/model';
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
      playerWindow: { monitorName: 'DISPLAY2', fullscreen: false },
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
});
