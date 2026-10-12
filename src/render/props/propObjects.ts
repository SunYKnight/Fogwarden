import type { Object3D } from 'three';
import { create } from 'zustand';

interface PropObjectsState {
  /** Scene object of every rendered prop by prop id, for editor gizmos that move them directly. */
  objects: Record<string, Object3D>;
  register(id: string, object: Object3D | null): void;
}

export const usePropObjects = create<PropObjectsState>((set) => ({
  objects: {},
  register: (id, object) =>
    set((s) => {
      const { [id]: _removed, ...rest } = s.objects;
      return { objects: object ? { ...rest, [id]: object } : rest };
    }),
}));
