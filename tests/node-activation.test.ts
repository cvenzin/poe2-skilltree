import { Container, EventBoundary, FederatedPointerEvent } from 'pixi.js';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { Viewport } from 'pixi-viewport';
import { attachGestureSuppression, attachNodeInteraction } from '../src/render/tree/nodeInteraction';
import { buildPathingContext } from '../src/render/tree/pathingContext';
import type { MountContext } from '../src/render/tree/types';
import { PASSIVE_CAP, useStore } from '../src/state/store';
import { buildAllocation } from '../src/state/allocation';
import type { TreeData } from '../src/data/types';
import { keys, makeTree } from './fixtures/tree';

beforeEach(() => useStore.setState(useStore.getInitialState(), true));
afterEach(() => vi.restoreAllMocks());

function setup(attribute = false, suppliedData?: TreeData) {
  const data = suppliedData ?? makeTree(attribute ? { '2': { isGenericAttribute: true } } : {});
  if (attribute) data.skillOverrides = { '100': { id: 'generic_attribute_strength', name: 'Strength', icon: 'str.png', stats: ['+5 to Strength'] } };
  useStore.setState({ className: 'Witch', status: { kind: 'ready', version: 'test', data, atlases: {} as never } });
  const ctx = { gestureActive: false, lastGestureEndAt: -Infinity, hoverPreviewDependencies: null,
    pathing: buildPathingContext(data, '1', null, new Set(['1']), useStore.getState().allocation) } as MountContext;
  const wraps = ['3', '5'].map((key) => {
    const wrap = new Container();
    attachNodeInteraction(wrap, key, data, ctx);
    return wrap;
  });
  const event = new FederatedPointerEvent(new EventBoundary());
  const tap = (wrap: Container, type = 'mouse') => {
    event.pointerType = type;
    wrap.emit('pointerdown', event);
    wrap.emit('pointertap', event);
  };
  return { data, ctx, a: wraps[0]!, b: wraps[1]!, event, tap };
}

it('touch previews first, then commits, even after hover or pointer-out', () => {
  const type = 'touch';
  const { a, event, tap } = setup();
  a.emit('pointerover', event);
  tap(a, type);
  expect(useStore.getState().allocation.shared.size).toBe(0);
  expect(useStore.getState().past).toHaveLength(0);
  expect(useStore.getState().previewPath).toEqual(['2', '3']);
  a.emit('pointerout', event);
  expect(useStore.getState().previewPath).toEqual(['2', '3']);
  tap(a, type);
  expect([...useStore.getState().allocation.shared]).toEqual(['2', '3']);
  expect(useStore.getState().past).toHaveLength(1);
  useStore.getState().undo();
  expect(useStore.getState().allocation.shared.size).toBe(0);
  useStore.getState().redo();
  expect([...useStore.getState().allocation.shared]).toEqual(['2', '3']);
});

it('mouse hover previews and the first click commits', () => {
  const { a, event, tap } = setup();
  a.emit('pointerover', event);
  expect(useStore.getState().allocation.shared.size).toBe(0);
  expect(useStore.getState().previewPath).toEqual(['2', '3']);
  tap(a);
  expect([...useStore.getState().allocation.shared]).toEqual(['2', '3']);
});

it('asks for an attribute default only on the second activation and cancellation starts over', () => {
  const { a, tap, data } = setup(true);
  tap(a, 'touch');
  expect(useStore.getState().attributeEditor).toBeNull();
  tap(a, 'touch');
  expect(useStore.getState().attributeEditor?.kind).toBe('default');
  expect(useStore.getState().allocation.shared.size).toBe(0);
  useStore.getState().openAttributeEditor(null);
  tap(a, 'touch');
  expect(useStore.getState().attributeEditor).toBeNull();
  tap(a, 'touch');
  const editor = useStore.getState().attributeEditor;
  expect(editor?.kind).toBe('default');
  expect(editor?.kind === 'default' && editor.pending).toBeTruthy();
  useStore.getState().setDefaultAttribute('strength');
  if (editor?.kind === 'default' && editor.pending) useStore.getState().tryAllocate(editor.pending, data);
  expect(useStore.getState().attributeChoices).toEqual({ '2': 'strength' });
  expect(useStore.getState().past).toHaveLength(1);
});

it.each(['set1', 'set2'] as const)('touch preview/commit stays in %s and allocated removal still cascades', (mode) => {
  const { a, tap } = setup();
  useStore.getState().setAllocationMode(mode);
  tap(a, 'touch');
  expect(useStore.getState().allocation[mode].size).toBe(0);
  tap(a, 'touch');
  expect([...useStore.getState().allocation[mode]]).toEqual(['2', '3']);
  tap(a, 'touch');
  expect([...useStore.getState().allocation[mode]]).toEqual(['2']);
  useStore.getState().undo();
  expect([...useStore.getState().allocation[mode]]).toEqual(['2', '3']);
});

it('an over-budget touch preview is harmless and confirmation rejects without changing history', () => {
  const existing = keys(100, PASSIVE_CAP);
  const data = makeTree(Object.fromEntries(existing.map((key) => [key, { in: ['1'] }])));
  data.nodes['1']!.out.push(...existing);
  const { a, ctx, tap } = setup(false, data);
  const allocation = buildAllocation(existing, [], []);
  useStore.setState({ allocation });
  ctx.pathing = buildPathingContext(data, '1', null, new Set(['1']), allocation);
  tap(a, 'touch');
  expect(useStore.getState().passiveRejectionTick).toBe(0);
  tap(a, 'touch');
  expect(useStore.getState().passiveRejectionTick).toBe(1);
  expect(useStore.getState().allocation).toBe(allocation);
  expect(useStore.getState().past).toHaveLength(0);
});

it('changing preview targets or editing mode requires a fresh first activation', () => {
  const { a, b, event, tap } = setup();
  tap(a, 'touch');
  b.emit('pointerover', event);
  tap(b, 'touch');
  expect(useStore.getState().allocation.shared.size).toBe(0);
  tap(a, 'touch');
  expect(useStore.getState().allocation.shared.size).toBe(0);
  useStore.getState().setAllocationMode('set1');
  tap(a, 'touch');
  expect(useStore.getState().allocation.set1.size).toBe(0);
  tap(a, 'touch');
  expect([...useStore.getState().allocation.set1]).toEqual(['2', '3']);
});

it('long inspection and gesture releases never arm or commit an allocation', () => {
  const { a, ctx, event, tap } = setup();
  let now = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  event.pointerType = 'touch';
  a.emit('pointerdown', event);
  now += 400;
  a.emit('pointertap', event);
  tap(a, 'touch');
  expect(useStore.getState().allocation.shared.size).toBe(0);
  const vp = new Container();
  attachGestureSuppression(vp as unknown as Viewport, ctx);
  const gesture = { event, screen: event.client, world: event.global, viewport: vp as unknown as Viewport };
  vp.emit('drag-start', gesture);
  tap(a, 'touch');
  vp.emit('drag-end', gesture);
  tap(a, 'touch');
  now += 200;
  tap(a, 'touch');
  expect(useStore.getState().allocation.shared.size).toBe(0);
  tap(a, 'touch');
  expect(useStore.getState().allocation.shared.size).toBe(2);
});
