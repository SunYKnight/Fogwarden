import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../binary';
import { parseUvtt, isUvttFileName } from './uvtt';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function uvtt(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: 0.2,
    resolution: { map_origin: { x: 1, y: 2 }, map_size: { x: 4, y: 3 }, pixels_per_grid: 50 },
    line_of_sight: [
      // Two runs along the north edge with a door gap between x 3 and 4.
      [
        { x: 1, y: 2 },
        { x: 3, y: 2 },
      ],
      [
        { x: 4, y: 2 },
        { x: 5, y: 2 },
        { x: 5, y: 5 },
      ],
      // A wall that runs on through its window.
      [
        { x: 1, y: 4 },
        { x: 5, y: 4 },
      ],
    ],
    objects_line_of_sight: [
      [
        { x: 2, y: 3 },
        { x: 3, y: 3 },
        { x: 3, y: 3.5 },
        { x: 2, y: 3.5 },
        { x: 2, y: 3 },
      ],
    ],
    portals: [
      {
        position: { x: 3.5, y: 2 },
        bounds: [
          { x: 3, y: 2 },
          { x: 4, y: 2 },
        ],
        rotation: 0,
        closed: true,
        freestanding: false,
      },
      {
        position: { x: 2.5, y: 4 },
        bounds: [
          { x: 2, y: 4 },
          { x: 3, y: 4 },
        ],
        rotation: 0,
        closed: false,
        freestanding: false,
      },
      {
        position: { x: 2, y: 4.8 },
        bounds: [
          { x: 1.5, y: 4.8 },
          { x: 2.5, y: 4.8 },
        ],
        rotation: 0,
        closed: true,
        freestanding: true,
      },
    ],
    environment: { baked_lighting: false, ambient_light: 'ff202020' },
    lights: [{ position: { x: 3, y: 3 }, range: 4, intensity: 1, color: 'ff336699', shadows: true }],
    image: bytesToBase64(new Uint8Array([...PNG_SIGNATURE, 0, 0, 0, 13])),
    ...overrides,
  });
}

describe('parseUvtt', () => {
  it('recognises the Universal VTT extensions', () => {
    expect(['a.dd2vtt', 'b.DF2VTT', 'c.uvtt'].every(isUvttFileName)).toBe(true);
    expect(isUvttFileName('d.json')).toBe(false);
  });

  it('turns squares from the map origin into feet and keeps the grid size', () => {
    const map = parseUvtt(uvtt(), 'tavern.dd2vtt');
    expect(map.calibration).toEqual({ pxPerSquare: 50, rotationDeg: 0, offsetPx: { x: 0, y: 0 } });
    expect(map.image.extension).toBe('png');
    expect(map.content.lights).toMatchObject([
      { position: { x: 10, y: 5, elevationFt: 5 }, brightFt: 10, dimFt: 10, color: '#336699', enabled: true },
    ]);
    expect(map.content.ambientLight).toBe('darkness');
    expect(map.content.notes).toBe('');
  });

  it('joins the walls on both sides of a door into one wall with the door on it', () => {
    const { walls, openings } = parseUvtt(uvtt(), 'tavern.dd2vtt').content;
    const north = walls.find((w) => w.points.some((p) => p.x === 20 && p.y === 15))!;
    expect(north.points).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 15 },
    ]);
    expect(north).toMatchObject({ closed: false, heightFt: 10, material: 'projected', blocksSight: true });
    const door = openings.find((o) => o.wallId === north.id)!;
    expect(door).toMatchObject({ kind: 'door', state: 'closed', segment: 0, t: 0.625, widthFt: 5, heightFt: 7 });
  });

  it('puts a portal that lies on a wall onto that wall; open portals are windows', () => {
    const { walls, openings } = parseUvtt(uvtt(), 'tavern.dd2vtt').content;
    const south = walls.find((w) => w.points[0]!.y === 10 && w.points.length === 2)!;
    expect(south.points).toEqual([
      { x: 0, y: 10 },
      { x: 20, y: 10 },
    ]);
    expect(openings.find((o) => o.wallId === south.id)).toMatchObject({
      kind: 'window',
      t: 0.375,
      widthFt: 5,
      sillFt: 3,
    });
  });

  it('gives a freestanding portal a wall of its own', () => {
    const { walls, openings } = parseUvtt(uvtt(), 'tavern.dd2vtt').content;
    const own = walls.find((w) => w.points[0]!.y === 14)!;
    expect(own.points).toEqual([
      { x: 2.5, y: 14 },
      { x: 7.5, y: 14 },
    ]);
    expect(openings.find((o) => o.wallId === own.id)).toMatchObject({ kind: 'door', t: 0.5, widthFt: 5 });
  });

  it('keeps sight-blocking object outlines as closed, lower walls', () => {
    const { walls } = parseUvtt(uvtt(), 'tavern.dd2vtt').content;
    const object = walls.find((w) => w.closed)!;
    expect(object.points).toEqual([
      { x: 5, y: 5 },
      { x: 10, y: 5 },
      { x: 10, y: 7.5 },
      { x: 5, y: 7.5 },
    ]);
    expect(object).toMatchObject({ heightFt: 6, blocksSight: true, blocksMovement: true });
  });

  it('brightens the ambient light one level when the lighting is baked into the image', () => {
    const map = parseUvtt(uvtt({ environment: { baked_lighting: true, ambient_light: 'ff808080' } }), 'x.dd2vtt');
    expect(map.content.ambientLight).toBe('bright');
    expect(map.content.notes).toMatch(/baked into the battlemap image; ambient light is bright instead of dim/);
  });

  it('names the file and the problem for broken exports', () => {
    expect(() => parseUvtt('{', 'broken.dd2vtt')).toThrow(/"broken.dd2vtt" is not JSON/);
    expect(() => parseUvtt(uvtt({ resolution: undefined }), 'old.dd2vtt')).toThrow(
      /"old.dd2vtt" is not a valid Universal VTT file \(resolution: /,
    );
    expect(() => parseUvtt(uvtt({ image: bytesToBase64(new Uint8Array([1, 2, 3, 4])) }), 'gif.uvtt')).toThrow(
      /"gif.uvtt" holds an image that is not PNG, JPEG or WebP/,
    );
    expect(() => parseUvtt(uvtt({ lights: [{ position: { x: 0, y: 0 }, range: 1, color: 'red' }] }), 'c.uvtt')).toThrow(
      /"red" is not a hex color/,
    );
  });
});
