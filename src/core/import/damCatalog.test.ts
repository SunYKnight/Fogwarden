import { describe, expect, it } from 'vitest';
import { damStandIn, parseDamCatalog, suggestDamChoices, type DamStandInModel, type StandInSlot } from './damCatalog';
import { emptyDamObjectChoices } from './damObjects';
import type { DamProject } from './damProject';

const blocks = [
  { Id: 'tree', name: 'Evergreen Tree', keywords: ['conifer'], modelId: 'M#tree' },
  { Id: 'fern', name: 'Fern', keywords: ['plant', 'shrub'], modelId: 'M#fern', scale: 2 },
  { Id: 'fork', name: 'Fork', keywords: ['cutlery'], modelId: 'M#fork' },
];
const models = [
  { Id: 'M#tree', mapColliderCache: { stateIndependentBounds: { extents: { x: 1, y: 2, z: 0.5 } } } },
  { Id: 'M#fern', mapColliderCache: { stateIndependentBounds: { extents: { x: 0.3, y: 0.1, z: 0.3 } } } },
  { Id: 'M#fork', mapColliderCache: { stateIndependentBounds: null } },
];
const catalog = parseDamCatalog(JSON.stringify(blocks), JSON.stringify(models));

// The pine is limited by the tree's footprint, the bush by the fern's height.
const standIns: Partial<Record<StandInSlot, DamStandInModel[]>> = {
  conifer: [{ model: { area: 'content', path: 'pine.glb' }, size: { x: 0.5, y: 0.5, z: 0.5 } }],
  fern: [{ model: { area: 'content', path: 'bush.glb' }, size: { x: 0.4, y: 0.2, z: 0.4 } }],
};

function project(blockIds: string[]): DamProject {
  const objects = blockIds.map((blockId) => ({
    blockId,
    position: { x: 0, y: 0 },
    elevationFt: 0,
    rotationDeg: 0,
    scale: 1,
  }));
  return { objects } as unknown as DamProject;
}

describe('parseDamCatalog', () => {
  it('turns half extents in squares, times the kind scale, into feet', () => {
    expect(catalog.tree!.sizeFt).toEqual({ x: 10, y: 20, z: 5 });
    expect(catalog.fern!.sizeFt).toEqual({ x: 6, y: 2, z: 6 });
    expect(catalog.fork!.sizeFt).toBeNull();
  });
});

describe('damStandIn', () => {
  it('prefers a conifer over a generic tree, a fern over a bush, and leaves clutter out', () => {
    expect(damStandIn(catalog.tree!)).toBe('conifer');
    expect(damStandIn({ name: 'Oak Tree', keywords: [], sizeFt: null })).toBe('tree');
    expect(damStandIn(catalog.fern!)).toBe('fern');
    expect(damStandIn({ name: 'Asarum', keywords: ['plant', 'shrub', 'bush'], sizeFt: null })).toBe('bush');
    expect(damStandIn({ name: 'Storage Shelf', keywords: ['cupboard', 'cabinet'], sizeFt: null })).toBe('shelf');
    expect(damStandIn(catalog.fork!)).toBeNull();
  });

  it('gives kinds of one slot stable variants', () => {
    const variants = ['a', 'b', 'c'].map((v) => ({
      model: { area: 'data' as const, path: `fern_${v}.gltf` },
      size: { x: 1, y: 1, z: 1 },
    }));
    const ids = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6'];
    const fernCatalog = Object.fromEntries(ids.map((id) => [id, catalog.fern!]));
    const pick = () =>
      ids.map(
        (id) =>
          suggestDamChoices(project(ids), emptyDamObjectChoices(), fernCatalog, { fern: variants }, false).objects[id]!
            .model!.path,
      );
    expect(pick()).toEqual(pick());
    expect(new Set(pick()).size).toBeGreaterThan(1);
  });
});

describe('suggestDamChoices', () => {
  it('names and sizes new kinds and skips kinds without a stand-in or size', () => {
    const { objects } = suggestDamChoices(
      project(['tree', 'fern', 'fork']),
      emptyDamObjectChoices(),
      catalog,
      standIns,
      false,
    );
    expect(objects.tree).toMatchObject({ name: 'Evergreen Tree', model: { path: 'pine.glb' }, unitFt: 20 });
    expect(objects.fern).toMatchObject({ name: 'Fern', model: { path: 'bush.glb' }, unitFt: 10 });
    expect(objects.fork).toMatchObject({ name: 'Fork', model: null });
  });

  it("keeps the DM's names and models unless asked to reassign, and replaces generated names", () => {
    const kept = {
      ...emptyDamObjectChoices(),
      objects: {
        tree: { name: 'My pine', model: { area: 'data' as const, path: 'own.glb' }, unitFt: 3, rotationDeg: 90 },
        fern: { name: 'Object 0123abcd', model: null, unitFt: 5, rotationDeg: 0 },
      },
    };
    const keep = suggestDamChoices(project(['tree', 'fern']), kept, catalog, standIns, false).objects;
    expect(keep.tree).toEqual(kept.objects.tree);
    expect(keep.fern).toMatchObject({ name: 'Fern', model: null });
    const reassigned = suggestDamChoices(project(['tree', 'fern']), kept, catalog, standIns, true).objects;
    expect(reassigned.tree).toMatchObject({
      name: 'My pine',
      model: { path: 'pine.glb' },
      unitFt: 20,
      rotationDeg: 90,
    });
    expect(reassigned.fern).toMatchObject({ model: { path: 'bush.glb' } });
  });
});
