import { z } from 'zod';
import { assetRefSchema, newId, type AssetRef, type Vec2 } from '../model/common';
import type { Prop } from '../model/map';
import type { DamProject } from './damProject';

/** Where the DM's choice of model per Dungeon Alchemist object kind is kept, in the data area. */
export const DAM_OBJECTS_PATH = 'library/dungeon-alchemist-objects.json';

export const damObjectChoiceSchema = z.object({
  /** The DM's name for the kind; Dungeon Alchemist files only carry an id. */
  name: z.string(),
  /** Model in the library or shipped content; null leaves the kind out. */
  model: assetRefSchema.nullable(),
  /** Feet per model unit: 5 for models made for Dungeon Alchemist (1 unit = 1 square). */
  unitFt: z.number().positive(),
  /** Added to Dungeon Alchemist's turn, degrees clockwise seen from above. */
  rotationDeg: z.number(),
});
export type DamObjectChoice = z.infer<typeof damObjectChoiceSchema>;

export const damObjectChoicesSchema = z.object({
  schema: z.literal('dungeon-alchemist-objects'),
  version: z.literal(1),
  /** Last folder models were picked from (Dungeon Alchemist's custom models), absolute path. */
  modelFolder: z.string().nullable(),
  /** By Dungeon Alchemist block id. */
  objects: z.record(z.string(), damObjectChoiceSchema),
});
export type DamObjectChoices = z.infer<typeof damObjectChoicesSchema>;

export function emptyDamObjectChoices(): DamObjectChoices {
  return { schema: 'dungeon-alchemist-objects', version: 1, modelFolder: null, objects: {} };
}

export interface DamObjectKind {
  blockId: string;
  count: number;
}

/** Each object kind of the project once, most frequent first. */
export function damObjectKinds(project: DamProject): DamObjectKind[] {
  const counts = new Map<string, number>();
  project.objects.forEach((o) => counts.set(o.blockId, (counts.get(o.blockId) ?? 0) + 1));
  return [...counts]
    .map(([blockId, count]) => ({ blockId, count }))
    .sort((a, b) => b.count - a.count || a.blockId.localeCompare(b.blockId));
}

/** A chosen kind with its model already copied next to the map. */
export interface PlacedKind extends DamObjectChoice {
  model: AssetRef;
}

/**
 * Props for every project object whose kind has a model. `margin` is the export's border in
 * squares around the project area. Dungeon Alchemist turns clockwise seen from above; three.js
 * turns counter-clockwise around Y, hence the negated angle.
 */
export function damProps(
  project: DamProject,
  margin: Vec2,
  feetPerSquare: number,
  kinds: Record<string, PlacedKind>,
): Prop[] {
  return project.objects.flatMap((o) => {
    const kind = kinds[o.blockId];
    const scale = kind ? kind.unitFt * o.scale : 0;
    return kind
      ? [
          {
            id: newId(),
            name: kind.name,
            asset: kind.model,
            position: [o.position.x + margin.x * feetPerSquare, o.elevationFt, o.position.y + margin.y * feetPerSquare],
            rotationDeg: [0, -(o.rotationDeg + kind.rotationDeg), 0],
            scale: [scale, scale, scale],
            projectMap: false,
            // The export's walls block sight and movement, not stand-ins.
            occludesSight: false,
            blocksMovement: false,
            walkable: false,
          } satisfies Prop,
        ]
      : [];
  });
}
