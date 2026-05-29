import { useEffect, useRef } from 'react';
import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  TilingSprite,
} from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type { Edge, TreeData, TreeNode } from '../data/types';
import { type AtlasBundle, getFrame, classBackgroundName } from './atlas';
import { spritesForNode, type NodeState } from './frameForNode';
import { drawMasteries, type MasteryRedraw } from './drawMasteries';
import { useStore } from '../state/store';
import { startNodeKeyForClass, pruneConstraintLocked, computeConstraintHiddenKeys, isUnlockConstraintSatisfied } from '../data/normalize';
import {
  bfsShortestPath,
  buildBlockedKeys,
  cascadeUnallocate,
  computeEntwinedAllocatableKeys,
  isEntwinedRealitiesActive,
  MEDIUM_RADIUS,
  autoOptionsForPath,
  isMcOption,
  hubOfOption,
  optionsOfHub,
} from '../interaction/pathing';

interface TreeCanvasProps {
  data: TreeData;
  atlases: AtlasBundle;
  /** Resolved class name (must match a `data.classes[].name`) — drives the initial camera target. */
  className: string;
  /** When set, the matching ascendancy is rendered centred on the main tree.
   *  Other ascendancies (and their edges) are hidden entirely. */
  ascendancyId: string | null;
}

interface WorldSize {
  width: number;
  height: number;
  minX: number;
  minY: number;
}

const MAX_ZOOM = 6;
/**
 * Extra world-space padding past the outermost node. Has to cover:
 *   - the ascendancy backdrop discs (~1500 px radius)
 *   - the largest node frame (~110 px) drawn at the edge
 *   - a bit of breathing room so clamp doesn't feel jammed
 */
const WORLD_PADDING = 1800;

/**
 * Mounts a Pixi v8 Application + pixi-viewport, draws:
 *   - tiled background
 *   - every edge (curved arc when the edge carries `orbitX/orbitY`, straight
 *     line otherwise — see {@link traceEdge})
 *   - every node as `(frame ← icon)` sprites in unallocated state
 *   - the selected ascendancy as a separate centred overlay
 *
 * Pan/zoom matches INSTRUCTIONS.md §6:
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
  propsRef.current = { className, ascendancyId };

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
    ctxRef.current?.swapContext?.(className, ascendancyId);
  }, [className, ascendancyId]);

  return <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />;
}

/** Repaints an edge group with three state-coloured Graphics layers. Bound
 *  to a specific group's container at creation time; call it whenever
 *  `allocated` / `previewPath` changes. */
type EdgeRedraw = (allocated: ReadonlySet<string>, previewPath: readonly string[] | null) => void;

/** Class/ascendancy-derived state read live (via the ctx ref) by the
 *  permanent main-tree node interaction handlers and the main-tree edge
 *  redraw. Rewritten by {@link swapContext} when the user switches class or
 *  ascendancy — no node re-attachment needed. */
interface PathingContext {
  classStartKey: string;
  /** Currently selected ascendancy id (or null). Stashed here so the constraint
   *  prune step at click-time can evaluate `unlockConstraint.ascendancy` without
   *  re-reading the store inside the handler. */
  ascendancyId: string | null;
  blockedKeys: ReadonlySet<string>;
  frontierKeys: ReadonlySet<string>;
  /** Constraint-locked node keys that are currently hidden (e.g. Druid Oracle's
   *  Forbidden Path nodes when "The Unseen Path" isn't allocated). Renderer
   *  uses this to toggle wrap.visible and filter edges; pathing already has
   *  these blocked via blockedKeys. */
  hiddenKeys: ReadonlySet<string>;
  /** Main-tree non-keystone nodes that "Entwined Realities" lets the player
   *  click without a connecting path. Empty unless the notable is allocated on
   *  Druid Oracle and at least one keystone is allocated. Recomputed in
   *  {@link refreshConstraintState} so click/hover handlers see the current
   *  allowed set without rescanning the tree on every event. */
  entwinedKeys: ReadonlySet<string>;
  /** True when "Entwined Realities" (Druid Oracle) is currently allocated.
   *  Drives keystone-hover behaviour (show the medium-radius ring) even when
   *  no keystones are yet allocated and `entwinedKeys` is therefore empty. */
  entwinedActive: boolean;
}

interface MountContext {
  cancelled: boolean;
  /** True while the viewport is being actively panned (drag) or pinch-zoomed.
   *  Gates node hit-detection so finger gestures don't flicker the tooltip,
   *  recompute preview paths, or fire an accidental allocate/unallocate. */
  gestureActive: boolean;
  /** performance.now() of the last drag/pinch end. A brief tap-suppression
   *  window after a gesture catches the pointertap a finger-lift can fire on
   *  the node under the release point. */
  lastGestureEndAt: number;
  app: Application | null;
  viewport: Viewport | null;
  observer: ResizeObserver | null;
  /** Every drawn node wrap, keyed by node key. Used by the store-subscription
   *  to swap atlas textures when state changes (idle → preview → allocated). */
  nodeWraps: Map<string, Container>;
  /** Keys of drawn main-tree wraps that carry an `unlockConstraint`. Iterated
   *  on every allocation change to toggle visibility/interactivity in
   *  {@link applyConstraintVisibility}. Built once in {@link drawNodes}. */
  constrainedWraps: Set<string>;
  /** Last applied state per node — drives the rebuild diff in
   *  {@link applyNodeStates}. Updated atomically with the wrap's children. */
  nodeStates: Map<string, NodeState>;
  /** Edge-redraw closures, called on every state change. Overlay redraw is
   *  null when no ascendancy is selected. */
  redrawMainEdges: EdgeRedraw | null;
  redrawOverlayEdges: EdgeRedraw | null;
  /** Mastery pattern layer redraw — swaps each pattern's texture between the
   *  active and inactive variants when allocation changes. Patterns are
   *  decorative anchors at mastery-node positions; the layer is non-interactive. */
  redrawMasteries: MasteryRedraw | null;
  /** Cyan-ring overlay layer (one Graphics per matched node), sits above
   *  nodes. Pulse animation runs on the ticker — alpha 0.6 ↔ 1.0 @ ~1 Hz. */
  searchMatchLayer: Container | null;
  /** Jewel-radius preview layer — when the user hovers a jewel socket, draws
   *  a circle showing the socket's radius and highlights any nodes listed in
   *  `keystonesInRadius`. Empty when nothing relevant is hovered. */
  jewelOverlay: Container | null;
  /** Violet rings around the active constraint gate and every node it unlocks.
   *  Currently driven by Druid Oracle's "The Unseen Path" + its 200 Forbidden
   *  Path nodes. Empty when no gate is satisfied. Rebuilt on every allocation
   *  change via {@link applyUnlockHighlight}. */
  unlockHighlightLayer: Container | null;
  /** The wrap currently scaled up as the hover-target (1.05×). Reset to 1.0
   *  when hover moves to a different node so we don't leave stale-scaled
   *  wraps behind. */
  hoverScaledWrap: Container | null;
  /** Reference into worldContainer so search ring world-positions can be
   *  computed via `worldContainer.toLocal(wrap.getGlobalPosition())` — works
   *  uniformly for main-tree and ascendancy-overlay nodes. */
  worldContainer: Container | null;
  /** Cached fit-to-screen scale — the camera-framing floor for search. */
  fitScale: number;
  /** Snapshot of `prefers-reduced-motion: reduce` at mount time. When true:
   *  - Pan inertia is disabled (decelerate skipped).
   *  - Wheel zoom is not animated.
   *  - Programmatic camera animations snap (time: 0).
   *  - The search-match alpha pulse stays at a constant value. */
  reduceMotion: boolean;
  /** Detach the pulse ticker callback in destroy. */
  removeTickerCallback: (() => void) | null;
  /** Detach the `visibilitychange` listener that pauses the ticker on
   *  hidden tabs (§10.7). */
  removeVisibilityListener: (() => void) | null;
  /** Unsubscribe handle for the store-subscription set up in {@link mount}. */
  unsubscribeStore: (() => void) | null;
  /** Class/ascendancy-derived pathing state. Rewritten in place by
   *  {@link swapContext} so the permanent interaction handlers always read
   *  the current values without needing to re-attach. */
  pathing: PathingContext | null;
  /** Dedicated containers for the class/ascendancy-dependent layers. Kept in
   *  worldContainer across class/ascendancy switches — only their contents
   *  are cleared and re-drawn, avoiding a WebGL context teardown. */
  backdropLayer: Container | null;
  mainCircleLayer: Container | null;
  ascendancyLayer: Container | null;
  /** Node keys added to `nodeWraps` by the current ascendancy overlay. Removed
   *  from `nodeWraps` and `nodeStates` whenever the overlay is rebuilt so a
   *  previous ascendancy's keys don't leak into search / state updates. */
  ascendancyNodeKeys: Set<string>;
  /** Push-current-state to the renderer (node textures + all three edge
   *  layers + masteries). Set after mount finishes so {@link swapContext}
   *  can trigger a repaint with the new pathing context. */
  applyAll: ((allocated: ReadonlySet<string>, previewPath: readonly string[] | null) => void) | null;
  /** Imperatively re-applies the class/ascendancy-dependent layers — called
   *  by the second effect on prop changes. Null until mount finishes. */
  swapContext: ((className: string, ascendancyId: string | null) => void) | null;
  /** Bumped on every {@link swapContext}. A lazy class-background load captures
   *  the value at request time and only redraws if it's still current — so a
   *  fast class switch doesn't paint a stale backdrop when its load lands. */
  swapGeneration: number;
}

/**
 * For each registered wrap, compute its desired visual state from the store
 * (allocated > preview > idle) and rebuild its sprite contents with the
 * appropriate atlas variant — but only when the state actually changed.
 *
 * Texture swapping (not tinting) is what gives PoE's correct look: the
 * allocated frames are pre-rendered bright gold, the can-allocate frames
 * are pre-rendered intense blue, the idle frames are dim. The change is
 * lightweight in practice — only the path nodes near the cursor flip on
 * hover, ~10-30 rebuilds at most.
 */
function applyNodeStates(
  data: TreeData,
  atlases: AtlasBundle,
  wraps: ReadonlyMap<string, Container>,
  prevStates: Map<string, NodeState>,
  allocated: ReadonlySet<string>,
  previewPath: readonly string[] | null
): void {
  const previewSet = previewPath ? new Set(previewPath) : null;
  for (const [key, wrap] of wraps) {
    const next = computeNodeState(key, allocated, previewSet);
    if (prevStates.get(key) === next) continue;
    const node = data.nodes[key];
    if (!node) continue;
    rebuildSpriteContents(wrap, node, atlases, next);
    prevStates.set(key, next);
  }
}

function computeNodeState(
  key: string,
  allocated: ReadonlySet<string>,
  preview: ReadonlySet<string> | null
): NodeState {
  if (allocated.has(key)) return 'allocated';
  if (preview?.has(key)) return 'preview';
  return 'idle';
}

/** Recompute the constraint-derived parts of `ctx.pathing` from the latest
 *  allocation. Cheap (O(constrained-node count + main-tree node count)); called
 *  on every allocation change because constraints can flip when a gate node is
 *  added or removed. Preserves the existing `ascendancyId` and `classStartKey`
 *  — those only change in {@link swapContext}. */
function refreshConstraintState(
  ctx: MountContext,
  data: TreeData,
  allocated: ReadonlySet<string>,
): void {
  if (!ctx.pathing) return;
  const { classStartKey, ascendancyId, frontierKeys } = ctx.pathing;
  const hiddenKeys = computeConstraintHiddenKeys(data, ascendancyId, allocated);
  ctx.pathing = {
    classStartKey,
    ascendancyId,
    frontierKeys,
    blockedKeys: buildBlockedKeys(data, classStartKey, ascendancyId, allocated),
    hiddenKeys,
    entwinedKeys: computeEntwinedAllocatableKeys(data, allocated, ascendancyId, hiddenKeys),
    entwinedActive: isEntwinedRealitiesActive(data, allocated, ascendancyId),
  };
}

/** Toggle wrap visibility for constraint-locked nodes. Hidden wraps lose all
 *  interactivity (`eventMode = 'none'`) so they can't intercept pointer events
 *  meant for the empty space they occupy. Constraint-locked nodes never reach
 *  the visible/interactive state unless their gate is allocated. */
function applyConstraintVisibility(ctx: MountContext): void {
  const hidden = ctx.pathing?.hiddenKeys;
  if (!hidden) return;
  for (const key of ctx.constrainedWraps) {
    const wrap = ctx.nodeWraps.get(key);
    if (!wrap) continue;
    const isHidden = hidden.has(key);
    wrap.visible = !isHidden;
    wrap.eventMode = isHidden ? 'none' : 'static';
  }
}

/**
 * Per-tree-state visuals for search (INSTRUCTIONS.md §6 search-overlay block):
 *   - Cyan ring sprites around every matched node, pulsed via the ticker
 *     (alpha handled in the ticker callback, not here).
 *   - Non-matched node wraps dim to 0.35 alpha while a search is active;
 *     full alpha when the match set is empty.
 *
 * Ring positions are computed via `worldContainer.toLocal(wrap.getGlobalPosition())`
 * so the same code path handles main-tree nodes (children of worldContainer)
 * and ascendancy-overlay nodes (children of the overlay's transformed
 * container) without needing the ascendancy transform here.
 */
function applySearchHighlight(
  matches: readonly string[],
  cursor: number,
  wraps: ReadonlyMap<string, Container>,
  layer: Container,
  worldContainer: Container,
  viewportScale: number,
): void {
  const matchSet = new Set(matches);
  const dim = matchSet.size > 0;
  for (const [key, wrap] of wraps) {
    wrap.alpha = dim && !matchSet.has(key) ? 0.35 : 1;
  }

  for (const child of [...layer.children]) child.destroy({ children: true });
  layer.removeChildren();

  const focusedKey = cursor >= 0 ? matches[cursor] : null;
  for (const key of matches) {
    const wrap = wraps.get(key);
    if (!wrap) continue;
    // Defence in depth — SearchInput already pre-filters constraint-hidden
    // matches, but if a stale match leaks through (race between allocation
    // change and search re-run) don't ring an invisible node.
    if (!wrap.visible) continue;
    const isFocused = key === focusedKey;
    const pos = worldContainer.toLocal(wrap.getGlobalPosition());
    // Size the ring to the node's own visual bounds (notables, keystones,
    // and jewel sockets are all different diameters) plus a small visible
    // gap outside the frame.
    const radius = ringRadiusForWrap(wrap);
    const ring = new Graphics() as SearchRing;
    // Stash the geometry so the zoom listener can redraw the stroke without
    // re-measuring bounds or re-resolving the focused match.
    ring._ringMeta = { x: pos.x, y: pos.y, radius, focused: isFocused };
    drawSearchRing(ring, viewportScale);
    // Don't let the ring intercept clicks meant for the node underneath.
    ring.eventMode = 'none';
    layer.addChild(ring);
  }

  // Reset alpha so the pulse re-takes effect on the next ticker tick.
  layer.alpha = 1;
}

/** Base stroke widths in *screen* pixels. The world-space width is divided by
 *  the current viewport scale on draw so the ring stays equally visible at
 *  every zoom level (otherwise it would shrink to a hairline when zoomed out). */
const SEARCH_RING_WIDTH = 3;
const SEARCH_RING_FOCUSED_WIDTH = 5;

type SearchRing = Graphics & {
  _ringMeta: { x: number; y: number; radius: number; focused: boolean };
};

function drawSearchRing(ring: SearchRing, viewportScale: number): void {
  const { x, y, radius, focused } = ring._ringMeta;
  const baseWidth = focused ? SEARCH_RING_FOCUSED_WIDTH : SEARCH_RING_WIDTH;
  ring.clear()
    .circle(x, y, radius)
    .stroke({ color: 0x40e0e0, width: baseWidth / viewportScale, alpha: 1 });
}

/** Redraw every ring's stroke for the current zoom. Called from the pulse
 *  ticker whenever `viewport.scale.x` changes so the rings keep a constant
 *  on-screen thickness regardless of zoom level. */
function refreshSearchRingStrokes(layer: Container, viewportScale: number): void {
  for (const child of layer.children) {
    drawSearchRing(child as SearchRing, viewportScale);
  }
}

/** Distance from a node's centre to where its cyan search-match ring should
 *  sit. Uses the wrap's local bounds (frame + icon) and adds a fixed visible
 *  gap so the ring clears the frame ornaments. */
const SEARCH_RING_GAP = 10;
function ringRadiusForWrap(wrap: Container): number {
  const b = wrap.getLocalBounds();
  // Half-diagonal of the bbox approximates the worst-case node radius —
  // works whether the frame is square (normal) or wider (notable/keystone).
  const halfMax = Math.max(b.width, b.height) / 2;
  return halfMax + SEARCH_RING_GAP;
}

/** Read the user's `prefers-reduced-motion: reduce` setting at mount time.
 *  We don't live-update on change — reloading the page picks up a flip. */
function prefersReducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/** Scale applied to the wrap currently under the cursor (the hover-target,
 *  INSTRUCTIONS.md §6). Subtle enough to read as "this is the click target"
 *  without making nearby nodes look misplaced. */
const HOVER_TARGET_SCALE = 1.08;

/** Toggle the 1.08× scale-up on the hovered wrap. Resets the previously
 *  hovered wrap back to 1.0 so we don't leave stale-scaled nodes behind.
 *  Returns the new "currently scaled" wrap (or null if no node is hovered).
 *  Snap (not tweened) for v1 — animating would need ticker bookkeeping. */
function applyHoverScale(
  wraps: ReadonlyMap<string, Container>,
  prevScaled: Container | null,
  nextKey: string | null,
): Container | null {
  if (prevScaled) prevScaled.scale.set(1);
  if (!nextKey) return null;
  const wrap = wraps.get(nextKey);
  if (!wrap) return null;
  wrap.scale.set(HOVER_TARGET_SCALE);
  return wrap;
}

/** Jewel radii in world units. The 0.5.0 export doesn't ship per-socket radius
 *  metadata, so we draw all three (Small / Medium / Large) — same values PoE 1
 *  used and the magnitudes that match the distances in `keystonesInRadius`.
 *  Each tier gets its own colour so the player can read which radius covers
 *  which nearby nodes. */
const JEWEL_RADIUS_SMALL = 800;
const JEWEL_RADIUS_MEDIUM = 1200;
const JEWEL_RADIUS_LARGE = 1500;
const JEWEL_RING_SMALL_COLOR = 0x80ffc0;
const JEWEL_RING_MEDIUM_COLOR = 0xa0e0ff;
const JEWEL_RING_LARGE_COLOR = 0xff90b0;
const KEYSTONE_RING_COLOR = 0xffd66a;

/** Bright violet for the constraint-gate / unlocked-node highlight. Chosen to
 *  contrast with the gold allocated-node frames and the cyan search rings, so
 *  the relationship is unambiguous at a glance. */
const UNLOCK_RING_COLOR = 0xc060ff;
const UNLOCK_RING_WIDTH = 5;
const UNLOCK_RING_ALPHA = 0.95;

function addRadiusRing(
  layer: Container,
  centre: { x: number; y: number },
  radius: number,
  color: number,
): void {
  const ring = new Graphics()
    .circle(centre.x, centre.y, radius)
    .stroke({ color, width: 4, alpha: 0.6 });
  ring.eventMode = 'none';
  layer.addChild(ring);
}

/**
 * Draw the radius preview around a hovered jewel socket. When the socket has
 * `keystonesInRadius`, also draw a small ring around each affected keystone
 * so the player sees what would be triggered by socketing a jewel here.
 *
 * Position via `worldContainer.toLocal(wrap.getGlobalPosition())` so the
 * overlay works uniformly for main-tree and ascendancy-overlay nodes.
 * Cleared whenever a non-socket node is hovered (or hover ends).
 */
function applyJewelOverlay(
  hovered: { nodeKey: string } | null,
  data: TreeData,
  wraps: ReadonlyMap<string, Container>,
  layer: Container,
  worldContainer: Container,
  pathing: PathingContext | null,
): void {
  for (const child of [...layer.children]) child.destroy({ children: true });
  layer.removeChildren();
  if (!hovered) return;
  const node = data.nodes[hovered.nodeKey];
  if (!node) return;
  const wrap = wraps.get(hovered.nodeKey);
  if (!wrap) return;

  // Keystone hover, Entwined Realities allocated → visualise the Medium Radius
  // that defines which non-keystone passives become free-allocatable. Drawn in
  // the same violet as the unlock-highlight rings so it reads as the same
  // mechanic. Works for any keystone (allocated or not) for build planning.
  if (node.isKeystone && pathing?.entwinedActive) {
    const pos = worldContainer.toLocal(wrap.getGlobalPosition());
    const ring = new Graphics()
      .circle(pos.x, pos.y, MEDIUM_RADIUS)
      .stroke({ color: UNLOCK_RING_COLOR, width: 4, alpha: 0.55 });
    ring.eventMode = 'none';
    layer.addChild(ring);
    return;
  }

  if (!node.isJewelSocket) return;

  const pos = worldContainer.toLocal(wrap.getGlobalPosition());

  // Draw Large first so the inner rings paint on top — useful when one
  // tier's stroke happens to overlap a notable/keystone the player is reading.
  addRadiusRing(layer, pos, JEWEL_RADIUS_LARGE, JEWEL_RING_LARGE_COLOR);
  addRadiusRing(layer, pos, JEWEL_RADIUS_MEDIUM, JEWEL_RING_MEDIUM_COLOR);
  addRadiusRing(layer, pos, JEWEL_RADIUS_SMALL, JEWEL_RING_SMALL_COLOR);

  if (!node.keystonesInRadius) return;
  for (const skillId of node.keystonesInRadius) {
    const key = data.nodeBySkillId.get(skillId);
    if (!key) continue;
    const kWrap = wraps.get(key);
    if (!kWrap) continue;
    if (!kWrap.visible) continue; // skip constraint-hidden keystones

    const kPos = worldContainer.toLocal(kWrap.getGlobalPosition());
    const highlight = new Graphics()
      .circle(kPos.x, kPos.y, ringRadiusForWrap(kWrap))
      .stroke({ color: KEYSTONE_RING_COLOR, width: 6, alpha: 0.95 });
    highlight.eventMode = 'none';
    layer.addChild(highlight);
  }
}

/** Paint violet rings around constraint-gate nodes and every node they unlock,
 *  whenever the gate is satisfied. Driven by Druid Oracle's "The Unseen Path"
 *  in 0.5.0 — the notable plus the 200 Forbidden Path nodes it reveals all
 *  get the same ring, making the relationship obvious at a glance.
 *
 *  Idempotent on layer contents: clears and rebuilds every call. Cheap — at
 *  most ~201 single-stroke Graphics in 0.5.0. */
function applyUnlockHighlight(
  ctx: MountContext,
  data: TreeData,
  allocated: ReadonlySet<string>,
): void {
  const layer = ctx.unlockHighlightLayer;
  const worldContainer = ctx.worldContainer;
  if (!layer || !worldContainer) return;
  destroyChildren(layer);

  const ascendancyId = ctx.pathing?.ascendancyId ?? null;
  if (data.constrainedNodeKeys.size === 0) return;

  const ringKeys = new Set<string>();
  for (const key of data.constrainedNodeKeys) {
    const constraint = data.nodes[key]?.unlockConstraint;
    if (!constraint) continue;
    if (!isUnlockConstraintSatisfied(constraint, ascendancyId, allocated, data)) continue;
    ringKeys.add(key);
    for (const skillId of constraint.nodes) {
      const gateKey = data.nodeBySkillId.get(skillId);
      if (gateKey) ringKeys.add(gateKey);
    }
  }
  if (ringKeys.size === 0) return;

  for (const key of ringKeys) {
    const wrap = ctx.nodeWraps.get(key);
    if (!wrap || !wrap.visible) continue;
    const pos = worldContainer.toLocal(wrap.getGlobalPosition());
    const ring = new Graphics()
      .circle(pos.x, pos.y, ringRadiusForWrap(wrap))
      .stroke({ color: UNLOCK_RING_COLOR, width: UNLOCK_RING_WIDTH, alpha: UNLOCK_RING_ALPHA });
    ring.eventMode = 'none';
    layer.addChild(ring);
  }
}

const SEARCH_MAX_ZOOM = 2.5;
const SEARCH_PADDING_FRACTION = 0.15;

/**
 * Camera transitions tied to search state changes. Three cases:
 *   1. Search just became non-empty (`prev.searchQuery === '' && next != ''`):
 *      capture the camera into `preSearchCamera` so Esc can restore it.
 *   2. Matches or cursor changed (with matches > 0): frame the bbox of the
 *      relevant subset (cursor-focused = single node, else all matches),
 *      capped by `SEARCH_MAX_ZOOM`, floored at fit-to-screen.
 *   3. Search just cleared (`prev.searchQuery !== '' && next === ''`) AND a
 *      `preSearchCamera` snapshot exists: animate back to it.
 */
function handleSearchCameraTransition(
  vp: Viewport,
  world: WorldSize,
  fitScale: number,
  wraps: ReadonlyMap<string, Container>,
  worldContainer: Container,
  reduceMotion: boolean,
  prev: { searchQuery: string; searchMatches: readonly string[]; searchCursor: number; preSearchCamera: { x: number; y: number; scale: number } | null },
  next: { searchQuery: string; searchMatches: readonly string[]; searchCursor: number; preSearchCamera: { x: number; y: number; scale: number } | null },
): void {
  const becameActive = prev.searchQuery === '' && next.searchQuery !== '';
  const becameCleared = prev.searchQuery !== '' && next.searchQuery === '';
  const subsetChanged =
    next.searchQuery !== '' &&
    (prev.searchMatches !== next.searchMatches || prev.searchCursor !== next.searchCursor);

  if (becameActive) {
    // Capture current camera once, on the rising edge. The store ignores
    // re-captures while a snapshot is already set, so repeated calls are safe.
    useStore.getState().capturePreSearchCamera({
      x: vp.center.x,
      y: vp.center.y,
      scale: vp.scale.x,
    });
  }

  if (becameCleared && prev.preSearchCamera) {
    vp.animate({
      position: { x: prev.preSearchCamera.x, y: prev.preSearchCamera.y },
      scale: prev.preSearchCamera.scale,
      time: reduceMotion ? 0 : 350,
      ease: 'easeInOutCubic',
    });
    return;
  }

  if ((becameActive || subsetChanged) && next.searchMatches.length > 0) {
    frameCameraOnMatches(vp, world, fitScale, wraps, worldContainer, reduceMotion, next.searchMatches, next.searchCursor);
  }
}

function frameCameraOnMatches(
  vp: Viewport,
  world: WorldSize,
  fitScale: number,
  wraps: ReadonlyMap<string, Container>,
  worldContainer: Container,
  reduceMotion: boolean,
  matches: readonly string[],
  cursor: number,
): void {
  const keys = cursor >= 0
    ? (matches[cursor] !== undefined ? [matches[cursor] as string] : [])
    : matches;
  const points: { x: number; y: number }[] = [];
  for (const key of keys) {
    const wrap = wraps.get(key);
    if (!wrap) continue;
    const p = worldContainer.toLocal(wrap.getGlobalPosition());
    points.push({ x: p.x, y: p.y });
  }
  if (points.length === 0) return;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);
  const padX = w * SEARCH_PADDING_FRACTION;
  const padY = h * SEARCH_PADDING_FRACTION;
  const boxW = w + 2 * padX;
  const boxH = h + 2 * padY;
  let scale = Math.min(vp.screenWidth / boxW, vp.screenHeight / boxH);
  scale = Math.min(scale, SEARCH_MAX_ZOOM);
  scale = Math.max(scale, fitScale);

  // worldContainer is at position (-world.minX, -world.minY) inside the
  // viewport, so a worldContainer-local point (cx, cy) lives at viewport
  // coord (cx - world.minX, cy - world.minY). vp.animate's `position` is in
  // viewport coords.
  const centerX = (minX + maxX) / 2 - world.minX;
  const centerY = (minY + maxY) / 2 - world.minY;
  vp.animate({
    position: { x: centerX, y: centerY },
    scale,
    time: reduceMotion ? 0 : 500,
    ease: 'easeInOutCubic',
  });
}

function rebuildSpriteContents(
  wrap: Container,
  node: TreeNode,
  atlases: AtlasBundle,
  state: NodeState
): void {
  wrap.removeChildren();
  const sprites = spritesForNode(node, state);
  if (sprites.icon) addSprite(wrap, atlases, sprites.icon.atlas, sprites.icon.key, placeholderDot());
  if (sprites.frame) addSprite(wrap, atlases, sprites.frame.atlas, sprites.frame.key, null);
}

async function mount(
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
  const applyAll = (allocated: ReadonlySet<string>, previewPath: readonly string[] | null) => {
    refreshConstraintState(ctx, data, allocated);
    applyNodeStates(data, atlases, ctx.nodeWraps, ctx.nodeStates, allocated, previewPath);
    applyConstraintVisibility(ctx);
    ctx.redrawMainEdges?.(allocated, previewPath);
    ctx.redrawOverlayEdges?.(allocated, previewPath);
    ctx.redrawMasteries?.(allocated);
    applyUnlockHighlight(ctx, data, allocated);
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
    if (s.allocated !== prev.allocated || s.previewPath !== prev.previewPath) {
      applyAll(s.allocated, s.previewPath);
    }
    if (s.searchMatches !== prev.searchMatches || s.searchCursor !== prev.searchCursor) {
      applySearchHighlight(s.searchMatches, s.searchCursor, ctx.nodeWraps, searchMatchLayer, worldContainer, viewport.scale.x);
    }
    // Redraw the radius overlay when either the hovered node OR the Entwined-
    // active flag flips. The pathing context is already refreshed by applyAll
    // above, so `ctx.pathing.entwinedActive` is current.
    if (s.hovered !== prev.hovered || s.allocated !== prev.allocated) {
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

interface NodeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Bbox of the *visible main tree* — every positioned, non-ascendancy node.
 *  Used as the initial-fit target so the camera doesn't open zoomed-out over
 *  the padded world (which has to cover the 1500 px ascendancy backdrop discs
 *  and frame ornaments). Returns null when no qualifying node exists. */
function computeMainTreeBounds(data: TreeData): NodeBounds | null {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let count = 0;
  for (const [key, node] of Object.entries(data.nodes)) {
    if (key === 'root') continue;
    if (node.ascendancyId) continue;
    if (node.x === undefined || node.y === undefined) continue;
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
    count++;
  }
  if (count === 0) return null;
  return { minX, maxX, minY, maxY };
}

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
 * ascendancy. The store has already cleared the allocation by the time we get
 * here (see store.ts `setClass` / `setAscendancy`), so the redraw at the end
 * paints the fresh tree with nothing allocated.
 */
function swapContext(
  ctx: MountContext,
  data: TreeData,
  atlases: AtlasBundle,
  className: string,
  ascendancyId: string | null,
): void {
  const generation = ++ctx.swapGeneration;

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
  const allocated = useStore.getState().allocated;
  const blockedKeys = buildBlockedKeys(data, classStartKey, ascendancyId, allocated);
  const hiddenKeys = computeConstraintHiddenKeys(data, ascendancyId, allocated);
  const entwinedKeys = computeEntwinedAllocatableKeys(data, allocated, ascendancyId, hiddenKeys);
  const entwinedActive = isEntwinedRealitiesActive(data, allocated, ascendancyId);
  const frontierKeys = new Set<string>([classStartKey]);
  const ascStartKey = findAscendancyStartKey(data, ascendancyId);
  if (ascStartKey) frontierKeys.add(ascStartKey);
  ctx.pathing = { classStartKey, ascendancyId, blockedKeys, frontierKeys, hiddenKeys, entwinedKeys, entwinedActive };

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
  ctx.applyAll?.(state.allocated, state.previewPath);
  // Clear any stale hover/search remnants tied to the old ascendancy's nodes.
  if (ctx.jewelOverlay && ctx.worldContainer) {
    applyJewelOverlay(state.hovered, data, ctx.nodeWraps, ctx.jewelOverlay, ctx.worldContainer, ctx.pathing);
  }
  if (ctx.searchMatchLayer && ctx.worldContainer && ctx.viewport) {
    applySearchHighlight(state.searchMatches, state.searchCursor, ctx.nodeWraps, ctx.searchMatchLayer, ctx.worldContainer, ctx.viewport.scale.x);
  }
}

function destroyChildren(layer: Container | null): void {
  if (!layer) return;
  for (const child of [...layer.children]) child.destroy({ children: true });
  layer.removeChildren();
}

async function createPixiApp(host: HTMLDivElement): Promise<Application> {
  const app = new Application();
  await app.init({
    resizeTo: host,
    antialias: true,
    backgroundAlpha: 0,           // page background bleeds through
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    preference: 'webgl',          // WebGPU is not yet widely available
  });
  return app;
}

function createViewport(app: Application, world: WorldSize): Viewport {
  const vp = new Viewport({
    screenWidth: app.renderer.width,
    screenHeight: app.renderer.height,
    worldWidth: world.width,
    worldHeight: world.height,
    events: app.renderer.events,
  });
  app.stage.addChild(vp);
  return vp;
}

/**
 * `data.min_x/max_x/min_y/max_y` in 0.5.0 covers the main tree but a chunk of
 * ascendancy nodes sit ~500 px past those bounds, plus the ascendancy backdrop
 * discs extend further. Walk every node ourselves and pad generously.
 */
function computeWorldBounds(data: TreeData): WorldSize {
  let minX = data.min_x, maxX = data.max_x, minY = data.min_y, maxY = data.max_y;
  for (const node of Object.values(data.nodes)) {
    if (node.x === undefined || node.y === undefined) continue;
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
  }
  minX -= WORLD_PADDING; maxX += WORLD_PADDING;
  minY -= WORLD_PADDING; maxY += WORLD_PADDING;
  return { width: maxX - minX, height: maxY - minY, minX, minY };
}

function drawBackground(parent: Container, atlases: AtlasBundle, world: WorldSize): void {
  const tex = getFrame(atlases, 'background', 'background:Background2');
  const bg = new TilingSprite({ texture: tex, width: world.width, height: world.height });
  // Parent shifts (-minX, -minY); cancel that so the tile origin aligns with
  // the actual world origin.
  bg.position.set(world.minX, world.minY);
  // Pure decoration — never intercept clicks meant for nodes / edges above it.
  bg.eventMode = 'none';
  parent.addChild(bg);
}

/**
 * Render the currently-selected ascendancy's tree (edges + nodes) centred on
 * the main tree (world origin). The ascendancy's nodes keep their relative
 * layout and native size — they're only translated so the start node lands
 * at the panel target. Other ascendancies are hidden.
 *
 * The backdrop disc is rendered by {@link drawAscendancyBackdrop} as an
 * *earlier* layer so main-tree passives that overlap the disc area aren't
 * occluded by it. See INSTRUCTIONS.md §6.
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



interface ClusterInfo {
  nodes: { key: string; node: TreeNode; x: number; y: number }[];
  cx: number;
  cy: number;
}

function collectClusterNodes(data: TreeData, ascId: string): ClusterInfo | null {
  const nodes: ClusterInfo['nodes'] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [key, node] of Object.entries(data.nodes)) {
    if (node.ascendancyId !== ascId) continue;
    if (node.x === undefined || node.y === undefined) continue;
    nodes.push({ key, node, x: node.x, y: node.y });
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
  }
  if (nodes.length === 0) return null;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { nodes, cx, cy };
}

/** Average distance of the 6 class start nodes from the world origin —
 *  the ring radius the central ascendancy disc sits inside of. */
function computeClassStartRingRadius(data: TreeData): number {
  let total = 0;
  let count = 0;
  for (const key of data.startNodeByClassIndex.values()) {
    const node = data.nodes[key];
    if (node?.x === undefined || node.y === undefined) continue;
    total += Math.hypot(node.x, node.y);
    count++;
  }
  return count === 0 ? 1400 : total / count;
}

interface AscendancyLookup {
  cls: import('../data/types').ClassEntry;
  /** Index of the class in `data.classes[]` — used to look up the class start
   *  node via `data.startNodeByClassIndex`. */
  classIdx: number;
  /** Index of the ascendancy within its class's `ascendancies[]`. */
  ascIdx: number;
  asc: import('../data/types').Ascendancy;
}

function findAscendancy(data: TreeData, ascendancyId: string): AscendancyLookup | null {
  for (const classIdx of data.playableClassIndices) {
    const cls = data.classes[classIdx];
    if (!cls) continue;
    const ascIdx = cls.ascendancies.findIndex((a) => a.id === ascendancyId);
    const asc = ascIdx >= 0 ? cls.ascendancies[ascIdx] : undefined;
    if (asc) return { cls, classIdx, ascIdx, asc };
  }
  return null;
}

/**
 * Renders the central class/ascendancy backdrop disc at world origin. Drawn
 * as an early layer so main-tree passives that sit over the disc area aren't
 * occluded by it.
 *
 * Frame layout in each `background-<class>` atlas (verified empirically):
 *   `Class0`              → default class image (no ascendancy chosen)
 *   `Class<asc index +1>` → ascendancy-specific image
 *
 * Witch is the only class with 4 ascendancies (Abyssal Lich is a Witch3b
 * variant) but still has only 4 frames — so the 4th ascendancy falls back to
 * the default class image. The try/catch handles both that case and any
 * other missing-frame oddities.
 */
/** Disc art is sized to the class-start ring diameter — class-start nodes
 *  sit at its outer edge. */
const DISC_TO_RING_RATIO = 1;
/** Frame slightly overshoots the ring so its ornate ornaments wrap *around*
 *  the class-start nodes instead of sitting inside the disc edge. */
const FRAME_TO_RING_RATIO = 1.36;

function drawCentralBackdrop(
  parent: Container,
  atlases: AtlasBundle,
  data: TreeData,
  className: string,
  ascendancyId: string | null
): void {
  const cls = data.classes.find((c) => c.name === className);
  if (!cls) return;
  const atlasName = `background-${cls.name.toLowerCase()}`;
  const frameKey = pickBackdropFrameKey(cls, ascendancyId);

  const tex = tryGetFrame(atlases, atlasName, frameKey)
    ?? tryGetFrame(atlases, atlasName, `class${cls.name}:Class0`); // fallback to default
  if (!tex) return;

  const size = computeClassStartRingRadius(data) * 2 * DISC_TO_RING_RATIO;
  const bg = new Sprite(tex);
  bg.anchor.set(0.5);
  bg.position.set(0, 0);
  bg.width = size;
  bg.height = size;
  // Decoration only — must not absorb clicks meant for the class-start
  // nodes that sit on this disc's outer edge.
  bg.eventMode = 'none';
  parent.addChild(bg);
}

function pickBackdropFrameKey(
  cls: import('../data/types').ClassEntry,
  ascendancyId: string | null
): string {
  const base = `class${cls.name}`;
  if (!ascendancyId) return `${base}:Class0`;
  const ascIdx = cls.ascendancies.findIndex((a) => a.id === ascendancyId);
  // `+ 1` because Class0 is the default class image; ascendancies start at Class1.
  return ascIdx >= 0 ? `${base}:Class${ascIdx + 1}` : `${base}:Class0`;
}

function tryGetFrame(atlases: AtlasBundle, atlasName: string, frameKey: string) {
  try { return getFrame(atlases, atlasName, frameKey); }
  catch { return null; }
}

/** Decorative ring around the central class/ascendancy area. Sized to match
 *  the class disc texture so the frame and disc art read as a single unit.
 *
 *  In-game this is two stacked layers: `MainCircle` is the base ring,
 *  `MainCircleActive` is a glow/highlight overlay rendered on top. Both are
 *  always visible regardless of whether an ascendancy is picked. */
function drawMainCircle(
  parent: Container,
  atlases: AtlasBundle,
  data: TreeData,
  className: string
): void {
  // Frame slightly overshoots the disc so its ornaments wrap around the
  // class-start nodes from outside. Knob: `FRAME_TO_RING_RATIO` above.
  // Layer order (back → front): disc backdrop (drawn by caller) → Active
  // overlay → Normal frame on top. The Active is a glow/highlight that
  // sits underneath the gold ornamental ring.
  //
  // The Active highlight is baked into the texture at the Witch's position
  // (top of the ring). Rotate it so it lines up with the selected class's
  // start node instead. The Normal frame is rotationally symmetric.
  const size = computeClassStartRingRadius(data) * 2 * FRAME_TO_RING_RATIO;
  addRingSprite(parent, atlases, 'startNode:MainCircleActive', size, computeActiveDiscRotation(data, className));
  addRingSprite(parent, atlases, 'startNode:MainCircle', size, 0);
}

function addRingSprite(
  parent: Container,
  atlases: AtlasBundle,
  frameKey: string,
  width: number,
  rotation: number
): void {
  const tex = tryGetFrame(atlases, 'group-background', frameKey);
  if (!tex) return;
  const sprite = new Sprite(tex);
  sprite.anchor.set(0.5);
  sprite.position.set(0, 0);
  sprite.width = width;
  sprite.height = width;
  sprite.rotation = rotation;
  // MainCircle and MainCircleActive are drawn above the nodes layer so their
  // ornamental ring isn't occluded by class-start node frames. Mark them
  // non-interactive so they don't absorb clicks on nodes underneath.
  sprite.eventMode = 'none';
  parent.addChild(sprite);
}

function computeActiveDiscRotation(data: TreeData, className: string): number {
  const ref = classStartAngle(data, 'Witch');
  const target = classStartAngle(data, className);
  if (ref === null || target === null) return 0;
  return target - ref;
}

function classStartAngle(data: TreeData, className: string): number | null {
  const idx = data.classes.findIndex((c) => c.name === className);
  if (idx < 0) return null;
  const key = data.startNodeByClassIndex.get(idx);
  if (!key) return null;
  const n = data.nodes[key];
  if (n?.x === undefined || n.y === undefined) return null;
  return Math.atan2(n.y, n.x);
}

function drawOverlayEdges(
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
  return (allocated, previewPath) => {
    redrawEdgeLayers(layers, data, allocated, previewPath, edgeCtxFrom(ctx), t, shouldDraw);
  };
}

function drawOverlayNodes(
  overlay: Container,
  atlases: AtlasBundle,
  data: TreeData,
  cluster: ClusterInfo,
  ctx: MountContext,
): void {
  for (const entry of cluster.nodes) {
    const wrap = buildNodeSprite(entry.node, atlases);
    if (!wrap) continue;
    wrap.position.set(entry.x - cluster.cx, entry.y - cluster.cy);
    attachNodeInteraction(wrap, entry.key, data, ctx);
    ctx.nodeWraps.set(entry.key, wrap);
    ctx.ascendancyNodeKeys.add(entry.key);
    overlay.addChild(wrap);
  }
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
function drawEdges(
  parent: Container,
  data: TreeData,
  ctx: MountContext,
): EdgeRedraw {
  const layers = makeEdgeLayers(parent);
  return (allocated, previewPath) => {
    redrawEdgeLayers(layers, data, allocated, previewPath, edgeCtxFrom(ctx), identityTransform, isMainTreeEdge);
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

/** Allocate three Graphics in fixed z-order: idle (back) → allocated → preview
 *  (top). Preview is drawn last so its "intense blue" pops over allocated
 *  edges that share endpoints with the frontier. */
function makeEdgeLayers(parent: Container): Record<NodeState, Graphics> {
  const idle = new Graphics();
  const allocated = new Graphics();
  const preview = new Graphics();
  parent.addChild(idle, allocated, preview);
  return { idle, allocated, preview };
}

/** Per-redraw state derived from the current pathing context. Bundled so the
 *  edge redraw stays under the parameter-count lint cap. */
interface EdgeRedrawContext {
  frontierKeys: ReadonlySet<string>;
  hiddenKeys: ReadonlySet<string>;
}

function redrawEdgeLayers(
  layers: Record<NodeState, Graphics>,
  data: TreeData,
  allocated: ReadonlySet<string>,
  previewPath: readonly string[] | null,
  edgeCtx: EdgeRedrawContext,
  transform: CoordTransform,
  shouldDraw: (pair: DrawableEdge) => boolean
): void {
  layers.idle.clear();
  layers.preview.clear();
  layers.allocated.clear();
  const previewSet = previewPath ? new Set(previewPath) : null;

  for (const edge of data.edges) {
    // Drop edges that touch a constraint-hidden node (e.g. Druid Oracle's
    // Forbidden Path clusters when "The Unseen Path" isn't allocated) so we
    // don't render line stubs reaching into empty space.
    if (edgeCtx.hiddenKeys.has(edge.from) || edgeCtx.hiddenKeys.has(edge.to)) continue;
    const pair = resolveDrawableEdge(data.nodes[edge.from], data.nodes[edge.to]);
    if (!pair || !shouldDraw(pair)) continue;
    const state = edgeState(edge.from, edge.to, allocated, edgeCtx.frontierKeys, previewSet);
    traceEdge(layers[state], pair.a, pair.b, edge, transform);
  }

  strokeEdges(layers.idle, 'idle');
  strokeEdges(layers.allocated, 'allocated');
  strokeEdges(layers.preview, 'preview');
}

const identityTransform = { tx: (n: number) => n, ty: (n: number) => n };

interface CoordTransform {
  tx: (n: number) => number;
  ty: (n: number) => number;
}

/** Positioned, drawable view of an edge — narrowed to non-undefined x/y on both
 *  endpoints. Returned as a pair so consumers can pattern-match without juggling
 *  type predicates (which TS only narrows for one parameter). */
interface DrawableEdge {
  a: TreeNode & { x: number; y: number };
  b: TreeNode & { x: number; y: number };
}

/** Resolve an edge's endpoints into a drawable pair, or null if either is missing
 *  positions, is a hidden mastery (PoE 1 leftover), or carries `hideConnection`
 *  (the 12 tribute/cluster-jewel nodes that PoE doesn't draw connection lines for). */
function resolveDrawableEdge(
  a: TreeNode | undefined,
  b: TreeNode | undefined
): DrawableEdge | null {
  if (!a || !b) return null;
  if (a.x === undefined || a.y === undefined || b.x === undefined || b.y === undefined) return null;
  if (a.isMastery || b.isMastery) return null;
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
function traceEdge(
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

/** Per-state edge colours matching the line atlas's pre-rendered variants:
 *  Normal (idle), Intermediate (can-allocate / preview), Active (allocated). */
const EDGE_COLOR = { idle: 0x6e5e3c, preview: 0x5a8eff, allocated: 0xffd66a } as const;
const EDGE_WIDTH = 6;
const EDGE_ALPHA = 0.9;

function strokeEdges(layer: Graphics, state: NodeState): void {
  layer.stroke({ color: EDGE_COLOR[state], width: EDGE_WIDTH, alpha: EDGE_ALPHA });
}

/** Find the start node for the currently-selected ascendancy, or null when
 *  no ascendancy is selected. Linear scan over ~5000 nodes — runs once per
 *  mount, not per frame. */
function findAscendancyStartKey(data: TreeData, ascendancyId: string | null): string | null {
  if (!ascendancyId) return null;
  for (const [key, node] of Object.entries(data.nodes)) {
    if (node.isAscendancyStart && node.ascendancyId === ascendancyId) return key;
  }
  return null;
}

/** Edge state derived from the states of its two endpoints plus implicit
 *  frontier nodes (class start, currently-selected ascendancy start).
 *  Allocated > preview > idle, mirroring node-state precedence. */
function edgeState(
  a: string,
  b: string,
  allocated: ReadonlySet<string>,
  frontierKeys: ReadonlySet<string>,
  previewSet: ReadonlySet<string> | null
): NodeState {
  const aAllocated = frontierKeys.has(a) || allocated.has(a);
  const bAllocated = frontierKeys.has(b) || allocated.has(b);
  if (aAllocated && bAllocated) return 'allocated';
  if (!previewSet) return 'idle';
  const aPreview = previewSet.has(a);
  const bPreview = previewSet.has(b);
  // Both on the preview path, OR one on the preview path and the other in
  // the frontier — this edge is part of what would be committed by a click.
  if ((aPreview || aAllocated) && (bPreview || bAllocated) && (aPreview || bPreview)) {
    return 'preview';
  }
  return 'idle';
}

/** Main-tree nodes only. Ascendancy nodes are drawn by {@link drawAscendancyOverlay}. */
function drawNodes(
  parent: Container,
  atlases: AtlasBundle,
  data: TreeData,
  ctx: MountContext,
): number {
  const layer = new Container();
  parent.addChild(layer);
  let drawn = 0;
  for (const [key, node] of Object.entries(data.nodes)) {
    if (key === 'root') continue;
    if (node.x === undefined || node.y === undefined) continue;
    if (node.ascendancyId) continue; // main tree only

    const wrap = buildNodeSprite(node, atlases);
    if (!wrap) continue;
    wrap.position.set(node.x, node.y);
    attachNodeInteraction(wrap, key, data, ctx);
    ctx.nodeWraps.set(key, wrap);
    if (node.unlockConstraint) ctx.constrainedWraps.add(key);
    layer.addChild(wrap);
    drawn++;
  }
  return drawn;
}

function buildNodeSprite(node: import('../data/types').TreeNode, atlases: AtlasBundle): Container | null {
  const sprites = spritesForNode(node);
  const wrap = new Container();

  // Z-order: icon (square 34×34 art) goes UNDER the frame ring so the frame
  // masks the icon's square corners. Reversed = icon corners stick out and
  // the node looks like a rectangle. Each texture already encodes design-time
  // size via its `orig` rect (atlas loader applies `meta.scale`), so no extra
  // scale is needed here.
  if (sprites.icon) addSprite(wrap, atlases, sprites.icon.atlas, sprites.icon.key, placeholderDot());
  if (sprites.frame) addSprite(wrap, atlases, sprites.frame.atlas, sprites.frame.key, null);

  if (wrap.children.length === 0) return null;

  // Pin a stable hit area at idle-state size. Without this, swapping textures
  // on state change (via `wrap.removeChildren()` + re-add) briefly empties
  // the auto-computed bounds and Pixi fires pointerout → flicker loop.
  // The Allocated and CanAllocate variants are the same dimensions as the
  // Unallocated ones, so this rect stays correct across state swaps.
  const b = wrap.getLocalBounds();
  wrap.hitArea = new Rectangle(b.x, b.y, b.width, b.height);

  return wrap;
}

/**
 * Make a node sprite interactive: hover updates the cursor-anchored tooltip
 * AND computes a preview path; click commits the path (or cascades an
 * unallocate). Pixi's per-sprite event mode is fine at our node count
 * (~1500). If profiling later shows it as a hotspot, swap to a spatial grid
 * (INSTRUCTIONS.md §8).
 *
 * `pointertap` fires only when the down→up sequence doesn't drift, so a
 * drag-pan over a node never accidentally allocates.
 *
 * Handlers read class/ascendancy-derived pathing state from `ctx.pathing` at
 * event time, not at attachment. That lets the user switch class/ascendancy
 * without re-attaching every node's listeners (the main-tree nodes are
 * attached once for the lifetime of the Pixi app).
 */
function attachNodeInteraction(
  wrap: Container,
  nodeKey: string,
  data: TreeData,
  ctx: MountContext,
): void {
  wrap.eventMode = 'static';
  // Ascendancy start nodes are not allocatable in-game — they're implicit
  // when the ascendancy is selected, like the class start node for the
  // main tree. Default cursor to hint that clicking does nothing.
  // Multiple-choice hubs (e.g. "Projectile Proximity Specialisation") are
  // routing nodes — the player picks an option, not the hub itself.
  const isAscStart = data.nodes[nodeKey]?.isAscendancyStart === true;
  const isMcHub = data.nodes[nodeKey]?.isMultipleChoice === true;
  wrap.cursor = isAscStart || isMcHub ? 'default' : 'pointer';

  const onHover = (e: import('pixi.js').FederatedPointerEvent) => {
    // While the user is panning/pinching, ignore the pointermove stream so the
    // tooltip doesn't flicker across every node the finger slides over and we
    // don't burn cycles recomputing preview paths mid-gesture.
    if (ctx.gestureActive) return;
    const state = useStore.getState();
    state.setHovered({
      nodeKey,
      clientX: e.client.x,
      clientY: e.client.y,
    });
    // No preview for: ascendancy start, multiple-choice hub (both
    // unallocatable), already-allocated (preview-as-cascade is later polish).
    if (isAscStart || isMcHub || state.allocated.has(nodeKey)) {
      state.setPreviewPath(null);
      return;
    }
    const pathing = ctx.pathing;
    if (!pathing) return;
    // Entwined Realities short-circuits the connecting-path cost: any
    // Entwined-eligible target previews as a single-node addition, regardless
    // of whether BFS could route through the rest of the tree. The fallback
    // is what makes the notable worth taking — otherwise the player still
    // pays for the chain.
    if (pathing.entwinedKeys.has(nodeKey)) {
      state.setPreviewPath([nodeKey]);
      return;
    }
    const path = bfsShortestPath(data, state.allocated, pathing.classStartKey, nodeKey, pathing.blockedKeys);
    // MC-hub rule: whenever the path crosses an MC hub without a committed
    // option, default to the hub's first option so the user can route past
    // the hub without picking first. The auto-pick is included in the
    // preview alongside the path so the player can see what'll be allocated;
    // they can swap it later by clicking the alternative.
    if (path) {
      const autoOptions = autoOptionsForPath(data, path, state.allocated);
      state.setPreviewPath(autoOptions.length > 0 ? [...path, ...autoOptions] : path);
      return;
    }
    state.setPreviewPath(path);
  };

  wrap.on('pointerover', onHover);
  wrap.on('pointermove', onHover);
  wrap.on('pointerout', () => useStore.getState().setHovered(null));

  // Distinguish quick tap (intentional allocation) from long press (the
  // user dwelling on a node to read the tooltip). Mouse clicks are always
  // honoured — only touch needs the duration filter.
  let pointerDownAt = 0;
  let pointerDownType: string | null = null;
  wrap.on('pointerdown', (e: import('pixi.js').FederatedPointerEvent) => {
    pointerDownAt = performance.now();
    pointerDownType = e.pointerType;
  });

  wrap.on('pointertap', () => {
    // A pan/pinch is in progress, or just ended — don't let the finger-lift
    // commit an allocation on whatever node sits under the release point.
    if (ctx.gestureActive) return;
    if (performance.now() - ctx.lastGestureEndAt < TAP_SUPPRESS_AFTER_GESTURE_MS) return;
    if (isAscStart) return; // ascendancy start is implicit, not allocatable
    if (isMcHub) return;    // multiple-choice hub — players click an option, not the hub
    // 300ms matches the threshold most mobile UIs treat as "quick tap"
    // (Android's onClick fires up to ~500ms, iOS double-tap window is 300ms).
    // Anything longer reads as a deliberate hold for inspection, not a commit.
    if (pointerDownType === 'touch' && performance.now() - pointerDownAt > 300) {
      return;
    }
    const pathing = ctx.pathing;
    if (!pathing) return;
    const state = useStore.getState();
    // Clicking the selected class's own start cascades everything away —
    // every allocated node ultimately roots back to this node, so removing
    // it orphans the whole tree. Lets the user zero-out without reaching
    // for the Reset button; undo still recovers it.
    if (nodeKey === pathing.classStartKey) {
      if (state.allocated.size > 0) state.resetAllocation();
      return;
    }
    if (state.allocated.has(nodeKey)) {
      const cascaded = cascadeUnallocate(
        data,
        state.allocated,
        pathing.frontierKeys,
        nodeKey,
        pathing.ascendancyId,
        pathing.hiddenKeys,
      );
      // If the cascade removes the gate of constraint-locked nodes (e.g. Druid
      // Oracle's "The Unseen Path"), those Forbidden Path nodes aren't graph-
      // reachable from the class start, so cascadeUnallocate won't catch them.
      // Prune by constraint so they drop in the same commit.
      const next = pruneConstraintLocked(cascaded, ctx.pathing?.ascendancyId ?? null, data);
      state.commitAllocation(next);
      return;
    }
    // Entwined Realities: any eligible target allocates as a single node,
    // bypassing BFS entirely. Otherwise BFS would still find a long route
    // through the tree and charge the player for the connecting chain,
    // defeating the whole point of the notable.
    if (pathing.entwinedKeys.has(nodeKey)) {
      const direct = new Set(state.allocated);
      direct.add(nodeKey);
      state.tryAllocate(direct, data);
      return;
    }
    const path = bfsShortestPath(data, state.allocated, pathing.classStartKey, nodeKey, pathing.blockedKeys);
    if (!path || path.length === 0) return;
    // MC-hub rule (b): traversing the hub requires an option to be chosen.
    // Auto-pick the first option of any uncommitted hub on the path so the
    // click goes through; the user can switch options afterward.
    const autoOptions = autoOptionsForPath(data, path, state.allocated);
    const next = new Set(state.allocated);
    for (const option of autoOptions) next.add(option);
    // Skip the ascendancy start if the BFS routed the path through it —
    // it's implicit, never stored in `allocated`, never counted toward the
    // budget. BFS still traverses it so deeper ascendancy nodes remain
    // reachable.
    for (const key of path) {
      if (data.nodes[key]?.isAscendancyStart) continue;
      next.add(key);
      // MC-hub rule (c): only one option per hub. Adding an option evicts
      // any previously-allocated option sibling of the same hub.
      if (isMcOption(data, key)) {
        const hubKey = hubOfOption(data, key);
        if (hubKey) {
          for (const sibling of optionsOfHub(data, hubKey)) {
            if (sibling !== key && state.allocated.has(sibling)) next.delete(sibling);
          }
        }
      }
    }
    state.tryAllocate(next, data);
  });
}

function addSprite(
  parent: Container,
  atlases: AtlasBundle,
  atlasName: string,
  frameKey: string,
  fallback: Graphics | null
): void {
  try {
    const tex = getFrame(atlases, atlasName, frameKey);
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    parent.addChild(s);
  } catch {
    if (fallback) parent.addChild(fallback);
  }
}

function placeholderDot(): Graphics {
  return new Graphics().circle(0, 0, 12).fill({ color: 0x666666 });
}

/** How long after a pan/pinch ends to keep ignoring node taps — covers the
 *  pointertap a finger-lift fires on whatever node sits under the release
 *  point. Short enough that a deliberate tap right after panning still lands. */
const TAP_SUPPRESS_AFTER_GESTURE_MS = 180;

/**
 * Suppress node hit-detection during viewport gestures. pixi-viewport emits
 * `drag-start` / `pinch-start` only once real movement begins (a plain tap
 * never triggers them), so this flips `ctx.gestureActive` for genuine pans and
 * pinches without blocking ordinary taps. Clearing hover/preview on gesture
 * start also kills any tooltip the gesture would otherwise leave flickering.
 */
function attachGestureSuppression(vp: Viewport, ctx: MountContext): void {
  const begin = () => {
    ctx.gestureActive = true;
    const s = useStore.getState();
    if (s.hovered) s.setHovered(null);
    if (s.previewPath) s.setPreviewPath(null);
  };
  const end = () => {
    ctx.gestureActive = false;
    ctx.lastGestureEndAt = performance.now();
  };
  vp.on('drag-start', begin);
  vp.on('pinch-start', begin);
  vp.on('drag-end', end);
  vp.on('pinch-end', end);
}

function configureViewport(vp: Viewport, app: Application, world: WorldSize, reduceMotion: boolean): void {
  const fitScale = computeFitScale(app, world);
  vp.drag({ mouseButtons: 'left' })
    // Reduced motion: kill the wheel smoothing so each tick zooms instantly.
    .wheel({ smooth: reduceMotion ? 0 : 10, percent: 0.1, interrupt: true })
    .pinch({ percent: 1 });
  // Reduced motion: skip drag inertia entirely. Pan stops where the cursor
  // releases instead of gliding.
  if (!reduceMotion) vp.decelerate({ friction: 0.94, bounce: 0.6, minSpeed: 0.01 });
  vp.clampZoom({ minScale: fitScale, maxScale: MAX_ZOOM })
    .clamp({
      left: 0,
      right: world.width,
      top: 0,
      bottom: world.height,
      underflow: 'center',
    });
}

/** Breathing room around the main tree on initial fit (fraction of its bbox). */
const INITIAL_FIT_PADDING = 0.06;

/**
 * Initial camera state on (re)load. If a `saved` camera is supplied (the user
 * just switched class/ascendancy without unmounting the canvas) restore that
 * — clamps already configured on the viewport keep it in range. Otherwise
 * frame the *visible main tree* (not the full padded world, which includes
 * room for ascendancy backdrops). Falls back to `vp.fit(true)` if no main-tree
 * bbox is available.
 */
function setInitialCamera(
  vp: Viewport,
  app: Application,
  world: WorldSize,
  mainTree: NodeBounds | null,
  saved: { x: number; y: number; scale: number } | null,
): void {
  if (saved) {
    vp.scale.set(saved.scale);
    vp.moveCenter(saved.x, saved.y);
    return;
  }
  if (!mainTree) {
    vp.fit(true);
    return;
  }
  const w = mainTree.maxX - mainTree.minX;
  const h = mainTree.maxY - mainTree.minY;
  const fitW = w * (1 + 2 * INITIAL_FIT_PADDING);
  const fitH = h * (1 + 2 * INITIAL_FIT_PADDING);
  const scale = Math.min(app.renderer.width / fitW, app.renderer.height / fitH);
  vp.scale.set(scale);
  // worldContainer is offset by (-world.minX, -world.minY), so a world-space
  // centre (mx, my) lives at viewport coord (mx - world.minX, my - world.minY).
  const cx = (mainTree.minX + mainTree.maxX) / 2 - world.minX;
  const cy = (mainTree.minY + mainTree.maxY) / 2 - world.minY;
  vp.moveCenter(cx, cy);
}

function computeFitScale(app: Application, world: WorldSize): number {
  return Math.min(app.renderer.width / world.width, app.renderer.height / world.height);
}

function attachResizeObserver(
  host: HTMLDivElement,
  app: Application,
  vp: Viewport,
  world: WorldSize,
  ctx: MountContext
): ResizeObserver {
  const ro = new ResizeObserver(() => {
    vp.resize(app.renderer.width, app.renderer.height, world.width, world.height);
    const fitScale = computeFitScale(app, world);
    ctx.fitScale = fitScale;
    vp.clampZoom({ minScale: fitScale, maxScale: MAX_ZOOM });
    // If the window shrank past the current camera state, the tree no longer
    // fits — animate back to fit-to-screen so it stays in view (§10.7).
    if (vp.scale.x < fitScale) {
      vp.animate({
        scale: fitScale,
        time: ctx.reduceMotion ? 0 : 200,
        ease: 'easeInOutCubic',
      });
    }
  });
  ro.observe(host);
  return ro;
}
