import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import 'pixi.js/events';
import { Container, EventBoundary, FederatedPointerEvent, Rectangle } from 'pixi.js';
import { attachTouchTargets } from '../src/render/tree/touchTargets';
import { attachNodeInteraction } from '../src/render/tree/nodeInteraction';
import { buildPathingContext } from '../src/interaction/pathingContext';
import type { MountContext } from '../src/render/tree/types';
import { useStore } from '../src/state/store';
import { makeTree } from './fixtures/tree';

beforeEach(() => useStore.setState(useStore.getInitialState(), true));
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const data = makeTree();
  useStore.setState({ className: 'Witch', status: { kind: 'ready', version: 'test', data, atlases: {} as never } });
  const canvas = new EventTarget() as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 500 }) as DOMRect;
  const win = new EventTarget();
  vi.stubGlobal('window', win);
  const root = new Container();
  root.eventMode = 'static';
  root.hitArea = new Rectangle(0, 0, 500, 500);
  const wraps = new Map(['3', '5'].map((key, i) => {
    const wrap = new Container();
    const x = 50 + i * 40;
    wrap.position.set(x, 50);
    wrap.hitArea = new Rectangle(-5, -5, 10, 10);
    root.addChild(wrap);
    // Supply the world transform normally produced by the renderer.
    wrap.worldTransform.set(1, 0, 0, 1, x, 50);
    return [key, wrap] as const;
  }));
  const ctx = { nodeWraps: wraps, gestureActive: false, lastGestureEndAt: -Infinity,
    pathing: buildPathingContext(data, '1', null, new Set(['1']), useStore.getState().allocation) } as MountContext;
  for (const [key, wrap] of wraps) attachNodeInteraction(wrap, key, data, ctx);
  const boundary = new EventBoundary(root);
  const mapPointer = (native: Event) => {
    const pointer = native as PointerEvent;
    const event = new FederatedPointerEvent(boundary);
    event.type = pointer.type; event.pointerType = pointer.pointerType; event.pointerId = pointer.pointerId;
    event.global.set(pointer.clientX, pointer.clientY);
    event.client.copyFrom(event.global);
    boundary.mapEvent(event);
  };
  // Match EventSystem's registration order: Pixi initializes first, listening
  // for down on the canvas and up on window, both in the capture phase.
  canvas.addEventListener('pointerdown', mapPointer, true);
  win.addEventListener('pointerup', mapPointer, true);
  const detach = attachTouchTargets(canvas, ctx);
  const send = (type: string, x: number, pointerType = 'touch', target: EventTarget = canvas) => {
    const event = Object.assign(new Event(type), { pointerId: 1, pointerType, clientX: x, clientY: 50 });
    Object.defineProperty(event, 'target', { value: target });
    // Node's EventTarget has no DOM ancestry. Model browser capture order:
    // window receives the event before its canvas descendant.
    win.dispatchEvent(event);
    if (type === 'pointerdown') target.dispatchEvent(event);
  };
  const tap = (x: number, pointerType = 'touch') => {
    send('pointerdown', x, pointerType);
    send('pointerup', x, pointerType);
  };
  return { ctx, wraps, tap, send, detach, dispose: () => {
    detach(); root.destroy({ children: true });
  } };
}

it('previews the first tap inside padding and allocates on the second tap', () => {
  const scene = setup();
  try {
    scene.tap(62); // 12px from the centre: outside 10px artwork, inside 44px target.
    expect(useStore.getState().hovered?.nodeKey).toBe('3');
    expect(useStore.getState().previewPath).toEqual(['2', '3']);
    expect(useStore.getState().allocation.shared.size).toBe(0);
    scene.tap(62);
    expect([...useStore.getState().allocation.shared]).toEqual(['2', '3']);
    expect(useStore.getState().past).toHaveLength(1);
  } finally { scene.dispose(); }
});

it('clears ambiguity before processing the next direct tap', () => {
  const scene = setup();
  try {
    scene.tap(70); // Equidistant from both nodes.
    expect(scene.ctx.touchTargetAmbiguous).toBe(true);
    expect(useStore.getState().hovered).toBeNull();
    scene.tap(50);
    expect(scene.ctx.touchTargetAmbiguous).toBe(false);
    expect(useStore.getState().previewPath).toEqual(['2', '3']);
    scene.tap(50);
    expect([...useStore.getState().allocation.shared]).toEqual(['2', '3']);
  } finally { scene.dispose(); }
});

it('restores mouse hit areas before hit-testing a press without a preceding move', () => {
  const scene = setup();
  try {
    scene.tap(62);
    scene.tap(62, 'mouse');
    expect(useStore.getState().allocation.shared.size).toBe(0);
    scene.tap(50, 'mouse');
    expect([...useStore.getState().allocation.shared]).toEqual(['2', '3']);
  } finally { scene.dispose(); }
});

it('ignores presses outside the canvas and removes the ancestor listener on teardown', () => {
  const scene = setup();
  try {
    scene.tap(62);
    const inspected = useStore.getState().hovered;
    scene.send('pointerdown', 300, 'touch', new EventTarget());
    expect(useStore.getState().hovered).toBe(inspected);
    expect(scene.ctx.gestureActive).toBe(false);
    scene.detach();
    scene.send('pointerdown', 300);
    expect(useStore.getState().hovered).toBe(inspected);
  } finally { scene.dispose(); }
});
