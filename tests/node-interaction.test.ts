import { Container, EventBoundary, FederatedPointerEvent } from 'pixi.js';
import type { Viewport } from 'pixi-viewport';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildPathingContext } from '../src/render/tree/pathingContext';
import { attachGestureSuppression, attachNodeInteraction, computePreviewPathForNode } from '../src/render/tree/nodeInteraction';
import type { MountContext } from '../src/render/tree/types';
import { useStore } from '../src/state/store';
import { buildAllocation, EMPTY_ALLOCATION } from '../src/state/allocation';
import { makeTree } from './fixtures/tree';

beforeEach(() => useStore.setState(useStore.getInitialState(), true));

describe('hover dependency lifetime', () => {
  function pointer(x = 10, y = 20) {
    const event = new FederatedPointerEvent(new EventBoundary());
    event.client.set(x, y);
    return event;
  }

  function setup() {
    const data = makeTree();
    const ctx = {
      gestureActive: false,
      hoverPreviewDependencies: null,
      pathing: buildPathingContext(data, '1', null, new Set(['1']), EMPTY_ALLOCATION),
    } as MountContext;
    const wrap = new Container();
    attachNodeInteraction(wrap, '3', data, ctx);
    return { data, ctx, wrap };
  }

  it('reuses the active preview for coordinate moves and releases dependencies on pointer-out', () => {
    const { ctx, wrap } = setup();
    wrap.emit('pointerover', pointer());
    const preview = useStore.getState().previewPath;
    const dependencies = ctx.hoverPreviewDependencies;
    expect(preview).toEqual(['2', '3']);
    expect(dependencies?.pathing).toBe(ctx.pathing);

    wrap.emit('pointermove', pointer(12, 22));
    expect(useStore.getState().hovered).toEqual({ nodeKey: '3', clientX: 12, clientY: 22 });
    expect(useStore.getState().previewPath).toBe(preview);
    expect(ctx.hoverPreviewDependencies).toBe(dependencies);

    wrap.emit('pointerout', pointer(12, 22));
    expect(ctx.hoverPreviewDependencies).toBeNull();
    expect(useStore.getState().hovered).toBeNull();
    expect(useStore.getState().previewPath).toBeNull();
    wrap.emit('pointerover', pointer(12, 22));
    expect(useStore.getState().previewPath).toEqual(preview);
    expect(useStore.getState().previewPath).not.toBe(preview);
    wrap.destroy();
  });

  it('replaces the one current-hover cache when another node uses a new pathing context', () => {
    const { data, ctx, wrap } = setup();
    wrap.emit('pointerover', pointer());
    const nextAllocation = buildAllocation(['2'], [], []);
    useStore.setState({ allocation: nextAllocation });
    ctx.pathing = buildPathingContext(data, '1', null, new Set(['1']), nextAllocation);
    const nextWrap = new Container();
    attachNodeInteraction(nextWrap, '5', data, ctx);
    nextWrap.emit('pointerover', pointer(30, 40));
    expect(ctx.hoverPreviewDependencies?.nodeKey).toBe('5');
    expect(ctx.hoverPreviewDependencies?.pathing).toBe(ctx.pathing);
    expect(ctx.hoverPreviewDependencies?.allocation).toBe(nextAllocation);
    expect(useStore.getState().previewPath).toEqual(['3', '5']);
    wrap.destroy();
    nextWrap.destroy();
  });

  it('releases the cache when a gesture clears hover without a pointer-out event', () => {
    const { ctx, wrap } = setup();
    const viewportEvents = new Container();
    attachGestureSuppression(viewportEvents as unknown as Viewport, ctx);
    const event = pointer();
    const gesture = { event, screen: event.client, world: event.global, viewport: viewportEvents as unknown as Viewport };
    wrap.emit('pointerover', pointer());
    viewportEvents.emit('drag-start', gesture);
    expect(ctx.hoverPreviewDependencies).toBeNull();
    expect(useStore.getState().hovered).toBeNull();
    expect(useStore.getState().previewPath).toBeNull();
    wrap.emit('pointermove', pointer(12, 22));
    expect(ctx.hoverPreviewDependencies).toBeNull();
    viewportEvents.emit('drag-end', gesture);
    wrap.emit('pointerover', pointer(12, 22));
    expect(useStore.getState().previewPath).toEqual(['2', '3']);
    wrap.destroy();
    viewportEvents.destroy();
  });
});

describe('hover preview pathing', () => {
  const data = makeTree();

  it('uses the current shared or weapon-set frontier and blocks the other set', () => {
    const allocation = buildAllocation(['2'], ['3'], []);
    const pathing = buildPathingContext(data, '1', null, new Set(['1']), allocation);

    expect(computePreviewPathForNode('5', data, pathing, 'shared')).toBeNull();
    expect(computePreviewPathForNode('5', data, pathing, 'set1')).toEqual(['5']);
    expect(computePreviewPathForNode('3', data, pathing, 'set1')).toBeNull();
  });

  it('does not preview implicit starts, multiple-choice hubs, or unreachable nodes', () => {
    const constrainedData = makeTree({
      '4': { isMultipleChoice: true },
      '6': { unlockConstraint: { ascendancy: 'Witch1', nodes: [11] } },
    });
    const pathing = buildPathingContext(constrainedData, '1', null, new Set(['1']), EMPTY_ALLOCATION);

    expect(computePreviewPathForNode('10', constrainedData, pathing, 'shared')).toBeNull();
    expect(computePreviewPathForNode('4', constrainedData, pathing, 'shared')).toBeNull();
    expect(computePreviewPathForNode('6', constrainedData, pathing, 'shared')).toBeNull();
  });
});
