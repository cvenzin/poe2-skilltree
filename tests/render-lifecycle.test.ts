import { Container } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { applyHoverScale } from '../src/render/tree/nodes';
import { filterConstraintHidden } from '../src/interaction/search';
import { makeTree } from './fixtures/tree';

describe('context rendering', () => {
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
