import type { TreeData } from '../../data/types';
import type { AtlasBundle } from '../atlas';
import type { MountContext } from './types';
import { createPixiApp, createViewport, computeFitScale, configureViewport, setInitialCamera, attachResizeObserver } from './viewport';
import { computeWorldBounds, computeMainTreeBounds } from './geometry';
import { Container } from 'pixi.js';
import { drawBackground } from './decorations';
import { drawMasteries } from '../drawMasteries';
import { drawEdges } from './edges';
import { drawNodes, applyNodeStates, applyHoverScale } from './nodes';
import { refreshSearchRingStrokes, applySearchHighlight } from './searchHighlight';
import { allAllocated } from '../../state/allocation';
import type { Allocation } from '../../state/allocation';
import { refreshConstraintState, applyConstraintVisibility } from './pathingContext';
import { applyUnlockHighlight, applyJewelOverlay } from './radiusOverlays';
import { swapContext } from './classContext';
import { useStore } from '../../state/store';
import { handleSearchCameraTransition } from './searchCamera';
import { attachGestureSuppression } from './nodeInteraction';

export async function mount(
  host: HTMLDivElement,
  data: TreeData,
  atlases: AtlasBundle,
  propsRef: { readonly current: { className: string; ascendancyId: string | null } },
  ctx: MountContext,
  savedCamera: { x: number; y: number; scale: number } | null,
): Promise<void> {
  const app = await createPixiApp(host);
  if (ctx.cancelled) { app.destroy(true, { children: true }); return; }
  ctx.app = app;
  host.appendChild(app.canvas);

  const world = computeWorldBounds(data);

  const viewport = createViewport(app, world);
  ctx.viewport = viewport;

  // pixi-viewport expects world coords starting at (0, 0). The export's
  // coordinate space is centred on the tree (min ≈ -22k, max ≈ +22k), so we
  // wrap everything in a Container offset by (-minX, -minY) and render in
  // the original world coordinates.
  const worldContainer = new Container();
  worldContainer.position.set(-world.minX, -world.minY);
  viewport.addChild(worldContainer);

  // Z-order (back → front):
  //   tile background  →  ascendancy backdrop disc  →  masteries  →
  //   main-tree edges  →  main-tree nodes  →  main circle frame  →
  //   ascendancy edges + nodes (overlay)  →  jewel overlay  →  search rings
  // The class/ascendancy-dependent layers (backdrop, main circle, ascendancy
  // overlay) live in dedicated empty containers so swapContext can clear and
  // re-populate them without rebuilding the rest of the scene.
  drawBackground(worldContainer, atlases, world);

  const backdropLayer = new Container();
  worldContainer.addChild(backdropLayer);
  ctx.backdropLayer = backdropLayer;

  ctx.redrawMasteries = drawMasteries(worldContainer, atlases, data);
  ctx.redrawMainEdges = drawEdges(worldContainer, data, ctx);
  const drawn = drawNodes(worldContainer, atlases, data, ctx);

  const mainCircleLayer = new Container();
  worldContainer.addChild(mainCircleLayer);
  ctx.mainCircleLayer = mainCircleLayer;

  const ascendancyLayer = new Container();
  worldContainer.addChild(ascendancyLayer);
  ctx.ascendancyLayer = ascendancyLayer;

  // Unlock-highlight overlay — violet rings around the active gate and the
  // nodes it unlocks. Sits above the ascendancy overlay so the gate (an
  // ascendancy notable) is highlighted too, and below jewel/search so those
  // transient overlays paint on top.
  const unlockHighlightLayer = new Container();
  unlockHighlightLayer.eventMode = 'none';
  worldContainer.addChild(unlockHighlightLayer);
  ctx.unlockHighlightLayer = unlockHighlightLayer;

  // Jewel-radius overlay sits below the search-match layer but above nodes.
  // Redrawn whenever the hovered node changes (transient; cleared on hover-out).
  const jewelOverlay = new Container();
  jewelOverlay.eventMode = 'none'; // pure decoration
  worldContainer.addChild(jewelOverlay);
  ctx.jewelOverlay = jewelOverlay;

  // Search-match overlay sits on top of everything: cyan rings around matched
  // nodes, pulsed via the ticker. Built per match-set change in
  // {@link applySearchHighlight}.
  const searchMatchLayer = new Container();
  worldContainer.addChild(searchMatchLayer);
  ctx.searchMatchLayer = searchMatchLayer;
  ctx.worldContainer = worldContainer;
  ctx.fitScale = computeFitScale(app, world);

  const pulseStart = performance.now();
  let lastRingScale = viewport.scale.x;
  const tickerCb = () => {
    if (searchMatchLayer.children.length === 0) return;
    // Keep the ring stroke a constant *screen* width across zoom. Doing this
    // in the ticker covers every path that can change scale (wheel/pinch,
    // search framing animation, initial fit, resize) without per-event hooks.
    const scale = viewport.scale.x;
    if (scale !== lastRingScale) {
      refreshSearchRingStrokes(searchMatchLayer, scale);
      lastRingScale = scale;
    }
    if (ctx.reduceMotion) { searchMatchLayer.alpha = 1; return; }
    // 1 Hz sine, alpha 0.6 ↔ 1.0
    const t = (performance.now() - pulseStart) / 1000;
    searchMatchLayer.alpha = 0.8 + 0.2 * Math.sin(t * 2 * Math.PI);
  };
  app.ticker.add(tickerCb);
  ctx.removeTickerCallback = () => { app.ticker.remove(tickerCb); };

  // Stop the ticker when the tab is hidden — Pixi otherwise keeps the WebGL
  // RAF loop running and burns battery for nothing. Resume on visibility.
  const onVisibility = () => {
    if (document.hidden) app.ticker.stop();
    else app.ticker.start();
  };
  document.addEventListener('visibilitychange', onVisibility);
  ctx.removeVisibilityListener = () => { document.removeEventListener('visibilitychange', onVisibility); };

  // Repaint nodes (texture swap) and edges (3 state-coloured Graphics layers)
  // whenever allocation or preview changes. Subscribe AFTER the draws so
  // every wrap and edge layer is registered. The subscription unsubs in the
  // useEffect cleanup via `ctx.unsubscribeStore`.
  const applyAll = (allocation: Allocation, previewPath: readonly string[] | null) => {
    refreshConstraintState(ctx, data, allocation);
    // Both weapon-set trees are always shown: every allocated node paints as
    // allocated, and the edges carry the set colour (gold/green/red).
    const all = ctx.pathing?.allAllocated ?? allAllocated(allocation);
    applyNodeStates(data, atlases, ctx.nodeWraps, ctx.nodeStates, all, previewPath);
    applyConstraintVisibility(ctx);
    ctx.redrawMainEdges?.(allocation, previewPath);
    ctx.redrawOverlayEdges?.(allocation, previewPath);
    ctx.redrawMasteries?.(all);
    applyUnlockHighlight(ctx, data, all);
  };
  ctx.applyAll = applyAll;
  ctx.swapContext = (nextClassName, nextAscendancyId) => {
    swapContext(ctx, data, atlases, nextClassName, nextAscendancyId);
  };

  // Initial paint: derive pathing + populate class/ascendancy-dependent
  // layers via the same path that future swaps will take. Read the latest
  // props from the ref — they may have changed while createPixiApp was in
  // flight (the second effect skipped any swaps because swapContext was
  // still null at that point).
  ctx.swapContext(propsRef.current.className, propsRef.current.ascendancyId);

  // Initial search highlight + camera framing (handles restoring an in-flight
  // search state on remount — e.g. localStorage carried a search query forward).
  applySearchHighlight(
    useStore.getState().searchMatches,
    useStore.getState().searchCursor,
    ctx.nodeWraps,
    searchMatchLayer,
    worldContainer,
    viewport.scale.x,
  );

  // Initial jewel overlay (nothing hovered yet — clears the layer).
  applyJewelOverlay(useStore.getState().hovered, data, ctx.nodeWraps, jewelOverlay, worldContainer, ctx.pathing);

  ctx.unsubscribeStore = useStore.subscribe((s, prev) => {
    if (s.allocation !== prev.allocation || s.previewPath !== prev.previewPath) {
      applyAll(s.allocation, s.previewPath);
    }
    if (s.searchMatches !== prev.searchMatches || s.searchCursor !== prev.searchCursor) {
      applySearchHighlight(s.searchMatches, s.searchCursor, ctx.nodeWraps, searchMatchLayer, worldContainer, viewport.scale.x);
    }
    // Redraw the radius overlay when either the hovered node OR the Entwined-
    // active flag flips. The pathing context is already refreshed by applyAll
    // above, so `ctx.pathing.entwinedActive` is current.
    if (s.hovered !== prev.hovered || s.allocation !== prev.allocation) {
      applyJewelOverlay(s.hovered, data, ctx.nodeWraps, jewelOverlay, worldContainer, ctx.pathing);
    }
    if (s.hovered?.nodeKey !== prev.hovered?.nodeKey) {
      ctx.hoverScaledWrap = applyHoverScale(ctx.nodeWraps, ctx.hoverScaledWrap, s.hovered?.nodeKey ?? null);
    }
    handleSearchCameraTransition(viewport, world, ctx.fitScale, ctx.nodeWraps, worldContainer, ctx.reduceMotion, prev, s);
  });
  console.log(`[TreeCanvas] drew ${drawn} main-tree nodes, ${data.edges.length} edges; initial ascendancy=${propsRef.current.ascendancyId ?? '(none)'}`);

  configureViewport(viewport, app, world, ctx.reduceMotion);
  attachGestureSuppression(viewport, ctx);
  setInitialCamera(viewport, app, world, computeMainTreeBounds(data), savedCamera);
  ctx.observer = attachResizeObserver(host, app, viewport, world, ctx);
}
