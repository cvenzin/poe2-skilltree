import { FederatedPointerEvent, type EventBoundary, type FederatedEvent } from 'pixi.js';

/** Pixi listens for document-level movement and window-level releases, even
 * over DOM controls. Filter before hit-testing so menus, dialogs and touch
 * tooltips own their gestures without stopping native scrolling or UI events. */
export function attachCanvasInputGuard(canvas: HTMLCanvasElement, boundary: EventBoundary): () => void {
  const owners = new Map<number, { canvas: boolean }>();
  const down = (event: PointerEvent) => {
    owners.set(event.pointerId, { canvas: event.target === canvas });
  };
  const release = (event: PointerEvent) => {
    const owner = owners.get(event.pointerId);
    // Keep ownership through Pixi's window capture and any canvas listeners.
    // A new press reusing the ID must survive an earlier release's cleanup.
    queueMicrotask(() => {
      if (owners.get(event.pointerId) === owner) owners.delete(event.pointerId);
    });
  };
  const original = boundary.mapEvent;
  const guarded = (event: FederatedEvent) => {
    const native = event.nativeEvent;
    if (native) {
      const owner = event instanceof FederatedPointerEvent ? owners.get(event.pointerId) : undefined;
      if (owner && !owner.canvas) return;
      // Canvas drags need their outside release to clear Pixi/viewport press
      // state. Unowned movement over DOM overlays must never hit-test nodes.
      const canvasRelease = owner?.canvas && (event.type === 'pointerupoutside' || event.type === 'pointercancel');
      if (native.target !== canvas && !canvasRelease) return;
    }
    original.call(boundary, event);
  };
  boundary.mapEvent = guarded;
  window.addEventListener('pointerdown', down, true);
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  return () => {
    if (boundary.mapEvent === guarded) boundary.mapEvent = original;
    window.removeEventListener('pointerdown', down, { capture: true });
    window.removeEventListener('pointerup', release, { capture: true });
    window.removeEventListener('pointercancel', release, { capture: true });
    owners.clear();
  };
}
