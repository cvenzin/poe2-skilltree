import type { PathingContext } from '../../interaction/pathingContext';
import type { Allocation, AllocationMode } from '../../state/allocation';
import { Application, Container } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
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

export interface HoverPreviewDependencies {
  inspectionRevision: number;
  nodeKey: string;
  activeVersion: string | null;
  className: string | null;
  ascendancyId: string | null;
  allocation: Allocation;
  allocationMode: AllocationMode;
  pathing: PathingContext | null;
}

export interface MountContext {
  touchTargetAmbiguous?: boolean;
  removeTouchTargets?: () => void;
  removeCanvasInputGuard?: () => void;
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
  /** Keys of drawn main-tree and ascendancy wraps with an `unlockConstraint`. Iterated
   *  on every allocation change to toggle visibility/interactivity in
   *  {@link applyConstraintVisibility}. Ascendancy keys are replaced on context swaps. */
  constrainedWraps: Set<string>;
  /** Last applied state per node — drives the rebuild diff in
   *  {@link applyNodeStates}. Updated atomically with the wrap's children. */
  nodeStates: Map<string, string>;
  /** Edge-redraw closures, called on every state change. Overlay redraw is
   *  null when no ascendancy is selected. */
  redrawMainEdges: EdgeRedraw | null;
  redrawOverlayEdges: EdgeRedraw | null;
  /** Mastery pattern layer redraw — swaps each pattern's texture between the
   *  active and inactive variants when allocation changes. Patterns are
   *  decorative anchors at mastery-node positions; the layer is non-interactive. */
  redrawMasteries: MasteryRedraw | null;
  /** Single-mesh cyan-ring overlay sits above nodes. Focus and zoom update
   *  uniforms; the pulse runs on the ticker — alpha 0.6 ↔ 1.0 @ ~1 Hz. */
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
  /** Default fitted camera scale used to size edge strokes in CSS pixels. */
  edgeReferenceScale: number;
  /** Snapshot of `prefers-reduced-motion: reduce` at mount time. When true:
   *  - Pan inertia is disabled (decelerate skipped).
   *  - Wheel zoom is not animated.
   *  - Programmatic camera animations snap (time: 0).
   *  - The search-match alpha pulse stays at a constant value. */
  reduceMotion: boolean;
  /** Detach the pulse ticker callback in destroy. */
  removeTickerCallback: (() => void) | null;
  /** Wake rendering after a scene change, including asynchronously loaded art. */
  requestRender: (() => void) | null;
  /** Stop the render loop and detach its input/visibility listeners. */
  removeRenderLoop: (() => void) | null;
  /** Unsubscribe handle for the store-subscription set up in {@link mount}. */
  unsubscribeStore: (() => void) | null;
  /** Class/ascendancy-derived pathing state. Rewritten in place by
   *  {@link swapContext} so the permanent interaction handlers always read
   *  the current values without needing to re-attach. */
  pathing: PathingContext | null;
  /** One current-hover cache; individual node listeners must not retain old pathing contexts. */
  hoverPreviewDependencies: HoverPreviewDependencies | null;
  /** First activation, distinct from hover; invalidated by target/context changes or gestures. */
  activationPreview: HoverPreviewDependencies | null;
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
