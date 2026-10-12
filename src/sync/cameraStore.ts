import { create } from 'zustand';
import type { CameraState } from '@/render/CameraRig';

interface DmCameraState {
  /** Latest camera of the DM's encounter map view. */
  camera: CameraState | null;
  /** While set, the player view follows the DM camera. */
  push: boolean;
  setCamera(camera: CameraState): void;
  setPush(push: boolean): void;
}

export const useDmCameraStore = create<DmCameraState>((set) => ({
  camera: null,
  push: false,
  setCamera: (camera) => set({ camera }),
  setPush: (push) => set({ push }),
}));
