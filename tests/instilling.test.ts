import { readFileSync } from 'node:fs';
import { Container, EventBoundary, FederatedPointerEvent } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIQUID_EMOTIONS } from '../src/data/liquidEmotions';
import { normalizeTreeData } from '../src/data/normalize';
import type { RawTreeData } from '../src/data/types';
import { VERSIONS } from '../src/data/versions';
import { proposeNodeEdit } from '../src/interaction/nodeActions';
import { attachNodeInteraction, computePreviewPathForNode } from '../src/render/tree/nodeInteraction';
import { buildPathingContext } from '../src/interaction/pathingContext';
import { applyJewelOverlay } from '../src/render/tree/radiusOverlays';
import type { MountContext } from '../src/render/tree/types';
import { buildAllocation } from '../src/state/allocation';
import { revalidateAllocation } from '../src/state/buildRules';
import { useStore } from '../src/state/store';
import { makeTree } from './fixtures/tree';

beforeEach(() => { vi.useFakeTimers(); useStore.setState(useStore.getInitialState(), true); });
afterEach(() => vi.useRealTimers());

// Connected on purpose: restrictions must use export metadata, not rely on
// today's disconnected graph or accidentally admit an item node as transit.
const data = makeTree({ '3': { name: 'Anoint', isBlighted: true, recipe: ['LiquidEnvy', 'LiquidEnvy', 'LiquidDespair'] } });

it.each(['shared', 'set1', 'set2'] as const)('rejects anoint edits and traversal in %s without touching history', (mode) => {
  useStore.setState({ className: 'Witch', allocationMode: mode,
    status: { kind: 'ready', version: 'test', data, atlases: {} as never } });
  const before = useStore.getState();
  const pathing = buildPathingContext(data, '1', null, new Set(['1']), before.allocation);
  expect(proposeNodeEdit('3', data, before)).toContain('Instilling only');
  expect(computePreviewPathForNode('3', data, pathing, mode)).toBeNull();
  expect(computePreviewPathForNode('5', data, pathing, mode)).toBeNull();
  before.requestNodeAllocation('3', data);
  expect(useStore.getState().allocation).toBe(before.allocation);
  expect(useStore.getState().past).toBe(before.past);
  expect(useStore.getState().pendingRemoval).toBeNull();
  expect(revalidateAllocation(buildAllocation(['2', '3'], [], []), data, 'Witch', null).shared).toEqual(new Set(['2']));
});

it.each(['mouse', 'pen', 'touch'])('inspects on %s without previewing, allocating, or showing validation on repeated presses', (pointerType) => {
  useStore.setState({ className: 'Witch', status: { kind: 'ready', version: 'test', data, atlases: {} as never } });
  const before = useStore.getState();
  const ctx = { gestureActive: false, lastGestureEndAt: -Infinity, hoverPreviewDependencies: null,
    pathing: buildPathingContext(data, '1', null, new Set(['1']), before.allocation) } as MountContext;
  const wrap = new Container();
  attachNodeInteraction(wrap, '3', data, ctx);
  const event = new FederatedPointerEvent(new EventBoundary());
  event.pointerType = pointerType;
  event.client.set(100, 100);
  wrap.emit('pointerover', event);
  for (const hold of [false, true, false]) {
    wrap.emit('pointerdown', event);
    if (hold) vi.advanceTimersByTime(400);
    wrap.emit('pointertap', event);
    expect(useStore.getState().hovered?.nodeKey).toBe('3');
    expect(useStore.getState().previewPath).toBeNull();
    expect(useStore.getState().validationMessage).toBeNull();
    expect(useStore.getState().allocation).toBe(before.allocation);
    expect(useStore.getState().past).toBe(before.past);
    expect(ctx.activationPreview).toBeNull();
  }
  wrap.destroy();
});

it('clears the radius overlay for Zarokh-style sockets while preserving ordinary socket rings', () => {
  const tree = makeTree({ '3': { isBlighted: true, isJewelSocket: true }, '6': { isJewelSocket: true } });
  const world = new Container(), layer = new Container();
  const socket = new Container();
  world.addChild(socket);
  const wraps = new Map([['3', socket], ['6', socket]]);
  applyJewelOverlay({ nodeKey: '6' }, tree, wraps, layer, world, null);
  expect(layer.children).toHaveLength(3);
  applyJewelOverlay({ nodeKey: '3' }, tree, wraps, layer, world, null);
  expect(layer.children).toHaveLength(0);
  world.destroy({ children: true }); layer.destroy({ children: true });
});

describe.each(VERSIONS)('instilling metadata in %s', (version) => {
  it('resolves every available instilling-only recipe to a bundled game icon', () => {
    const tree = normalizeTreeData(JSON.parse(readFileSync(`public/trees/${version}/data.json`, 'utf8')) as RawTreeData);
    const anoints = Object.values(tree.nodes).filter((node) => node.isBlighted);
    // 0.5.0 has unnamed placeholders; do not backfill newer recipe data.
    expect(anoints).toHaveLength(version === '0.5.0' ? 0 : 17);
    for (const node of anoints) {
      expect(node.recipe).toHaveLength(3);
      for (const id of node.recipe!) {
        const liquid = LIQUID_EMOTIONS[id];
        expect(liquid, id).toBeDefined();
        const bytes = readFileSync(`public/liquid-emotions/${liquid!.icon}`);
        expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
        expect(bytes.toString('ascii', 8, 12)).toBe('WEBP');
      }
    }
  });
});
