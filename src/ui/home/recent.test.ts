import { describe, expect, it } from 'vitest';
import { createCampaign, createEncounter, createMap } from '@/core/model';
import { recentItems } from './recent';

describe('recentItems', () => {
  it('mixes maps and encounters newest first and keeps the limit', () => {
    const at = (day: number) => `2026-10-0${day}T00:00:00.000Z`;
    const map = (name: string, day: number) => ({
      ref: { area: 'data' as const, id: name },
      doc: { ...createMap({ name, image: null, squaresX: 1, squaresY: 1, pxPerSquare: 70 }), updatedAt: at(day) },
    });
    const campaign = createCampaign('Campaign');
    const encounter = (name: string, day: number) => ({
      campaign,
      encounter: { ...createEncounter(name, campaign.id, null), updatedAt: at(day) },
    });
    const items = recentItems([map('Old map', 1), map('New map', 5)], [encounter('Fight', 3)], 2);
    expect(items.map((i) => (i.kind === 'map' ? i.map.name : i.encounter.name))).toEqual(['New map', 'Fight']);
  });
});
