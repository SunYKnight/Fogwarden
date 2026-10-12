import { create } from 'zustand';
import type { Vec2 } from '@/core/model';
import type { FogCells } from '@/core/vision/fog';

export type FogBrushMode = 'off' | 'reveal' | 'hide' | 'erase';

interface FogViewState {
  /** DM sees the players' fog as a tint on the encounter map. */
  showFogToDm: boolean;
  brush: FogBrushMode;
  brushRadiusFt: number;
  /** Map point under the pointer while a brush is active; drawn as the brush outline. */
  cursor: Vec2 | null;
  /** Fog of the open encounter as players get it; null without an encounter map or before the first result. */
  fog: FogCells | null;
  /** Duration of the last visibility computation in the worker. */
  computeMs: number | null;
  setShowFogToDm(show: boolean): void;
  setBrush(brush: FogBrushMode): void;
  setBrushRadius(radiusFt: number): void;
  setCursor(cursor: Vec2 | null): void;
  setFog(fog: FogCells | null, computeMs: number | null): void;
}

export const useFogViewStore = create<FogViewState>((set) => ({
  showFogToDm: true,
  brush: 'off',
  brushRadiusFt: 10,
  cursor: null,
  fog: null,
  computeMs: null,
  setShowFogToDm: (showFogToDm) => set({ showFogToDm }),
  setBrush: (brush) => set({ brush, cursor: null }),
  setBrushRadius: (brushRadiusFt) => set({ brushRadiusFt }),
  setCursor: (cursor) => set({ cursor }),
  setFog: (fog, computeMs) => set({ fog, computeMs }),
}));
