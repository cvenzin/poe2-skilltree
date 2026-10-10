import { Container } from 'pixi.js';
import type { TreeData } from '../../data/types';
import type { MountContext, HoverPreviewDependencies } from './types';
import { useStore } from '../../state/store';
import { bfsShortestPath, autoOptionsForPath, applyPathAllocation } from '../../interaction/pathing';
import { isEmptyAllocation, bucketOf, removeKey } from '../../state/allocation';
import type { AllocationMode } from '../../state/allocation';
import type { PathingContext } from './types';
import { Viewport } from 'pixi-viewport';

/**
 * Make a node sprite interactive: hover updates the cursor-anchored tooltip
 * AND computes a preview path; click commits the path (or cascades an
 * unallocate). Pixi's per-sprite event mode is fine at our node count
 * (~1500). If profiling later shows it as a hotspot, swap to a spatial grid.
 *
 * `pointertap` fires only when the down→up sequence doesn't drift, so a
 * drag-pan over a node never accidentally allocates.
 *
 * Handlers read class/ascendancy-derived pathing state from `ctx.pathing` at
 * event time, not at attachment. That lets the user switch class/ascendancy
 * without re-attaching every node's listeners (the main-tree nodes are
 * attached once for the lifetime of the Pixi app).
 */
export function attachNodeInteraction(
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
    const hovered = {
      nodeKey,
      clientX: e.client.x,
      clientY: e.client.y,
    };
    const dependencies = previewDependencies(nodeKey, state, ctx.pathing);
    const targetChanged = state.hovered?.nodeKey !== nodeKey;
    if (!targetChanged && samePreviewDependencies(ctx.hoverPreviewDependencies, dependencies)) {
      // Tooltip coordinates can move on every pointer event. Keep that update
      // separate from the node-target preview so unchanged targets don't
      // rebuild pathing or repaint the tree.
      state.updateHoveredPosition(hovered);
      return;
    }

    ctx.hoverPreviewDependencies = dependencies;
    state.setHoverState(hovered, computePreviewPathForNode(nodeKey, data, ctx.pathing, state.allocationMode));
  };

  wrap.on('pointerover', onHover);
  wrap.on('pointermove', onHover);
  wrap.on('pointerout', () => {
    ctx.hoverPreviewDependencies = null;
    useStore.getState().setHovered(null);
  });

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
    const alloc = state.allocation;
    const mode = state.allocationMode;
    // Clicking the class start while editing the Main tree zeroes everything
    // out (every node ultimately roots here). In a weapon-set edit mode it's a
    // no-op — the start belongs to the main tree.
    if (nodeKey === pathing.classStartKey) {
      if (mode === 'shared' && !isEmptyAllocation(alloc)) state.resetAllocation();
      return;
    }
    const bucket = bucketOf(alloc, nodeKey);
    // The node belongs to a different tree than the one being edited — editing
    // is scoped to the selected tree, so this is a no-op.
    if (bucket !== null && bucket !== mode) return;
    // Allocated in the tree being edited → unallocate it and revalidate. The
    // main tree is shared-only; removing a shared node can orphan weapon-set
    // branches that hung off it (resolveCascade drops them).
    if (bucket === mode) {
      if (data.nodes[nodeKey]?.isGenericAttribute) {
        state.openAttributeEditor({ kind: 'node', nodeKey });
        return;
      }
      // The store settles both connectivity and lost constraint/radius gates
      // before checking whether this removal also loses a needed point bonus.
      state.commitAllocation(removeKey(alloc, nodeKey), data);
      return;
    }
    // Entwined Realities: any eligible target allocates as a single node into
    // the current tree, bypassing BFS entirely.
    if (pathing.blockedByMode[mode].has(nodeKey)) return;
    if (pathing.entwinedKeys.has(nodeKey)) {
      state.tryAllocate(applyPathAllocation(data, alloc, [nodeKey], [], mode), data);
      return;
    }
    // Path the new nodes through the current tree's frontier, not routing
    // through nodes that tree can't use (other set, or — in Main — either set).
    const frontier = pathing.frontierByMode[mode];
    const path = bfsShortestPath(data, frontier, pathing.classStartKey, nodeKey, pathing.blockedByMode[mode]);
    if (!path || path.length === 0) return;
    const autoOptions = autoOptionsForPath(data, path, frontier);
    state.tryAllocate(applyPathAllocation(data, alloc, path, autoOptions, mode), data);
  });
}

function previewDependencies(
  nodeKey: string,
  state: ReturnType<typeof useStore.getState>,
  pathing: PathingContext | null,
): HoverPreviewDependencies {
  return {
    nodeKey,
    activeVersion: state.activeVersion,
    className: state.className,
    ascendancyId: state.ascendancyId,
    allocation: state.allocation,
    allocationMode: state.allocationMode,
    pathing,
  };
}

function samePreviewDependencies(a: HoverPreviewDependencies | null, b: HoverPreviewDependencies): boolean {
  return a !== null && a.nodeKey === b.nodeKey && a.activeVersion === b.activeVersion && a.className === b.className &&
    a.ascendancyId === b.ascendancyId && a.allocation === b.allocation &&
    a.allocationMode === b.allocationMode && a.pathing === b.pathing;
}

/** Derive the preview from the live class, allocation and edit-mode pathing. */
export function computePreviewPathForNode(
  nodeKey: string,
  data: TreeData,
  pathing: PathingContext | null,
  mode: AllocationMode,
): readonly string[] | null {
  const node = data.nodes[nodeKey];
  if (!pathing || !node || node.isAscendancyStart || node.isMultipleChoice || pathing.allAllocated.has(nodeKey)) return null;
  if (pathing.blockedByMode[mode].has(nodeKey)) return null;
  // Entwined Realities allows an eligible target to allocate without a path.
  if (pathing.entwinedKeys.has(nodeKey)) return [nodeKey];

  const frontier = pathing.frontierByMode[mode];
  const path = bfsShortestPath(data, frontier, pathing.classStartKey, nodeKey, pathing.blockedByMode[mode]);
  if (!path) return null;
  const autoOptions = autoOptionsForPath(data, path, frontier);
  return autoOptions.length > 0 ? [...path, ...autoOptions] : path;
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
export function attachGestureSuppression(vp: Viewport, ctx: MountContext): void {
  const begin = () => {
    ctx.gestureActive = true;
    ctx.hoverPreviewDependencies = null;
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
