import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Repository } from '@/data/repository';
import { SAMPLE_MAP } from '@/ui/home/sampleContent';
import { CONTENT_ROOT, PROJECT_ROOT } from '../../../tools/cli';
import { NodeStorage } from '../../../tools/nodeStorage';
import { lerp2, wallSegmentEnds } from '../geometry/walls';
import { imageSize } from '../imageSize';
import { parseUvtt } from '../import/uvtt';
import { encodePng } from '../png';
import type { Vec2 } from '../model/common';
import { createMap } from '../model/factories';
import type { BattleMap, Opening, Wall } from '../model/map';
import { fitSquaresToImage } from '../terrain/calibration';
import { formatUvtt } from './uvtt';

const scratchParent = join(PROJECT_ROOT, 'data-local');
mkdirSync(scratchParent, { recursive: true });
const scratch = mkdtempSync(join(scratchParent, 'uvtt-export-test-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const TOLERANCE_FT = 0.01;

/** Wall outline as a direction-independent, rounded list of points. */
function outline(wall: Pick<Wall, 'points' | 'closed'>): string[] {
  const key = (p: Vec2) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  return wall.points.map(key).sort();
}

function openingCenter(map: Pick<BattleMap, 'walls'>, opening: Opening): Vec2 {
  const wall = map.walls.find((w) => w.id === opening.wallId)!;
  const [a, b] = wallSegmentEnds(wall)[opening.segment]!;
  return lerp2(a, b, opening.t);
}

function expectRoundTrip(map: BattleMap, imageBytes: Uint8Array, pxPerSquare: number) {
  const imported = parseUvtt(formatUvtt(map, { bytes: imageBytes, pxPerSquare }), 'export.dd2vtt');
  const { content, calibration, image } = imported;
  expect(calibration).toEqual({ pxPerSquare, rotationDeg: 0, offsetPx: { x: 0, y: 0 } });
  expect(fitSquaresToImage(imageSize(image.bytes), calibration.pxPerSquare)).toEqual({
    squaresX: map.grid.squaresX,
    squaresY: map.grid.squaresY,
  });
  expect(content.walls.map(outline).sort()).toEqual(
    map.walls
      .filter((w) => w.blocksSight)
      .map(outline)
      .sort(),
  );
  expect(content.walls.map((w) => w.closed).sort()).toEqual(
    map.walls
      .filter((w) => w.blocksSight)
      .map((w) => w.closed)
      .sort(),
  );
  const byPosition = (list: Opening[], from: Pick<BattleMap, 'walls'>) =>
    list
      .map((o) => ({ center: openingCenter(from, o), widthFt: o.widthFt }))
      .sort((p, q) => p.center.x - q.center.x || p.center.y - q.center.y);
  const exported = byPosition(map.openings, map);
  const reimported = byPosition(content.openings, content);
  expect(reimported).toHaveLength(exported.length);
  reimported.forEach((o, i) => {
    expect(o.center.x).toBeCloseTo(exported[i]!.center.x, 2);
    expect(o.center.y).toBeCloseTo(exported[i]!.center.y, 2);
    expect(Math.abs(o.widthFt - exported[i]!.widthFt)).toBeLessThan(TOLERANCE_FT);
  });
  const kindAt = (list: Opening[], from: Pick<BattleMap, 'walls'>) =>
    list.map((o) => [openingCenter(from, o).x.toFixed(1), openingCenter(from, o).y.toFixed(1), o.kind].join()).sort();
  return { content, kinds: kindAt(content.openings, content), sourceKinds: kindAt(map.openings, map) };
}

describe('formatUvtt', () => {
  it('round-trips the sample map: walls, doors, windows, lights and grid', async () => {
    const repository = new Repository(new NodeStorage(scratch, CONTENT_ROOT));
    const map = await repository.load('map', SAMPLE_MAP);
    const png = await repository.storage.readBytes(map.image!.asset.area, map.image!.asset.path);
    const { content, kinds, sourceKinds } = expectRoundTrip(map, png, map.grid.pxPerSquare);
    expect(kinds).toEqual(sourceKinds);
    expect(content.walls).toHaveLength(1);
    expect(content.lights).toHaveLength(map.lights.length);
    content.lights.forEach((light, i) => {
      const source = map.lights[i]!;
      expect(light.position.x).toBeCloseTo(source.position.x, 6);
      expect(light.position.y).toBeCloseTo(source.position.y, 6);
      expect(light.brightFt + light.dimFt).toBeCloseTo(source.brightFt + source.dimFt, 6);
      expect(light.color).toBe(source.color);
    });
    expect(content.ambientLight).toBe(map.ambientLight);
  });

  it('keeps closed rooms with a door on the closing side and low walls as sight objects', async () => {
    const map = createMap({ name: 'Rooms', image: null, squaresX: 6, squaresY: 4, pxPerSquare: 10 });
    const profile = { baseFt: null, material: 'stone' as const, blocksMovement: true, blocksLight: true };
    map.walls = [
      {
        id: 'room',
        points: [
          { x: 5, y: 5 },
          { x: 15, y: 5 },
          { x: 15, y: 15 },
          { x: 5, y: 15 },
        ],
        closed: true,
        heightFt: 10,
        thicknessFt: 1,
        blocksSight: true,
        ...profile,
      },
      {
        id: 'crates',
        points: [
          { x: 20, y: 5 },
          { x: 25, y: 5 },
          { x: 25, y: 10 },
        ],
        closed: false,
        heightFt: 6,
        thicknessFt: 0.5,
        blocksSight: true,
        ...profile,
      },
      {
        id: 'railing',
        points: [
          { x: 20, y: 15 },
          { x: 28, y: 15 },
        ],
        closed: false,
        heightFt: 3,
        thicknessFt: 0.5,
        blocksSight: false,
        ...profile,
      },
    ];
    const opening = { heightFt: 7, sillFt: 0, state: 'closed' as const, secret: false };
    map.openings = [
      { id: 'door', wallId: 'room', segment: 3, t: 0.5, widthFt: 4, kind: 'door', ...opening },
      { id: 'bars', wallId: 'room', segment: 1, t: 0.5, widthFt: 3, kind: 'portcullis', ...opening },
    ];
    map.ambientLight = 'darkness';
    const png = await encodePng({ width: 60, height: 40, channels: 1, bitDepth: 8, samples: new Uint16Array(2400) });
    const { content, kinds } = expectRoundTrip(map, png, 10);
    // Readers know doors and light-passing portals only; bars come back as a window.
    expect(kinds).toEqual(['15.0,10.0,window', '5.0,10.0,door']);
    expect(content.walls.find((w) => w.closed)!.heightFt).toBe(10);
    expect(content.walls.find((w) => !w.closed)!.heightFt).toBe(6);
    expect(content.ambientLight).toBe('darkness');
  });
});
