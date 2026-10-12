import { HeightField } from '@/core/terrain/heightfield';
import { computeVisibility, type VisionMap } from '@/core/vision/visibility';
import type { VisibilityRequest, VisibilityResponse } from './visibilityProtocol';

let scene: { map: VisionMap; terrain: HeightField } | null = null;

function reply(response: VisibilityResponse): void {
  const transfer = response.type === 'result' ? [...response.visible.values()].map((cells) => cells.buffer) : [];
  self.postMessage(response, { transfer });
}

function compute(request: Extract<VisibilityRequest, { type: 'compute' }>): void {
  if (!scene) {
    throw new Error('Visibility requested before a map was sent');
  }
  const start = performance.now();
  const visible = computeVisibility(scene.map, scene.terrain, request.state);
  reply({ type: 'result', id: request.id, visible, ms: performance.now() - start });
}

self.onmessage = (event: MessageEvent<VisibilityRequest>) => {
  const request = event.data;
  switch (request.type) {
    case 'scene': {
      const { cols, rows, spacingFt, data } = request.terrain;
      scene = { map: request.map, terrain: new HeightField(cols, rows, spacingFt, data) };
      break;
    }
    case 'compute':
      // The UI thread reports it; an uncaught error would lose the request.
      try {
        compute(request);
      } catch (error) {
        reply({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
      }
      break;
  }
};
