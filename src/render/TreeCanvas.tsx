import type { TreeData } from '../data/types';
import type { AtlasBundle } from './atlas';
import { useRef, useEffect } from 'react';
import type { MountContext } from './tree/types';
import { prefersReducedMotion } from './tree/viewport';
import { mount } from './tree/mount';
import { destroySearchMatchLayer } from './tree/searchHighlight';

interface TreeCanvasProps {
  data: TreeData;
  atlases: AtlasBundle;
  /** Resolved class name (must match a `data.classes[].name`) — drives the initial camera target. */
  className: string;
  /** When set, the matching ascendancy is rendered centred on the main tree.
   *  Other ascendancies (and their edges) are hidden entirely. */
  ascendancyId: string | null;
}

/**
 * Mounts a Pixi v8 Application + pixi-viewport, draws:
 *   - tiled background
 *   - every edge (curved arc when the edge carries `orbitX/orbitY`, straight
 *     line otherwise — see {@link traceEdge})
 *   - every node as `(frame ← icon)` sprites in unallocated state
 *   - the selected ascendancy as a separate centred overlay
 *
 * Pan/zoom behavior:
 *   - drag-to-pan with momentum (decelerate)
 *   - wheel-zoom toward cursor (animated)
 *   - pinch zoom
 *   - clamped to world bounds with a soft bounce on overrun
 *   - clamped zoom range: fitToScreen ↔ 6×
 *
 * Lifecycle is StrictMode-safe — the effect cleans up the entire Pixi app +
 * destroys the canvas DOM element. A racing async init checks the cancellation
 * flag before mounting, so dev double-mount doesn't leak two WebGL contexts.
 */
export default function TreeCanvas({
  data,
  atlases,
  className,
  ascendancyId,
}: Readonly<TreeCanvasProps>) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // The heavy Pixi/WebGL setup belongs to (data, atlases). Class/ascendancy
  // changes go through `swapContext` (see below) which mutates the existing
  // scene — no WebGL teardown, no black-screen flash. Held in a ref so the
  // light second effect can call it.
  const ctxRef = useRef<MountContext | null>(null);
  // Pass the latest (className, ascendancyId) to mount() — the mount itself
  // is async, so reading from props in the resolver can be stale by the time
  // it finishes. Updated by the swap effect below so a queued mount picks up
  // the current values when it lands.
  const propsRef = useRef({ className, ascendancyId });

  // Preserved camera (viewport center + zoom) across teardowns of the heavy
  // effect — but with className/ascendancyId no longer in this effect's deps,
  // the only reason for the heavy effect to re-run is a version (data) change,
  // which deliberately fits-to-screen for the new world. The ref survives the
  // re-run but is reset on full TreeCanvas unmount (e.g. version-switch
  // overlay), and the new mount fits-to-screen when nothing is saved.
  const savedCameraRef = useRef<{ x: number; y: number; scale: number } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const ctx: MountContext = {
      cancelled: false,
      gestureActive: false,
      lastGestureEndAt: 0,
      app: null,
      viewport: null,
      observer: null,
      nodeWraps: new Map(),
      constrainedWraps: new Set(),
      nodeStates: new Map(),
      redrawMainEdges: null,
      redrawOverlayEdges: null,
      redrawMasteries: null,
      searchMatchLayer: null,
      jewelOverlay: null,
      unlockHighlightLayer: null,
      hoverScaledWrap: null,
      worldContainer: null,
      fitScale: 1,
      reduceMotion: prefersReducedMotion(),
      removeTickerCallback: null,
      removeVisibilityListener: null,
      unsubscribeStore: null,
      pathing: null,
      hoverPreviewDependencies: null,
      backdropLayer: null,
      mainCircleLayer: null,
      ascendancyLayer: null,
      ascendancyNodeKeys: new Set<string>(),
      applyAll: null,
      swapContext: null,
      swapGeneration: 0,
    };
    ctxRef.current = ctx;
    void mount(host, data, atlases, propsRef, ctx, savedCameraRef.current);

    return () => {
      ctx.cancelled = true;
      // Snapshot the camera so a future remount can restore it (version
      // switch unmounts TreeCanvas entirely, which clears the ref instead —
      // see comment above).
      if (ctx.viewport) {
        savedCameraRef.current = {
          x: ctx.viewport.center.x,
          y: ctx.viewport.center.y,
          scale: ctx.viewport.scale.x,
        };
      }
      ctx.observer?.disconnect();
      ctx.unsubscribeStore?.();
      ctx.removeTickerCallback?.();
      ctx.removeVisibilityListener?.();
      destroySearchMatchLayer(ctx.searchMatchLayer);
      // destroy(removeView, opts) — true tears down the WebGL context and
      // releases textures we own; atlases manage their own lifecycle.
      ctx.app?.destroy(true, { children: true });
      ctxRef.current = null;
    };
  }, [data, atlases]);

  // Light context swap when only class/ascendancy changes. If `mount` hasn't
  // resolved yet (initial paint), the heavy effect picks up the latest props
  // from `propsRef` when it does — no double-swap. Otherwise call directly.
  useEffect(() => {
    propsRef.current = { className, ascendancyId };
    ctxRef.current?.swapContext?.(className, ascendancyId);
  }, [className, ascendancyId]);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />;
}
