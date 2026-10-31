import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Container, EventBoundary, FederatedPointerEvent, Point, Ticker, UPDATE_PRIORITY } from 'pixi.js';
import type { Application } from 'pixi.js';
import { createViewport } from '../src/render/tree/viewport';
import { startRenderLoop } from '../src/render/tree/renderLoop';
import { createSearchPulse } from '../src/render/tree/searchPulse';

// Exercise the real Pixi ticker and viewport plugins with a controlled browser
// frame queue. No WebGL is needed to verify camera motion and idle scheduling.
let now: number;
let pending: Map<number, FrameRequestCallback>;
let documentStub: EventTarget & { hidden: boolean };
let cleanup: (() => void) | undefined;

beforeEach(() => {
  now = 1000;
  pending = new Map();
  let id = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => pending.delete(key));
  documentStub = Object.assign(new EventTarget(), { hidden: false });
  vi.stubGlobal('document', documentStub);
});
afterEach(() => {
  cleanup?.(); cleanup = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function frame(refreshRate = 60) {
  now += 1000 / refreshRate;
  const callbacks = [...pending.values()];
  pending.clear();
  for (const callback of callbacks) callback(now);
}
function settle() {
  for (let i = 0; pending.size && i < 300; i++) frame();
  expect(pending.size).toBe(0);
}
function pointer(pointerType: string, x: number, y: number, pointerId = 1) {
  const event = new FederatedPointerEvent(new EventBoundary());
  Object.assign(event, { pointerType, pointerId, button: 0, buttons: 1 });
  event.global.set(x, y);
  return event;
}
function setup(isAnimating = () => false) {
  const ticker = new Ticker();
  const canvas = new EventTarget();
  const stage = new Container();
  const renderer = Object.assign(new EventEmitter(), {
    width: 800, height: 600,
    events: { domElement: canvas, mapPositionToPoint: (point: Point, x: number, y: number) => point.set(x, y) },
  });
  const app = { ticker, canvas, stage, renderer } as unknown as Application;
  const viewport = createViewport(app, { width: 4000, height: 4000, minX: 0, minY: 0 });
  const render = vi.fn(() => ({ x: viewport.x, scale: viewport.scale.x }));
  ticker.add(render, undefined, UPDATE_PRIORITY.LOW);
  const loop = startRenderLoop(app, viewport, isAnimating);
  cleanup = () => {
    loop.destroy();
    // Match Application.destroy: ticker teardown precedes stage children.
    ticker.destroy();
    stage.destroy({ children: true });
    renderer.removeAllListeners();
  };
  return { ticker, canvas, renderer, viewport, render, loop };
}

describe('on-demand canvas rendering', () => {
  it('draws the initial scene, sleeps while idle, and coalesces visual changes into a frame', () => {
    const { render, loop } = setup();
    settle();
    const initial = render.mock.calls.length;
    expect(initial).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) frame();
    expect(render).toHaveBeenCalledTimes(initial);
    loop.requestRender(); loop.requestRender(); loop.requestRender();
    expect(pending.size).toBe(1);
    settle();
    expect(render).toHaveBeenCalledTimes(initial + 1);
  });

  it.each([0, 500])('finishes a %i ms camera animation and paints its final position', (time) => {
    const { viewport, render, loop } = setup();
    settle();
    viewport.animate({ position: { x: 1200, y: 1000 }, scale: 2, time });
    loop.requestRender();
    settle();
    expect(viewport.center.x).toBeCloseTo(1200);
    expect(viewport.center.y).toBeCloseTo(1000);
    expect(render.mock.results.at(-1)?.value).toEqual({ x: viewport.x, scale: 2 });
  });

  it('wakes for wheel input and runs all smoothing steps before sleeping', () => {
    const { viewport, canvas, render } = setup();
    viewport.wheel({ smooth: 10, percent: 0.1 });
    settle();
    render.mockClear();
    canvas.dispatchEvent(Object.assign(new Event('wheel', { cancelable: true }), {
      clientX: 400, clientY: 300, deltaX: 0, deltaY: -100, deltaMode: 0, ctrlKey: false,
    }));
    expect(viewport.scale.x).toBe(1); // smoothing has not run yet
    settle();
    expect(viewport.scale.x).toBeCloseTo(Math.pow(2, 1.1 * 100 / 500));
    expect(render.mock.calls.length).toBeGreaterThanOrEqual(10);
  });

  it('continues pan inertia after release, then stops rendering', () => {
    const { viewport, render } = setup();
    viewport.decelerate({ friction: 0.5, minSpeed: 0.01 });
    settle();
    render.mockClear();
    viewport.plugins.get('decelerate')!.activate({ x: 1 });
    viewport.emit('pointerupoutside', {} as never);
    settle();
    expect(viewport.x).toBeGreaterThan(0);
    expect(viewport.plugins.get('decelerate')!.isActive()).toBe(false);
    expect(render.mock.calls.length).toBeGreaterThan(2);
    expect(render.mock.results.at(-1)?.value.x).toBe(viewport.x);
  });

  it.each(['mouse', 'touch'])('wakes for a %s drag even after holding still', (type) => {
    const { viewport, render } = setup();
    viewport.drag();
    settle();
    viewport.emit('pointerdown', pointer(type, 100, 100));
    settle(); // holding a pointer down alone does not need continuous rendering
    render.mockClear();
    viewport.emit('pointermove', pointer(type, 160, 140));
    settle();
    expect(viewport.x).toBe(60);
    expect(viewport.y).toBe(40);
    expect(render.mock.results.at(-1)?.value.x).toBe(60);
    viewport.emit('pointerup', pointer(type, 160, 140));
    settle();
  });

  it('wakes for pinch zoom after two stationary touch contacts', () => {
    const { viewport, render } = setup();
    viewport.pinch();
    settle();
    viewport.emit('pointerdown', pointer('touch', 200, 200, 1));
    viewport.emit('pointerdown', pointer('touch', 300, 200, 2));
    viewport.emit('pointermove', pointer('touch', 200, 200, 1));
    viewport.emit('pointermove', pointer('touch', 300, 200, 2));
    settle();
    render.mockClear();
    viewport.emit('pointermove', pointer('touch', 400, 200, 2));
    settle();
    expect(viewport.scale.x).toBeGreaterThan(1);
    expect(render.mock.results.at(-1)?.value.scale).toBe(viewport.scale.x);
    viewport.emit('pointerup', pointer('touch', 200, 200, 1));
    viewport.emit('pointerup', pointer('touch', 400, 200, 2));
    settle();
  });

  it('keeps pulsing highlights animated until cleared', () => {
    let pulsing = true;
    const { render, loop } = setup(() => pulsing);
    for (let i = 0; i < 60; i++) frame();
    const animatedFrames = render.mock.calls.length;
    expect(animatedFrames).toBeGreaterThanOrEqual(58);
    expect(animatedFrames).toBeLessThanOrEqual(60);
    expect(pending.size).toBe(1);
    pulsing = false;
    loop.requestRender();
    settle();
    expect(render).toHaveBeenCalledTimes(animatedFrames + 1);
  });

  it('caps an animated scene near 60 FPS on a 360 Hz display', () => {
    const { render } = setup(() => true);
    for (let i = 0; i < 360; i++) frame(360);
    expect(render.mock.calls.length).toBeGreaterThanOrEqual(58);
    expect(render.mock.calls.length).toBeLessThanOrEqual(60);
  });

  it('paints a one-second search pulse, sleeps with highlights visible, and wakes for new results', () => {
    const layer = { alpha: 1 };
    const pulse = createSearchPulse(layer);
    let pulsing = false;
    const { ticker, render, loop } = setup(() => pulsing);
    const paintedAlphas: number[] = [];
    ticker.add(() => { pulsing = pulse.update(true); });
    ticker.add(() => { paintedAlphas.push(layer.alpha); }, undefined, UPDATE_PRIORITY.LOW);
    pulse.restart();
    const startedAt = now;
    settle();
    expect(now - startedAt).toBeGreaterThanOrEqual(1000);
    expect(now - startedAt).toBeLessThan(1050);
    expect(Math.min(...paintedAlphas)).toBeCloseTo(0.6, 2);
    expect(paintedAlphas.at(-1)).toBe(1);
    const count = render.mock.calls.length;
    for (let i = 0; i < 120; i++) frame();
    expect(render).toHaveBeenCalledTimes(count);
    pulse.restart();
    loop.requestRender();
    settle();
    expect(render.mock.calls.length).toBeGreaterThan(count + 50);
    expect(layer.alpha).toBe(1);
  });

  it('ends the search pulse when disabled and does not replay it after a long idle', () => {
    const layer = { alpha: 1 };
    const pulse = createSearchPulse(layer);
    pulse.restart();
    now += 500;
    expect(pulse.update(true)).toBe(true);
    expect(layer.alpha).toBeCloseTo(0.6);
    // Clearing matches or reduced motion disables the pulse immediately.
    expect(pulse.update(false)).toBe(false);
    expect(layer.alpha).toBe(1);
    expect(pulse.update(true)).toBe(false);
    pulse.restart();
    now += 60_000; // returning from a hidden tab must paint the static final state
    expect(pulse.update(true)).toBe(false);
    expect(layer.alpha).toBe(1);
  });

  it('preserves camera animation duration when high-refresh frames are skipped', () => {
    const { viewport, loop } = setup();
    settle();
    viewport.animate({ position: { x: 1200, y: 1000 }, scale: 2, time: 500 });
    loop.requestRender();
    for (let i = 0; i < 90; i++) frame(360); // 250 ms: still animating
    expect(viewport.scale.x).toBeGreaterThan(1);
    expect(viewport.scale.x).toBeLessThan(2);
    for (let i = 0; i < 108; i++) frame(360); // 550 ms: finished and settled
    expect(viewport.scale.x).toBe(2);
    expect(viewport.center.x).toBeCloseTo(1200);
    expect(pending.size).toBe(0);
  });

  it('pauses hidden tabs, repaints on return, and wakes for resize and restored graphics', () => {
    const { loop, canvas, renderer, render } = setup();
    settle();
    render.mockClear();
    documentStub.hidden = true;
    documentStub.dispatchEvent(new Event('visibilitychange'));
    loop.requestRender();
    now += 60_000;
    frame();
    expect(render).not.toHaveBeenCalled();
    documentStub.hidden = false;
    documentStub.dispatchEvent(new Event('visibilitychange'));
    settle();
    renderer.emit('resize');
    settle();
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    settle();
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('releases scheduled frames and wake listeners on teardown', () => {
    const { loop, canvas, render } = setup();
    cleanup?.(); cleanup = undefined;
    loop.requestRender();
    canvas.dispatchEvent(new Event('wheel'));
    documentStub.dispatchEvent(new Event('visibilitychange'));
    frame();
    expect(pending.size).toBe(0);
    expect(render).not.toHaveBeenCalled();
  });
});
