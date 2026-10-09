import type { Allocation, AllocationMode } from '../../state/allocation';
import { Application, Container } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type { NodeState } from '../frameForNode';
import type { MasteryRedraw } from '../drawMasteries';

export interface WorldSize {
  width: number;
  height: number;
  minX: number;
  minY: number;
}

/** Repaints an edge group, colouring each edge by the bucket of its endpoints
 *  (shared/gold, set1/green, set2/red, plus idle/preview). Bound to a specific
 *  group's container at creation time; call it whenever `allocation` /
 *  `previewPath` changes. */
export type EdgeRedraw = (allocation: Allocation, previewPath: readonly string[] | null) => void;

/** Class/ascendancy-derived state read live (via the ctx ref) by the
 *  permanent main-tree node interaction handlers and the main-tree edge
 *  redraw. Rewritten by {@link swapContext} when the user switches class or
 *  ascendancy — no node re-attachment needed. */
export interface PathingContext {
  classStartKey: string;
  /** Currently selected ascendancy id (or null). Stashed here so the constraint
   *  prune step at click-time can evaluate `unlockConstraint.ascendancy` without
   *  re-reading the store inside the handler. */
  ascendancyId: string | null;
  /** Every allocated node across the three buckets — what the renderer paints
   *  as allocated (both weapon-set trees are always shown). */
  allAllocated: ReadonlySet<string>;
  /** Per edit-mode connectable frontier (`shared` / `shared∪set1` / `shared∪set2`). */
  frontierByMode: Record<AllocationMode, ReadonlySet<string>>;
  /** Per edit-mode blocked-key set — the base blocks plus the weapon-set nodes
   *  that mode can't route through (see {@link blockedForMode}). */
  blockedByMode: Record<AllocationMode, ReadonlySet<string>>;
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

export interface MountContext {
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
   *  hidden tabs. */
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
   *  layers + masteries). Derives the active tree from the weapon-set
   *  allocation. Set after mount finishes so {@link swapContext} can trigger a
   *  repaint with the new pathing context. */
  applyAll: ((allocation: Allocation, previewPath: readonly string[] | null) => void) | null;
  /** Imperatively re-applies the class/ascendancy-dependent layers — called
   *  by the second effect on prop changes. Null until mount finishes. */
  swapContext: ((className: string, ascendancyId: string | null) => void) | null;
  /** Bumped on every {@link swapContext}. A lazy class-background load captures
   *  the value at request time and only redraws if it's still current — so a
   *  fast class switch doesn't paint a stale backdrop when its load lands. */
  swapGeneration: number;
}

export interface NodeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
