import { Container } from 'pixi.js';
import type { FederatedPointerEvent } from 'pixi.js';
import type { TreeData } from '../../data/types';
import type { MountContext, HoverPreviewDependencies, PathingContext } from './types';
import { useStore } from '../../state/store';
import { bfsShortestPath, autoOptionsForPath } from '../../interaction/pathing';
import { bucketOf, type AllocationMode } from '../../state/allocation';
import { proposeNodeEdit } from '../../interaction/nodeActions';
import { Viewport } from 'pixi-viewport';

/** Input type, rather than viewport width, selects tap confirmation. */
export function attachNodeInteraction(wrap: Container, nodeKey: string, data: TreeData, ctx: MountContext): void {
  wrap.eventMode = 'static';
  wrap.cursor = data.nodes[nodeKey]?.isBlighted ? 'help' : 'pointer';
  const inspect = (e: FederatedPointerEvent, explicit = false) => {
    if (ctx.cancelled || ctx.gestureActive || ctx.touchTargetAmbiguous) return;
    const current = useStore.getState();
    if (!explicit && current.hovered?.inputType === 'keyboard') return;
    const pending = useStore.getState().pendingRemoval;
    if (pending) {
      if (!explicit || pending.key === nodeKey) return;
      useStore.getState().dismissInspection();
    }
    const state = useStore.getState();
    const hovered = { nodeKey, clientX: e.client.x, clientY: e.client.y,
      ...(e.pointerType ? { inputType: e.pointerType } : {}) };
    const deps = previewDependencies(nodeKey, state, ctx.pathing);
    if (!samePreviewDependencies(ctx.activationPreview, deps)) ctx.activationPreview = null;
    if (state.hovered?.nodeKey === nodeKey && samePreviewDependencies(ctx.hoverPreviewDependencies, deps)) {
      state.updateHoveredPosition(hovered); return;
    }
    ctx.hoverPreviewDependencies = deps;
    state.setHoverState(hovered, computePreviewPathForNode(nodeKey, data, ctx.pathing, state.allocationMode));
  };
  wrap.on('pointerover', (e: FederatedPointerEvent) => { ctx.hoverPreviewDependencies = null; inspect(e); });
  wrap.on('pointermove', (e: FederatedPointerEvent) => {
    if (ctx.hoverPreviewDependencies && !useStore.getState().hovered) return;
    inspect(e);
  });
  wrap.on('pointerout', () => {
    ctx.hoverPreviewDependencies = null;
    const s = useStore.getState();
    if (s.pendingRemoval || s.hovered?.inputType === 'touch' || s.hovered?.inputType === 'keyboard') return;
    s.dismissInspection();
  });
  let downAt = 0, downType = '', cancelled = true;
  let downDeps: HoverPreviewDependencies | null = null;
  wrap.on('pointerdown', (e: FederatedPointerEvent) => {
    cancelled = e.button > 0 || !!ctx.touchTargetAmbiguous || ctx.gestureActive;
    downAt = performance.now(); downType = e.pointerType;
    downDeps = previewDependencies(nodeKey, useStore.getState(), ctx.pathing);
    if (downType !== 'touch' && !cancelled && (useStore.getState().hovered?.inputType === 'keyboard' || useStore.getState().pendingRemoval)) inspect(e, true);
    if (downType === 'touch' && !cancelled) {
      inspect(e, true);
    }
  });
  const cancel = () => { cancelled = true; ctx.activationPreview = null; useStore.getState().dismissInspection(); };
  wrap.on('pointercancel', cancel);
  wrap.on('pointerupoutside', cancel);
  wrap.on('pointertap', () => {
    if (ctx.cancelled || cancelled || ctx.gestureActive || performance.now() - ctx.lastGestureEndAt < TAP_SUPPRESS_AFTER_GESTURE_MS) return;
    const s = useStore.getState();
    if (s.pendingRemoval) return;
    if (data.nodes[nodeKey]?.isBlighted) return;
    const deps = previewDependencies(nodeKey, s, ctx.pathing);
    if (!samePreviewDependencies(downDeps, deps)) return;
    const touch = downType === 'touch';
    const proposal = proposeNodeEdit(nodeKey, data, s, ctx.pathing);
    const hold = touch && performance.now() - downAt > 300;
    if (hold) {
      ctx.activationPreview = deps;
      return;
    }
    if (typeof proposal === 'string') { s.setValidationMessage(proposal); return; }
    const bucket = bucketOf(s.allocation, nodeKey);
    if (bucket) {
      if (data.nodes[nodeKey]?.isGenericAttribute) s.openAttributeEditor({ kind: 'node', nodeKey });
      else s.requestRemoval(nodeKey, data, touch);
      return;
    }
    if (touch) {
      const confirmed = samePreviewDependencies(ctx.activationPreview, deps) && s.hovered?.nodeKey === nodeKey && s.previewPath !== null;
      ctx.activationPreview = confirmed ? null : deps;
      if (!confirmed) { s.setPreviewPath(proposal.path); return; }
    }
    s.requestNodeAllocation(nodeKey, data);
  });
}

function previewDependencies(
  nodeKey: string,
  state: ReturnType<typeof useStore.getState>,
  pathing: PathingContext | null,
): HoverPreviewDependencies {
  return {
    inspectionRevision: state.inspectionRevision,
    nodeKey,
    activeVersion: state.activeVersion,
    className: state.className,
    ascendancyId: state.ascendancyId,
    allocation: state.allocation,
    allocationMode: state.allocationMode,
    pathing,
  };
}

function samePreviewDependencies(a: HoverPreviewDependencies | null | undefined, b: HoverPreviewDependencies): boolean {
  return a != null && a.inspectionRevision === b.inspectionRevision && a.nodeKey === b.nodeKey && a.activeVersion === b.activeVersion && a.className === b.className &&
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
  if (!pathing || !node || node.isBlighted || node.isAscendancyStart || node.isMultipleChoice || pathing.allAllocated.has(nodeKey)) return null;
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
    ctx.activationPreview = null;
    ctx.hoverPreviewDependencies = null;
    const s = useStore.getState();
    s.dismissInspection();
  };
  const end = () => {
    ctx.gestureActive = false;
    ctx.lastGestureEndAt = performance.now();
  };
  vp.on('drag-start', begin);
  vp.on('pinch-start', begin);
  vp.on('drag-end', end);
  vp.on('pinch-end', end);
  // A second finger can interrupt Drag before Pinch starts. In that sequence
  // pixi-viewport emits neither end event. Its input listeners run first, so
  // the final release/cancel can safely recover suppression from the count.
  const release = () => {
    if (ctx.gestureActive && vp.input.count() === 0) end();
  };
  vp.on('pointerup', release);
  vp.on('pointerupoutside', release);
  vp.on('pointercancel', () => { begin(); release(); });
  vp.on('pointerleave', release);
}
