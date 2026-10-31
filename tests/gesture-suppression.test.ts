import { Container, EventBoundary, FederatedPointerEvent } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import { beforeEach, expect, it, vi } from 'vitest';
import { attachGestureSuppression, attachNodeInteraction } from '../src/render/tree/nodeInteraction';
import type { MountContext } from '../src/render/tree/types';
import { buildPathingContext } from '../src/render/tree/pathingContext';
import { useStore } from '../src/state/store';
import { makeTree } from './fixtures/tree';

beforeEach(() => useStore.setState(useStore.getInitialState(), true));

function setup() {
  const vp = new Viewport({ screenWidth: 390, screenHeight: 844, worldWidth: 10000, worldHeight: 10000,
    noTicker: true, events: { domElement: { addEventListener: vi.fn(), removeEventListener: vi.fn() } } as never });
  vp.drag({ mouseButtons: 'left' }).pinch({ percent: 1 });
  const data = makeTree();
  const ctx = { gestureActive: false, lastGestureEndAt: -Infinity, hoverPreviewDependencies: null,
    pathing: buildPathingContext(data, '1', null, new Set(['1']), useStore.getState().allocation) } as MountContext;
  attachGestureSuppression(vp, ctx);
  const node = new Container();
  attachNodeInteraction(node, '3', data, ctx);
  const send = (kind: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', id: number, x: number, y = 100) => {
    const event = new FederatedPointerEvent(new EventBoundary());
    event.pointerType = 'touch'; event.pointerId = id; event.global.set(x, y); event.client.set(x, y);
    vp.emit(kind, event);
    return event;
  };
  return { vp, ctx, node, send };
}

it('keeps suppressing through a pinch followed by continued one-finger dragging, then recovers', () => {
  const { vp, ctx, node, send } = setup();
  send('pointerdown', 1, 100);
  send('pointermove', 1, 130);
  expect(ctx.gestureActive).toBe(true);
  send('pointerdown', 2, 200);
  send('pointermove', 1, 140);
  send('pointermove', 2, 220);
  expect(ctx.gestureActive).toBe(true);
  send('pointerup', 2, 220);
  send('pointermove', 1, 160);
  expect(ctx.gestureActive).toBe(true);
  node.emit('pointerover', send('pointermove', 1, 180));
  expect(useStore.getState().hovered).toBeNull();
  send('pointerup', 1, 180);
  expect(ctx.gestureActive).toBe(false);
  node.destroy(); vp.destroy();
});

it.each(['pointerup', 'pointercancel'] as const)('recovers when a second finger interrupts a drag without moving (%s)', (end) => {
  const { vp, ctx, node, send } = setup();
  send('pointerdown', 1, 100);
  send('pointermove', 1, 130);
  expect(ctx.gestureActive).toBe(true);
  send('pointerdown', 2, 200);
  send(end, 2, 200);
  send(end, 1, 130);
  expect(vp.input.count()).toBe(0);
  expect(ctx.gestureActive).toBe(false);
  node.emit('pointerover', send('pointermove', 1, 130));
  expect(useStore.getState().hovered?.nodeKey).toBe('3');
  node.destroy(); vp.destroy();
});
