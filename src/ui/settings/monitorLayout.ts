export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MonitorLayout<T> {
  /** Size of the drawing that holds all monitors. */
  width: number;
  height: number;
  /** Every input item with its rectangle relative to the drawing's top left corner, same order. */
  placed: { item: T; rect: Rect }[];
}

/**
 * Scales the desktop arrangement of `items` (rectangles from `rectOf` in physical pixels, any origin) uniformly
 * to fit `maxWidth` × `maxHeight`, so the settings show where each monitor sits relative to the others.
 */
export function monitorLayout<T>(
  items: T[],
  rectOf: (item: T) => Rect,
  maxWidth: number,
  maxHeight: number,
): MonitorLayout<T> {
  const rects = items.map(rectOf);
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  const scale = rects.length > 0 ? Math.min(maxWidth / (right - left), maxHeight / (bottom - top)) : 0;
  return {
    width: rects.length > 0 ? (right - left) * scale : 0,
    height: rects.length > 0 ? (bottom - top) * scale : 0,
    placed: items.map((item) => {
      const r = rectOf(item);
      return {
        item,
        rect: { x: (r.x - left) * scale, y: (r.y - top) * scale, width: r.width * scale, height: r.height * scale },
      };
    }),
  };
}
