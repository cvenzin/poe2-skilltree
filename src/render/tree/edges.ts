import { Container, Graphics } from 'pixi.js';
import type { TreeData } from '../../data/types';
import type { ClusterInfo } from './geometry';
import type { MountContext, EdgeRedraw } from './types';
import { identityTransform, resolveDrawableEdge, traceEdge } from './edgeGeometry';
import type { CoordTransform, DrawableEdge } from './edgeGeometry';
import { edgeState } from './edgeState';
import type { EdgeState } from './edgeState';
import type { Allocation } from '../../state/allocation';

export function drawOverlayEdges(
  overlay: Container,
  data: TreeData,
  ascId: string,
  cluster: ClusterInfo,
  ctx: MountContext,
): EdgeRedraw {
  const layers = makeEdgeLayers(overlay);
  const t: CoordTransform = {
    tx: (n) => n - cluster.cx,
    ty: (n) => n - cluster.cy,
  };
  const shouldDraw = (pair: DrawableEdge): boolean =>
    pair.a.ascendancyId === ascId && pair.b.ascendancyId === ascId;
  return (allocation, previewPath) => {
    redrawEdgeLayers(layers, data, allocation, previewPath, edgeCtxFrom(ctx), t, shouldDraw);
  };
}

/** Build the main-tree edge layers. Returns a redraw closure that partitions
 *  edges into idle/preview/allocated Graphics based on current state — call
 *  it once initially and again whenever state changes.
 *
 *  Ascendancy edges are handled separately by {@link drawAscendancyOverlay}.
 *
 *  Reads `frontierKeys` from `ctx.pathing` at redraw time so a class /
 *  ascendancy switch picks up the new frontier without rebuilding the
 *  closure or recreating any Graphics.
 */
export function drawEdges(
  parent: Container,
  data: TreeData,
  ctx: MountContext,
): EdgeRedraw {
  const layers = makeEdgeLayers(parent);
  return (allocation, previewPath) => {
    redrawEdgeLayers(layers, data, allocation, previewPath, edgeCtxFrom(ctx), identityTransform, isMainTreeEdge);
  };
}

function edgeCtxFrom(ctx: MountContext): EdgeRedrawContext {
  return {
    frontierKeys: ctx.pathing?.frontierKeys ?? EMPTY_SET,
    hiddenKeys: ctx.pathing?.hiddenKeys ?? EMPTY_SET,
  };
}

const EMPTY_SET: ReadonlySet<string> = new Set();

function isMainTreeEdge(pair: DrawableEdge): boolean {
  return !pair.a.ascendancyId && !pair.b.ascendancyId;
}

/** Allocate the edge Graphics in fixed z-order: idle (back) → allocated →
 *  set1 → set2 → preview (top). Preview is drawn last so its "intense blue"
 *  pops over allocated/branch edges that share endpoints with the frontier. */
function makeEdgeLayers(parent: Container): Record<EdgeState, Graphics> {
  const idle = new Graphics();
  const allocated = new Graphics();
  const set1 = new Graphics();
  const set2 = new Graphics();
  const preview = new Graphics();
  parent.addChild(idle, allocated, set1, set2, preview);
  return { idle, allocated, set1, set2, preview };
}

/** Per-redraw state derived from the current pathing context. Bundled so the
 *  edge redraw stays under the parameter-count lint cap. */
interface EdgeRedrawContext {
  frontierKeys: ReadonlySet<string>;
  hiddenKeys: ReadonlySet<string>;
}

function redrawEdgeLayers(
  layers: Record<EdgeState, Graphics>,
  data: TreeData,
  allocation: Allocation,
  previewPath: readonly string[] | null,
  edgeCtx: EdgeRedrawContext,
  transform: CoordTransform,
  shouldDraw: (pair: DrawableEdge) => boolean
): void {
  layers.idle.clear();
  layers.preview.clear();
  layers.allocated.clear();
  layers.set1.clear();
  layers.set2.clear();
  const previewSet = previewPath ? new Set(previewPath) : null;

  for (const edge of data.edges) {
    // Drop edges that touch a constraint-hidden node (e.g. Druid Oracle's
    // Forbidden Path clusters when "The Unseen Path" isn't allocated) so we
    // don't render line stubs reaching into empty space.
    if (edgeCtx.hiddenKeys.has(edge.from) || edgeCtx.hiddenKeys.has(edge.to)) continue;
    const pair = resolveDrawableEdge(data.nodes[edge.from], data.nodes[edge.to]);
    if (!pair || !shouldDraw(pair)) continue;
    const state = edgeState(edge.from, edge.to, allocation, edgeCtx.frontierKeys, previewSet);
    traceEdge(layers[state], pair.a, pair.b, edge, transform);
  }

  strokeEdges(layers.idle, 'idle');
  strokeEdges(layers.allocated, 'allocated');
  strokeEdges(layers.set1, 'set1');
  strokeEdges(layers.set2, 'set2');
  strokeEdges(layers.preview, 'preview');
}

/** Per-state edge colours. idle/preview/allocated match the line atlas's
 *  pre-rendered variants (Normal / can-allocate / Active); set1/set2 tint the
 *  weapon-set branch edges so both trees read at a glance. */
const EDGE_COLOR = {
  idle: 0x6e5e3c,
  preview: 0x5a8eff,
  allocated: 0xffd66a,
  set1: 0x57c46a, // green — Weapon Set 1 branch
  set2: 0xe0594f, // red — Weapon Set 2 branch
} as const;

const EDGE_WIDTH = 6;

const EDGE_ALPHA = 0.9;

function strokeEdges(layer: Graphics, state: EdgeState): void {
  layer.stroke({ color: EDGE_COLOR[state], width: EDGE_WIDTH, alpha: EDGE_ALPHA });
}
