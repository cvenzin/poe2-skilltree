import { Container } from 'pixi.js';
import type { TreeData } from '../../data/types';
import type { ClusterInfo } from './geometry';
import type { MountContext, EdgeRedraw } from './types';
import { identityTransform, resolveDrawableEdge } from './edgeGeometry';
import type { CoordTransform, DrawableEdge } from './edgeGeometry';
import { edgeState } from './edgeState';
import type { EdgeState } from './edgeState';
import type { Allocation } from '../../state/allocation';
import { createEdgeStroke } from './edgeStroke';
import type { EdgeStroke } from './edgeStroke';
import { buildEdgeStrokePath } from './edgeStrokeGeometry';
import type { EdgeStrokePath } from './edgeStrokeGeometry';

export function drawOverlayEdges(
  overlay: Container,
  data: TreeData,
  ascId: string,
  cluster: ClusterInfo,
  ctx: MountContext,
): EdgeRedraw {
  const t: CoordTransform = {
    tx: (n) => n - cluster.cx,
    ty: (n) => n - cluster.cy,
  };
  const shouldDraw = (pair: DrawableEdge): boolean =>
    pair.a.ascendancyId === ascId && pair.b.ascendancyId === ascId;
  return makeEdgeRedraw(overlay, data, ctx, t, shouldDraw);
}

/** Build the main-tree edge layers. Returns a redraw closure that partitions
 *  cached paths into the five existing colour states — call
 *  it once initially and again whenever state changes.
 *
 *  Ascendancy edges are handled separately by {@link drawAscendancyOverlay}.
 *
 *  Reads `frontierKeys` from `ctx.pathing` at redraw time so a class /
 *  ascendancy switch picks up the new frontier without rebuilding the
 *  closure or retracing edge geometry.
 */
export function drawEdges(
  parent: Container,
  data: TreeData,
  ctx: MountContext,
): EdgeRedraw {
  return makeEdgeRedraw(parent, data, ctx, identityTransform, isMainTreeEdge);
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

const EDGE_STATES: readonly EdgeState[] = ['idle', 'allocated', 'set1', 'set2', 'preview'];

interface CachedEdge {
  from: string;
  to: string;
  path: EdgeStrokePath;
}

/** Keep existing layer order and state logic. Cache Pixi paths once; each
 * state's buffers change only when its edge membership changes. */
function makeEdgeRedraw(
  parent: Container,
  data: TreeData,
  ctx: MountContext,
  transform: CoordTransform,
  shouldDraw: (pair: DrawableEdge) => boolean,
): EdgeRedraw {
  const group = new Container();
  group.eventMode = 'none';
  parent.addChild(group);
  const layers = Object.fromEntries(EDGE_STATES.map((state) => {
    const stroke = createEdgeStroke(state);
    group.addChild(stroke.mesh);
    return [state, stroke];
  })) as Record<EdgeState, EdgeStroke>;
  const edges: CachedEdge[] = [];
  for (const edge of data.edges) {
    const pair = resolveDrawableEdge(data.nodes[edge.from], data.nodes[edge.to]);
    if (!pair || !shouldDraw(pair)) continue;
    const path = buildEdgeStrokePath(pair, edge, transform);
    if (path.positions.length >= 4) edges.push({ from: edge.from, to: edge.to, path });
  }
  // onRender covers wheel/pinch, search animations and resize without another
  // listener or ticker. Only uniforms change; geometry stays on the GPU.
  group.onRender = () => {
    const zoom = ctx.viewport?.scale.x ?? 1;
    for (const state of EDGE_STATES) layers[state].setZoom(zoom, ctx.edgeReferenceScale, ctx.app?.renderer.resolution);
  };
  return (allocation, previewPath) => {
    redrawEdgeLayers(layers, edges, allocation, previewPath, edgeCtxFrom(ctx));
  };
}

function redrawEdgeLayers(
  layers: Record<EdgeState, EdgeStroke>,
  edges: readonly CachedEdge[],
  allocation: Allocation,
  previewPath: readonly string[] | null,
  edgeCtx: EdgeRedrawContext,
): void {
  const paths: Record<EdgeState, EdgeStrokePath[]> = { idle: [], allocated: [], set1: [], set2: [], preview: [] };
  const previewSet = previewPath ? new Set(previewPath) : null;

  for (const edge of edges) {
    // Drop edges that touch a constraint-hidden node (e.g. Druid Oracle's
    // Forbidden Path clusters when "The Unseen Path" isn't allocated) so we
    // don't render line stubs reaching into empty space.
    if (edgeCtx.hiddenKeys.has(edge.from) || edgeCtx.hiddenKeys.has(edge.to)) continue;
    const state = edgeState(edge.from, edge.to, allocation, edgeCtx.frontierKeys, previewSet);
    paths[state].push(edge.path);
  }

  for (const state of EDGE_STATES) layers[state].setPaths(paths[state]);
}

interface EdgeRedrawContext {
  frontierKeys: ReadonlySet<string>;
  hiddenKeys: ReadonlySet<string>;
}
