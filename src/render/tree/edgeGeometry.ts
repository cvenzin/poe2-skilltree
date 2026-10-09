import type { TreeNode, Edge } from '../../data/types';
import { nodeHasVisual } from '../frameForNode';
import { Graphics } from 'pixi.js';

export const identityTransform = { tx: (n: number) => n, ty: (n: number) => n };

export interface CoordTransform {
  tx: (n: number) => number;
  ty: (n: number) => number;
}

/** Positioned, drawable view of an edge — narrowed to non-undefined x/y on both
 *  endpoints. Returned as a pair so consumers can pattern-match without juggling
 *  type predicates (which TS only narrows for one parameter). */
export interface DrawableEdge {
  a: TreeNode & { x: number; y: number };
  b: TreeNode & { x: number; y: number };
}

/** Resolve an edge's endpoints into a drawable pair, or null if either is missing
 *  positions, renders no sprite (hidden masteries + icon-less placeholder nodes),
 *  or carries `hideConnection` (the 12 tribute/cluster-jewel nodes that PoE doesn't
 *  draw connection lines for). Never draw an edge into a node the user can't see. */
export function resolveDrawableEdge(
  a: TreeNode | undefined,
  b: TreeNode | undefined
): DrawableEdge | null {
  if (!a || !b) return null;
  if (a.x === undefined || a.y === undefined || b.x === undefined || b.y === undefined) return null;
  if (!nodeHasVisual(a) || !nodeHasVisual(b)) return null;
  if (a.hideConnection || b.hideConnection) return null;
  return { a: a as DrawableEdge['a'], b: b as DrawableEdge['b'] };
}

/**
 * Draw a single edge. If the edge carries `orbitX`/`orbitY`, those name the
 * **centre of the arc** the edge follows — verified empirically across all
 * 1710 such edges in 0.5.0, both endpoints sit at the same distance from
 * `(orbitX, orbitY)` to within float precision. So we draw a circular arc on
 * that centre, taking the shorter sweep (minor arc) between the two endpoints.
 *
 * Edges without `orbitX`/`orbitY` (radial spokes from the group centre and
 * cross-group connections) render as straight lines.
 *
 * `transform` is applied uniformly to a, b, AND the arc centre so the helper
 * works for the main tree (identity) and the scaled ascendancy overlay.
 */
export function traceEdge(
  layer: Graphics,
  a: TreeNode & { x: number; y: number },
  b: TreeNode & { x: number; y: number },
  edge: Edge,
  t: CoordTransform
): void {
  const ax = t.tx(a.x), ay = t.ty(a.y);
  const bx = t.tx(b.x), by = t.ty(b.y);
  layer.moveTo(ax, ay);

  if (edge.orbitX !== undefined && edge.orbitY !== undefined) {
    const cx = t.tx(edge.orbitX);
    const cy = t.ty(edge.orbitY);
    if (tryDrawArc(layer, ax, ay, bx, by, cx, cy)) return;
  }

  layer.lineTo(bx, by);
}

/** Draw the shorter circular arc from (ax,ay) to (bx,by) around centre (cx,cy).
 *  Returns false (no draw) when the centre isn't actually equidistant from the
 *  two endpoints — that's degenerate data we'd rather render as a straight line. */
function tryDrawArc(
  layer: Graphics,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number
): boolean {
  const rA = Math.hypot(ax - cx, ay - cy);
  const rB = Math.hypot(bx - cx, by - cy);
  if (rA < 1 || rB < 1) return false;
  if (Math.abs(rA - rB) > rA * 0.02) return false; // not equidistant → punt to straight line

  const startAngle = Math.atan2(ay - cy, ax - cx);
  const endAngle   = Math.atan2(by - cy, bx - cx);
  // Shortest sweep: |delta| ≤ π. Pixi's `counterclockwise` flag is true when
  // the sweep direction decreases the angle (Y-down screen → CCW visually).
  let delta = endAngle - startAngle;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;

  layer.arc(cx, cy, rA, startAngle, endAngle, delta < 0);
  return true;
}
