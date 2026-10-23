import type { EdgeState } from './edgeState';

/** Widths are CSS pixels, independent of the renderer's device pixel ratio. */
export const EDGE_STYLE = {
  idle:      { color: 0x766b58, alpha: 0.78, width: 1.65, min: 0.7, max: 2.2 },
  allocated: { color: 0xe1c36c, alpha: 0.96, width: 2.7, min: 1.25, max: 3.4 },
  set1:      { color: 0x70c991, alpha: 0.98, width: 2.7, min: 1.25, max: 3.4 },
  set2:      { color: 0xe27273, alpha: 1, width: 2.7, min: 1.25, max: 3.4 },
  preview:   { color: 0x779fff, alpha: 1, width: 3, min: 1.45, max: 3.6 },
} as const satisfies Record<EdgeState, object>;

export const EDGE_UNDERLAY = { color: 0x100e0b, alpha: 0.65, padding: 0.65 } as const;

/** Grow more slowly than the tree; retain fine lines at overview zoom and cap
 * close-up thickness. Reference is the initial fit, even with a saved camera. */
export function edgeScreenWidth(state: EdgeState, zoom: number, referenceZoom: number): number {
  const style = EDGE_STYLE[state];
  const relativeZoom = Math.max(zoom, 0.0001) / Math.max(referenceZoom, 0.0001);
  const width = Math.min(style.max, Math.max(style.min, style.width * relativeZoom ** 0.35));
  if (state === 'idle' || state === 'preview') return width;
  // Allocated paths are 10% finer at overview (initial fit and below).
  // Ease back to the existing gameplay width by twice the fitted zoom.
  const t = Math.min(1, Math.max(0, relativeZoom - 1));
  const overviewFactor = 0.9 + 0.1 * t * t * (3 - 2 * t);
  return Math.max(style.min, width * overviewFactor);
}
