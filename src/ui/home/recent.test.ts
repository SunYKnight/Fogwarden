import { describe, expect, it } from 'vitest';
import { createCampaign, createEncounter, createMap } from '@/core/model';
import { homeCampaignId, recentMaps } from './recent';

const at = (day: number) => `2026-10-0${day}T00:00:00.000Z`;

describe('recentMaps', () => {
  it('sorts maps newest first and keeps the limit', () => {
    const map = (name: string, day: number) => ({
      ref: { area: 'data' as const, id: name },
      doc: { ...createMap({ name, image: null, squaresX: 1, squaresY: 1, pxPerSquare: 70 }), updatedAt: at(day) },
    });
    const maps = recentMaps([map('Old map', 1), map('New map', 5), map('Middle map', 3)], 2);
    expect(maps.map((m) => m.doc.name)).toEqual(['New map', 'Middle map']);
  });
});

describe('homeCampaignId', () => {
  const campaign = (id: string, day: number) => ({ ...createCampaign(id), id, updatedAt: at(day) });
  const quiet = campaign('quiet', 4);
  const busy = campaign('busy', 1);
  const fight = { ...createEncounter('Fight', 'busy', null), updatedAt: at(6) };
  const campaigns = [quiet, busy];

  it('prefers the pick, then the last played encounter, then the latest activity', () => {
    const last = { campaignId: 'quiet', encounterId: 'gone' };
    expect(homeCampaignId(campaigns, [fight], 'busy', last)).toBe('busy');
    expect(homeCampaignId(campaigns, [fight], null, last)).toBe('quiet');
    expect(homeCampaignId(campaigns, [fight], null, null)).toBe('busy');
    expect(homeCampaignId(campaigns, [], null, null)).toBe('quiet');
  });

  it('skips deleted campaigns and has none without campaigns', () => {
    expect(homeCampaignId(campaigns, [], 'deleted', { campaignId: 'deleted', encounterId: 'x' })).toBe('quiet');
    expect(homeCampaignId([], [], null, null)).toBeNull();
  });
});
