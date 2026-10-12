import { create } from 'zustand';
import type { MapPoint, Vec2 } from '@/core/model';
import type { Falloff } from '@/core/terrain/brushes';

/** Options shared by the terrain tools; they persist while switching tools. */
export interface TerrainToolOptions {
  radiusFt: number;
  /** 0..1; for raise, lower and noise it scales `RAISE_FT_PER_DAB`. */
  strength: number;
  falloff: Falloff;
  /** Flatten to `flattenHeightFt` instead of the height under the stroke start. */
  flattenToTyped: boolean;
  flattenHeightFt: number;
  terraceStepFt: number;
  noiseSeed: number;
  noiseScaleFt: number;
  /** Calibration derives the rotation from the clicked square instead of keeping the current one. */
  detectRotation: boolean;
}

interface TerrainToolState extends TerrainToolOptions {
  /** Terrain point under the pointer, for the brush cursor and height readout. */
  cursor: MapPoint | null;
  /** First ramp point while dragging a ramp. */
  rampStart: Vec2 | null;
  /** First clicked grid corner (image px) while calibrating. */
  cornerPx: Vec2 | null;
  setOptions(patch: Partial<TerrainToolOptions>): void;
  setCursor(cursor: MapPoint | null): void;
  setRampStart(start: Vec2 | null): void;
  setCornerPx(corner: Vec2 | null): void;
}

export const useTerrainToolStore = create<TerrainToolState>((set) => ({
  radiusFt: 10,
  strength: 0.5,
  falloff: 'smooth',
  flattenToTyped: false,
  flattenHeightFt: 0,
  terraceStepFt: 5,
  noiseSeed: 1,
  noiseScaleFt: 10,
  detectRotation: false,
  cursor: null,
  rampStart: null,
  cornerPx: null,
  setOptions: (patch) => set(patch),
  setCursor: (cursor) => set({ cursor }),
  setRampStart: (rampStart) => set({ rampStart }),
  setCornerPx: (cornerPx) => set({ cornerPx }),
}));
