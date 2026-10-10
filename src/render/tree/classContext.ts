import type { MountContext, EdgeRedraw } from './types';
import type { TreeData } from '../../data/types';
import { classBackgroundName } from '../atlas';
import type { AtlasBundle } from '../atlas';
import { destroyChildren, drawOverlayNodes } from './nodes';
import { startNodeKeyForClass } from '../../data/normalize';
import { useStore } from '../../state/store';
import { findAscendancyStartKey, findAscendancy, collectClusterNodes } from './geometry';
import { buildPathingContext } from './pathingContext';
import { drawCentralBackdrop, drawMainCircle } from './decorations';
import { applyJewelOverlay } from './radiusOverlays';
import { applySearchHighlight } from './searchHighlight';
import { Container } from 'pixi.js';
import { drawOverlayEdges } from './edges';

/**
 * Imperatively swap the class/ascendancy-dependent layers:
 *   - Backdrop disc (drawCentralBackdrop)
 *   - MainCircle frames (drawMainCircle) — rotation depends on class
 *   - Ascendancy overlay (drawAscendancyOverlay)
 *   - Pathing context (classStartKey, blockedKeys, frontierKeys)
 *
 * The Pixi Application, viewport, world container, main-tree edges, main-tree
 * nodes, masteries, jewel overlay, search overlay, ticker, and store
 * subscription all stay in place — that's the whole point of this path: no
 * WebGL teardown, no black-screen flash when the user changes class or
 * ascendancy. The redraw uses the store's revalidated allocation.
 */
export function swapContext(
  ctx: MountContext,
  data: TreeData,
  atlases: AtlasBundle,
  className: string,
  ascendancyId: string | null,
): void {
  const generation = ++ctx.swapGeneration;
  ctx.hoverPreviewDependencies = null;
  // Release the old overlay's hover reference before destroying its wraps.
  if (ctx.hoverScaledWrap && !ctx.hoverScaledWrap.destroyed) ctx.hoverScaledWrap.scale.set(1);
  ctx.hoverScaledWrap = null;

  // Drop the previous ascendancy's node wraps from the global maps so the
  // store-subscription doesn't keep paying texture-swap costs on nodes that
  // were just removed from the scene, and so search/state passes can't see
  // stale entries.
  for (const key of ctx.ascendancyNodeKeys) {
    ctx.nodeWraps.delete(key);
    ctx.nodeStates.delete(key);
  }
  ctx.ascendancyNodeKeys.clear();

  destroyChildren(ctx.backdropLayer);
  destroyChildren(ctx.mainCircleLayer);
  destroyChildren(ctx.ascendancyLayer);
  ctx.redrawOverlayEdges = null;

  // Recompute pathing — `attachNodeInteraction` and the main-tree edge redraw
  // read these values live, so updating the ref is enough to refresh BFS
  // behaviour across every existing node. `blockedKeys` and `hiddenKeys` also
  // depend on `allocated` (constraint gates like "The Unseen Path"); applyAll
  // rebuilds them on every allocation change via {@link refreshConstraintState}.
  const classStartKey = startNodeKeyForClass(className, data);
  const { allocation } = useStore.getState();
  const frontierKeys = new Set<string>([classStartKey]);
  const ascStartKey = findAscendancyStartKey(data, ascendancyId);
  if (ascStartKey) frontierKeys.add(ascStartKey);
  ctx.pathing = buildPathingContext(data, classStartKey, ascendancyId, frontierKeys, allocation);

  if (ctx.backdropLayer) drawCentralBackdrop(ctx.backdropLayer, atlases, data, className, ascendancyId);
  if (ctx.mainCircleLayer) drawMainCircle(ctx.mainCircleLayer, atlases, data, className);
  if (ctx.ascendancyLayer) {
    ctx.redrawOverlayEdges = drawAscendancyOverlay(ctx.ascendancyLayer, atlases, data, ascendancyId, ctx);
  }

  // The per-class backdrop atlas is lazy-loaded (App.tsx). If it's not in yet,
  // `drawCentralBackdrop` drew nothing (tryGetFrame → null) — fetch it, then
  // repaint just the backdrop once it lands. Skip if the class changed again
  // (generation moved) or the canvas was torn down while loading.
  const bgName = classBackgroundName(className);
  if (!atlases.atlases.has(bgName)) {
    atlases.ensure(bgName).then((added) => {
      if (!added || ctx.cancelled || generation !== ctx.swapGeneration || !ctx.backdropLayer) return;
      destroyChildren(ctx.backdropLayer);
      drawCentralBackdrop(ctx.backdropLayer, atlases, data, className, ascendancyId);
    }).catch(() => { /* missing/failed background — leave the backdrop empty */ });
  }

  const state = useStore.getState();
  ctx.applyAll?.(state.allocation, state.previewPath);
  // Clear any stale hover/search remnants tied to the old ascendancy's nodes.
  if (ctx.jewelOverlay && ctx.worldContainer) {
    applyJewelOverlay(state.hovered, data, ctx.nodeWraps, ctx.jewelOverlay, ctx.worldContainer, ctx.pathing);
  }
  if (ctx.searchMatchLayer && ctx.worldContainer && ctx.viewport) {
    applySearchHighlight(state.searchMatches, state.searchCursor, ctx.nodeWraps, ctx.searchMatchLayer, ctx.worldContainer, ctx.viewport.scale.x, true);
  }
}

/**
 * Render the currently-selected ascendancy's tree (edges + nodes) centred on
 * the main tree (world origin). The ascendancy's nodes keep their relative
 * layout and native size — they're only translated so the start node lands
 * at the panel target. Other ascendancies are hidden.
 *
 * The backdrop disc is rendered by {@link drawAscendancyBackdrop} as an
 * *earlier* layer so main-tree passives that overlap the disc area aren't
 * occluded by it.
 */
function drawAscendancyOverlay(
  parent: Container,
  atlases: AtlasBundle,
  data: TreeData,
  ascendancyId: string | null,
  ctx: MountContext,
): EdgeRedraw | null {
  if (!ascendancyId) return null;
  const lookup = findAscendancy(data, ascendancyId);
  if (!lookup) return null;
  const cluster = collectClusterNodes(data, lookup.asc.id);
  if (!cluster) return null;

  // The ascendancy's `offsetX/Y` metadata is the displacement from world
  // origin into the in-game ascendancy panel (PoE's UI puts the panel art
  // at world origin + offset, which lands far from the tree's ascendancy
  // position). The **inverse** (`-offset`) is exactly the tree position:
  // for every class it lies on the line from world origin to the class
  // start, at consistent distance |offset| ≈ 1332 from origin — about
  // 110-160 world units inside the class-start ring. Pure metadata, no
  // magic constants.
  const ascStart = cluster.nodes.find((n) => n.node.isAscendancyStart);
  if (!ascStart) return null;
  const targetX = -lookup.asc.offsetX;
  const targetY = -lookup.asc.offsetY;

  // Align the ascendancy start node (not the cluster bbox centre) with the
  // target world position. The start sits at one corner of its cluster, so
  // start-aligned placement makes the cluster fan inward from the target
  // — matching the in-game "ascendancy grows from class start" look.
  const ascStartLocalX = ascStart.x - cluster.cx;
  const ascStartLocalY = ascStart.y - cluster.cy;

  const overlay = new Container();
  overlay.position.set(
    targetX - ascStartLocalX,
    targetY - ascStartLocalY
  );
  parent.addChild(overlay);

  const redraw = drawOverlayEdges(overlay, data, lookup.asc.id, cluster, ctx);
  drawOverlayNodes(overlay, atlases, data, cluster, ctx);
  return redraw;
}
