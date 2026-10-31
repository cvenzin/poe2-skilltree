import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { applyHoverScale, drawOverlayNodes } from '../src/render/tree/nodes';
import { applyConstraintVisibility, buildPathingContext } from '../src/render/tree/pathingContext';
import { swapContext } from '../src/render/tree/classContext';
import type { MountContext } from '../src/render/tree/types';
import type { AtlasBundle } from '../src/render/atlas';
import { collectClusterNodes } from '../src/render/tree/geometry';
import { EMPTY_ALLOCATION, buildAllocation } from '../src/state/allocation';
import { useStore } from '../src/state/store';
import { filterConstraintHidden } from '../src/interaction/search';
import { makeTree } from './fixtures/tree';

describe('context rendering', () => {
  it('hides a gated ascendancy sprite until unlocked and removes its registration on a context swap', () => {
    const data = makeTree({ '10': { x: 0, y: 0 }, '11': { x: 100, y: 0, icon: 'missing.png',
      unlockConstraint: { nodes: [2, 3] } } });
    const overlay = new Container();
    const ctx = { nodeWraps: new Map(), nodeStates: new Map(), ascendancyNodeKeys: new Set(), constrainedWraps: new Set(),
      pathing: buildPathingContext(data, '1', 'Witch1', new Set(['1', '10']), EMPTY_ALLOCATION),
      hoverScaledWrap: null, backdropLayer: null, mainCircleLayer: null, ascendancyLayer: null, swapGeneration: 0,
    } as unknown as MountContext;
    const atlases = { atlases: new Map([['background-witch', {}]]) } as AtlasBundle;
    drawOverlayNodes(overlay, atlases, data, collectClusterNodes(data, 'Witch1')!, ctx);
    const wrap = ctx.nodeWraps.get('11')!;
    expect(ctx.constrainedWraps.has('11')).toBe(true);
    applyConstraintVisibility(ctx);
    expect(wrap.visible).toBe(false);
    expect(wrap.eventMode).toBe('none');
    ctx.pathing = buildPathingContext(data, '1', 'Witch1', new Set(['1', '10']), buildAllocation(['2', '3'], [], []));
    applyConstraintVisibility(ctx);
    expect(wrap.visible).toBe(true);
    expect(wrap.eventMode).toBe('static');
    ctx.pathing = buildPathingContext(data, '1', 'Witch1', new Set(['1', '10']), buildAllocation(['2'], [], []));
    applyConstraintVisibility(ctx);
    expect(wrap.visible).toBe(false);
    useStore.setState(useStore.getInitialState(), true);
    swapContext(ctx, data, atlases, 'Witch', null);
    expect(ctx.constrainedWraps.has('11')).toBe(false);
    expect(ctx.nodeWraps.has('11')).toBe(false);
    overlay.destroy({ children: true });
  });

  it('can hover a new overlay after the previous hovered wrap is destroyed', () => {
    const oldWrap = new Container();
    const nextWrap = new Container();
    oldWrap.destroy();
    expect(applyHoverScale(new Map([['next', nextWrap]]), oldWrap, 'next')).toBe(nextWrap);
    expect(nextWrap.scale.x).toBe(1.08);
    expect(applyHoverScale(new Map(), nextWrap, null)).toBeNull();
    expect(nextWrap.scale.x).toBe(1);
    nextWrap.destroy();
  });

  it('filters hidden ascendancy search results even without constraint-gated nodes', () => {
    const data = makeTree();
    expect(filterConstraintHidden(['2', '11'], data, null, new Set())).toEqual(['2']);
    expect(filterConstraintHidden(['2', '11'], data, 'Witch1', new Set())).toEqual(['2', '11']);
    expect(filterConstraintHidden(['2', '11'], data, 'Druid1', new Set())).toEqual(['2']);
  });
});
