import 'pixi.js/events';
import { Container, EventBoundary, FederatedPointerEvent, Rectangle } from 'pixi.js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { attachCanvasInputGuard } from '../src/render/tree/canvasInputGuard';
import { attachNodeInteraction } from '../src/render/tree/nodeInteraction';
import { buildPathingContext } from '../src/interaction/pathingContext';
import type { MountContext } from '../src/render/tree/types';
import { useStore } from '../src/state/store';
import { makeTree } from './fixtures/tree';

beforeEach(() => useStore.setState(useStore.getInitialState(), true));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  const win = new EventTarget();
  vi.stubGlobal('window', win);
  const canvas = new EventTarget() as HTMLCanvasElement;
  const overlay = new EventTarget();
  const root = new Container();
  root.eventMode = 'static'; root.hitArea = new Rectangle(0, 0, 500, 500);
  const data = makeTree();
  useStore.setState({ className: 'Witch', status: { kind: 'ready', version: 'test', data, atlases: {} as never } });
  const ctx = { gestureActive: false, lastGestureEndAt: -Infinity, hoverPreviewDependencies: null,
    pathing: buildPathingContext(data, '1', null, new Set(['1']), useStore.getState().allocation) } as MountContext;
  for (const [key, x] of [['3', 50], ['5', 100]] as const) {
    const wrap = new Container(); wrap.position.set(x, 50);
    wrap.hitArea = new Rectangle(-15, -15, 30, 30);
    root.addChild(wrap); wrap.worldTransform.set(1, 0, 0, 1, x, 50);
    attachNodeInteraction(wrap, key, data, ctx);
  }
  const boundary = new EventBoundary(root);
  const original = boundary.mapEvent;
  const detach = attachCanvasInputGuard(canvas, boundary);
  const hitTest = vi.spyOn(boundary, 'hitTest');
  const viewportMove = vi.fn(); root.on('pointermove', viewportMove);
  const send = (type: string, target: EventTarget, x = 50, pointerType = 'touch', id = 1) => {
    const native = Object.assign(new Event(type, { cancelable: true }), { pointerId: id, pointerType });
    Object.defineProperty(native, 'target', { value: target });
    const event = new FederatedPointerEvent(boundary);
    event.type = type === 'pointerup' && target !== canvas ? 'pointerupoutside' : type;
    event.pointerId = id; event.pointerType = pointerType;
    event.client.set(x, 50); event.global.copyFrom(event.client);
    event.nativeEvent = native as unknown as PointerEvent;
    // Window down precedes Pixi's document/canvas listeners. Pixi's window
    // up is registered first; the guard must retain ownership through it.
    if (type === 'pointerdown') win.dispatchEvent(native);
    boundary.mapEvent(event);
    if (type === 'pointerup' || type === 'pointercancel') win.dispatchEvent(native);
    target.dispatchEvent(native);
    return native;
  };
  const tap = (x = 50, pointerType = 'touch') => {
    send('pointerdown', canvas, x, pointerType); send('pointerup', canvas, x, pointerType);
  };
  return { win, canvas, overlay, boundary, original, detach, hitTest, viewportMove, send, tap, ctx,
    dispose: () => { detach(); root.destroy({ children: true }); } };
}

it.each(['touch', 'mouse', 'pen'])('ignores %s movement over DOM controls before hit-testing or viewport dispatch', (type) => {
  const s = setup();
  try {
    s.tap();
    const state = useStore.getState();
    s.hitTest.mockClear(); s.viewportMove.mockClear();
    s.send('pointermove', s.overlay, 100, type);
    expect(s.hitTest).not.toHaveBeenCalled();
    expect(s.viewportMove).not.toHaveBeenCalled();
    expect(useStore.getState().hovered).toBe(state.hovered);
    expect(useStore.getState().previewPath).toBe(state.previewPath);
    expect(useStore.getState().allocation).toBe(state.allocation);
    expect(useStore.getState().past).toBe(state.past);
  } finally { s.dispose(); }
});

it.each(['pointerup', 'pointercancel'])('keeps overlay touch ownership across canvas crossings until %s, then permits a fresh tap', async (end) => {
  const s = setup();
  try {
    s.tap(); // Arm the existing node's allocation preview.
    const before = useStore.getState();
    const nativeMovement = vi.fn(); s.overlay.addEventListener('pointermove', nativeMovement);
    s.send('pointerdown', s.overlay);
    s.hitTest.mockClear(); s.viewportMove.mockClear();
    const move = s.send('pointermove', s.overlay, 100);
    s.send('pointermove', s.canvas, 100);
    s.send(end, s.canvas, 100);
    expect(nativeMovement).toHaveBeenCalledOnce();
    expect(move.defaultPrevented).toBe(false); // Native overlay scrolling remains available.
    expect(s.hitTest).not.toHaveBeenCalled();
    expect(s.viewportMove).not.toHaveBeenCalled();
    expect(useStore.getState().hovered).toBe(before.hovered);
    expect(useStore.getState().previewPath).toBe(before.previewPath);
    expect(useStore.getState().allocation).toBe(before.allocation);
    expect(useStore.getState().past).toBe(before.past);
    await Promise.resolve();
    s.send('pointermove', s.canvas, 100);
    expect(useStore.getState().hovered?.nodeKey).toBe('5');
    s.tap(100);
    expect(useStore.getState().hovered?.nodeKey).toBe('5');
    expect(useStore.getState().allocation).toBe(before.allocation);
    s.tap(100);
    expect([...useStore.getState().allocation.shared]).toEqual(['2', '3', '5']);
  } finally { s.dispose(); }
});

it('does not let a queued release clear a newer overlay gesture using the same pointer ID', async () => {
  const s = setup();
  try {
    s.send('pointerdown', s.overlay);
    s.send('pointerup', s.overlay);
    s.send('pointerdown', s.overlay);
    await Promise.resolve();
    s.hitTest.mockClear();
    s.send('pointermove', s.canvas, 100);
    expect(s.hitTest).not.toHaveBeenCalled();
    expect(useStore.getState().hovered).toBeNull();
  } finally { s.dispose(); }
});

it('does not mix a menu finger into an active canvas gesture', () => {
  const s = setup();
  try {
    s.send('pointerdown', s.canvas);
    s.send('pointerdown', s.overlay, 100, 'touch', 2);
    s.hitTest.mockClear();
    s.send('pointermove', s.canvas, 100, 'touch', 2);
    s.send('pointerup', s.canvas, 100, 'touch', 2);
    expect(s.hitTest).not.toHaveBeenCalled();
    s.send('pointermove', s.canvas);
    expect(s.viewportMove).toHaveBeenCalledOnce();
  } finally { s.dispose(); }
});

it('allows a canvas press to release outside and cancel its armed node action', async () => {
  const s = setup();
  try {
    s.tap();
    expect(s.ctx.activationPreview).not.toBeNull();
    s.send('pointerdown', s.canvas);
    s.send('pointerup', s.overlay);
    expect(s.ctx.activationPreview).toBeNull();
    expect(useStore.getState().hovered).toBeNull();
    expect(useStore.getState().allocation.shared.size).toBe(0);
    await Promise.resolve();
    s.tap();
    expect(useStore.getState().allocation.shared.size).toBe(0);
    s.tap();
    expect([...useStore.getState().allocation.shared]).toEqual(['2', '3']);
  } finally { s.dispose(); }
});

it('removes ownership listeners and restores the original boundary on teardown', () => {
  const s = setup();
  try {
    const remove = vi.spyOn(s.win, 'removeEventListener');
    s.detach();
    expect(s.boundary.mapEvent).toBe(s.original);
    expect(remove.mock.calls.map(([type]) => type)).toEqual(['pointerdown', 'pointerup', 'pointercancel']);
  } finally { s.dispose(); }
});
