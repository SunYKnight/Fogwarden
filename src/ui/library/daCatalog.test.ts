import { describe, expect, it } from 'vitest';
import { shippedStandIns } from './daCatalog';

describe('shipped stand-ins', () => {
  it('finds the Kenney model of a slot', () => {
    expect(shippedStandIns('conifer').map((m) => m.path.slice(m.path.lastIndexOf('/') + 1))).toEqual(['tree-pine.glb']);
  });

  it('has none for a slot without a Kenney model', () => {
    expect(shippedStandIns('candle')).toEqual([]);
  });
});
