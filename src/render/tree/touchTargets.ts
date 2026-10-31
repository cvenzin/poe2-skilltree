import { Rectangle } from 'pixi.js';
import type { MountContext } from './types';
import { useStore } from '../../state/store';

export const TOUCH_TARGET_SIZE = 44;
const TAP_MOVE_TOLERANCE = 5; // CSS pixels; any excursion cancels tap feedback.
interface TouchCandidate { key: string; direct: boolean; distance: number }
/** Artwork wins over neighboring padding. A near miss needs a clearly closer
 * node (6 CSS px); a genuinely ambiguous tap asks for zoom rather than guessing. */
export function chooseTouchTarget(candidates: readonly TouchCandidate[]): { key: string | null; ambiguous: boolean } {
  const direct = candidates.filter((c) => c.direct);
  if (direct.length === 1) return { key: direct[0]!.key, ambiguous: false };
  if (direct.length > 1) return { key: null, ambiguous: true };
  const nearby = [...candidates].sort((a, b) => a.distance - b.distance);
  if (!nearby[0]) return { key: null, ambiguous: false };
  if (nearby[1] && nearby[1].distance - nearby[0].distance < 6) return { key: null, ambiguous: true };
  return { key: nearby[0].key, ambiguous: false };
}

export function attachTouchTargets(canvas: HTMLCanvasElement, ctx: MountContext): () => void {
  const originals = new WeakMap<object, Rectangle>();
  const pointers = new Set<number>();
  let lastType = '';
  let ambiguousTap: { id: number; x: number; y: number; gestureEndAt: number } | null = null;
  const down = (e: PointerEvent) => {
    if (e.target !== canvas) return;
    pointers.add(e.pointerId);
    ambiguousTap = null;
    ctx.touchTargetAmbiguous = false;
    const touch = e.pointerType === 'touch';
    lastType = e.pointerType;
    if (touch && pointers.size > 1) {
      ctx.gestureActive = true;
      ctx.activationPreview = null;
      useStore.getState().dismissInspection();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const screen = { x: (e.clientX - rect.left) * (ctx.app?.screen.width ?? rect.width) / rect.width,
      y: (e.clientY - rect.top) * (ctx.app?.screen.height ?? rect.height) / rect.height };
    const candidates: TouchCandidate[] = [];
    const expanded = new Map<string, Rectangle>();
    for (const [key, wrap] of ctx.nodeWraps) {
      if (!(wrap.hitArea instanceof Rectangle)) continue;
      if (!originals.has(wrap)) originals.set(wrap, wrap.hitArea.clone());
      const original = originals.get(wrap)!;
      const scale = Math.abs(wrap.getGlobalTransform().a) || 1;
      const width = touch ? Math.max(original.width, TOUCH_TARGET_SIZE / scale) : original.width;
      const height = touch ? Math.max(original.height, TOUCH_TARGET_SIZE / scale) : original.height;
      const area = new Rectangle(original.x + (original.width - width) / 2, original.y + (original.height - height) / 2, width, height);
      wrap.hitArea = original.clone();
      if (touch && wrap.visible && wrap.eventMode !== 'none') {
        const local = wrap.toLocal(screen);
        const direct = original.contains(local.x, local.y);
        const distance = Math.hypot(local.x - original.x - original.width / 2, local.y - original.y - original.height / 2) * scale;
        if (direct || (area.contains(local.x, local.y) && distance <= TOUCH_TARGET_SIZE / 2)) {
          candidates.push({ key, direct, distance });
          expanded.set(key, area);
        }
      }
    }
    const target = chooseTouchTarget(candidates);
    ctx.touchTargetAmbiguous = touch && target.ambiguous;
    if (touch && target.key) {
      const wrap = ctx.nodeWraps.get(target.key);
      if (wrap) wrap.hitArea = expanded.get(target.key)!;
    } else if (touch) useStore.getState().dismissInspection();
    if (ctx.touchTargetAmbiguous) {
      ctx.activationPreview = null;
      useStore.getState().dismissInspection();
      // A finger-down may become a pan or pinch. Only explain a completed tap.
      ambiguousTap = { id: e.pointerId, x: e.clientX, y: e.clientY, gestureEndAt: ctx.lastGestureEndAt };
    }
  };
  const movedFromTap = (e: PointerEvent) => ambiguousTap !== null &&
    (Math.abs(e.clientX - ambiguousTap.x) > TAP_MOVE_TOLERANCE || Math.abs(e.clientY - ambiguousTap.y) > TAP_MOVE_TOLERANCE);
  const move = (e: PointerEvent) => {
    if (ambiguousTap?.id === e.pointerId && movedFromTap(e)) ambiguousTap = null;
    if (e.pointerType === 'touch' || lastType !== 'touch') return;
    lastType = e.pointerType;
    ctx.touchTargetAmbiguous = false;
    for (const wrap of ctx.nodeWraps.values()) {
      const original = originals.get(wrap);
      if (original) wrap.hitArea = original.clone();
    }
  };
  const up = (e: PointerEvent) => {
    if (ambiguousTap?.id === e.pointerId) {
      const rect = canvas.getBoundingClientRect();
      const onCanvas = e.clientX >= rect.left && e.clientX < rect.left + rect.width &&
        e.clientY >= rect.top && e.clientY < rect.top + rect.height;
      if (e.type === 'pointerup' && onCanvas && !movedFromTap(e) && pointers.size === 1 &&
        !ctx.gestureActive && ctx.lastGestureEndAt === ambiguousTap.gestureEndAt) {
        useStore.getState().setValidationMessage('Tap closer to a node or zoom in to select it.');
      }
      ambiguousTap = null;
    }
    const beganOnCanvas = pointers.delete(e.pointerId);
    if (ctx.gestureActive && pointers.size === 0) {
      ctx.gestureActive = false;
      ctx.lastGestureEndAt = performance.now();
    }
    if (e.type === 'pointercancel' && beganOnCanvas) {
      ctx.activationPreview = null;
      ctx.lastGestureEndAt = performance.now();
      useStore.getState().dismissInspection();
    }
  };
  // Pixi installs its canvas capture listener during app.init(). Preprocess on
  // an ancestor so hit areas and ambiguity are ready before Pixi hit-tests down.
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointermove', move, true);
  const wheel = () => { ctx.activationPreview = null; useStore.getState().dismissInspection(); };
  const contextMenu = (event: Event) => event.preventDefault();
  canvas.addEventListener('wheel', wheel, true);
  canvas.addEventListener('contextmenu', contextMenu);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', up, true);
  return () => {
    window.removeEventListener('pointerdown', down, true);
    window.removeEventListener('pointermove', move, true);
    canvas.removeEventListener('wheel', wheel, true);
    canvas.removeEventListener('contextmenu', contextMenu);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', up, true);
    pointers.clear();
    ambiguousTap = null;
  };
}
