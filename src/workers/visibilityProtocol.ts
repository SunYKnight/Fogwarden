import type { VisionMap, VisionState } from '@/core/vision/visibility';

/** Messages to `visibility.worker.ts`. The scene is sent once per map; computes refer to the last scene. */
export type VisibilityRequest =
  | {
      type: 'scene';
      map: VisionMap;
      terrain: { cols: number; rows: number; spacingFt: number; data: Float32Array };
    }
  | { type: 'compute'; id: number; state: VisionState };

export type VisibilityResponse =
  /** `visible` per fog cell: FOG_VISIBLE or 0; `ms` is the compute time inside the worker. */
  { type: 'result'; id: number; visible: Uint8Array; ms: number } | { type: 'error'; id: number; message: string };
