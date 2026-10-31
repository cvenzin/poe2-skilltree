import { beforeEach, expect, it, vi } from 'vitest';
import { Container, EventBoundary, FederatedPointerEvent, Rectangle } from 'pixi.js';
import { useStore, ASCENDANCY_CAP, PASSIVE_CAP } from '../src/state/store';
import { buildAllocation } from '../src/state/allocation';
import { proposeNodeEdit, editSummary } from '../src/interaction/nodeActions';
import { buildPathingContext } from '../src/render/tree/pathingContext';
import { attachNodeInteraction } from '../src/render/tree/nodeInteraction';
import { attachTouchTargets, chooseTouchTarget } from '../src/render/tree/touchTargets';
import type { MountContext } from '../src/render/tree/types';
import { keys, makeTree } from './fixtures/tree';

beforeEach(() => useStore.setState(useStore.getInitialState(), true));
function setup(data = makeTree()) {
  useStore.setState({ className: 'Witch', status: { kind: 'ready', version: 'test', data, atlases: {} as never } });
  return data;
}
function proposal(key: string, data: ReturnType<typeof makeTree>) {
  const p = proposeNodeEdit(key, data, useStore.getState());
  if (typeof p === 'string') throw Error(p);
  return p;
}

it('counts auto-selected options and free nodes separately from nodes added', () => {
  const data = setup(makeTree({ '2': { isFree: true }, '3': { isMultipleChoice: true },
    '4': { isMultipleChoiceOption: true }, '5': { isMultipleChoiceOption: true }, '7': { in: ['3'] } }));
  data.nodes['3']!.out.push('7');
  const p = proposal('2', data);
  expect(p.added).toEqual(['2']);
  expect(editSummary(useStore.getState().allocation, p.next, data, null)).toBe('0 points (free nodes)');
  const option = proposal('4', data);
  expect(option.added).toContain('3');
  expect(option.added).toContain('4');
  expect(editSummary(useStore.getState().allocation, option.next, data, null)).toBe('1 Main passive point spent');
  const automatic = proposal('7', data);
  expect(automatic.path).toEqual(['2', '3', '7', '4']);
  expect(automatic.added).toHaveLength(4);
  expect(editSummary(useStore.getState().allocation, automatic.next, data, null)).toBe('2 Main passive points spent');
});

it('counts ascendancy costs separately and excludes free ascendancy skills', () => {
  const data = setup(makeTree({ '12': { ascendancyId: 'Witch1', isFree: true, in: ['11'] } }));
  data.nodes['11']!.out.push('12');
  useStore.setState({ ascendancyId: 'Witch1' });
  const p = proposal('12', data);
  expect(p.added).toEqual(['11', '12']);
  expect(editSummary(useStore.getState().allocation, p.next, data, 'Witch1')).toBe('1 ascendancy point spent');
});

it.each(['set1', 'set2'] as const)('reports the full %s path cost and rejects restricted special nodes', (mode) => {
  const data = setup(makeTree({ '6': { isKeystone: true } }));
  useStore.getState().setAllocationMode(mode);
  const p = proposal('5', data);
  expect(p.added).toEqual(['2', '3', '5']);
  expect(editSummary(useStore.getState().allocation, p.next, data, null)).toContain('3 Set ' + (mode === 'set1' ? '1' : '2') + ' passive / specialization points spent');
  expect(proposeNodeEdit('6', data, useStore.getState())).toContain('must be allocated in Main');
});

it('previews Main and both dependent weapon branches, cancels, confirms once, and restores with undo/redo', () => {
  const data = setup();
  const allocation = buildAllocation(['2', '3'], ['4'], ['5']);
  useStore.setState({ allocation });
  const s = useStore.getState();
  s.requestRemoval('3', data);
  expect(useStore.getState().pendingRemoval?.proposal.removed).toEqual(['3', '4', '5']);
  expect(useStore.getState().allocation).toBe(allocation);
  expect(useStore.getState().past).toHaveLength(0);
  s.dismissInspection();
  s.confirmRemoval();
  expect(useStore.getState().allocation).toBe(allocation);
  s.requestRemoval('3', data); s.confirmRemoval(); s.confirmRemoval();
  expect([...useStore.getState().allocation.shared]).toEqual(['2']);
  expect(useStore.getState().allocation.set1.size + useStore.getState().allocation.set2.size).toBe(0);
  expect(useStore.getState().past).toHaveLength(1);
  s.undo(); expect(useStore.getState().allocation).toBe(allocation);
  s.redo(); expect([...useStore.getState().allocation.shared]).toEqual(['2']);
});

it('reviews option replacement and its cascade before committing one edit', () => {
  const data = setup(makeTree({ '3': { isMultipleChoice: true },
    '4': { isMultipleChoiceOption: true, out: ['7'] },
    '5': { isMultipleChoiceOption: true }, '7': { in: ['4'] } }));
  const source = buildAllocation(['2', '3', '4', '7'], [], []);
  useStore.setState({ allocation: source });
  useStore.getState().requestNodeAllocation('5', data);
  expect(useStore.getState().allocation).toBe(source);
  expect(useStore.getState().pendingRemoval?.proposal.removed).toEqual(['4', '7']);
  expect(useStore.getState().pendingRemoval?.proposal.added).toEqual(['5']);
  useStore.getState().confirmRemoval();
  expect([...useStore.getState().allocation.shared]).toEqual(['2', '3', '5']);
  expect(useStore.getState().past).toHaveLength(1);
  useStore.getState().undo(); expect(useStore.getState().allocation).toBe(source);
});

it.each(['mode', 'class', 'ascendancy', 'version', 'allocation', 'attributes', 'status', 'search'] as const)('invalidates cascade confirmation after %s changes', (change) => {
  const data = setup();
  useStore.setState({ allocation: buildAllocation(['2', '3', '4'], [], []) });
  const s = useStore.getState();
  s.requestRemoval('2', data);
  expect(useStore.getState().pendingRemoval).not.toBeNull();
  if (change === 'mode') s.setAllocationMode('set1');
  if (change === 'class') s.setClass('Ranger');
  if (change === 'ascendancy') s.setAscendancy('Witch1');
  if (change === 'version') s.setActiveVersion('next');
  if (change === 'allocation') s.undo(); // no history: explicitly change allocation below
  if (change === 'allocation') s.commitAllocation(buildAllocation(['2'], [], []), data);
  if (change === 'attributes') useStore.setState({ attributeChoices: { '2': 'strength' } });
  if (change === 'status') s.setStatus({ kind: 'loading', version: 'next' });
  if (change === 'search') s.setSearch('other target', ['6']);
  expect(useStore.getState().pendingRemoval).toBeNull();
  const current = useStore.getState().allocation;
  s.confirmRemoval(); expect(useStore.getState().allocation).toBe(current);
});

it('explains another mode and unreachable paths; class-start activation never resets', () => {
  const data = setup(makeTree({ '50': {} }));
  useStore.setState({ allocation: buildAllocation([], ['2'], []) });
  expect(proposeNodeEdit('2', data, useStore.getState())).toContain('Switch Editing to Set 1');
  expect(proposeNodeEdit('50', data, useStore.getState())).toContain('No reachable path');
  const allocation = useStore.getState().allocation;
  const ctx = { lastGestureEndAt: -Infinity, pathing: buildPathingContext(data, '1', null, new Set(['1']), allocation) } as MountContext;
  const wrap = new Container(); attachNodeInteraction(wrap, '1', data, ctx);
  const e = new FederatedPointerEvent(new EventBoundary()); e.pointerType = 'mouse';
  wrap.emit('pointerdown', e); wrap.emit('pointertap', e);
  expect(useStore.getState().allocation).toBe(allocation);
  expect(useStore.getState().validationMessage).toContain('Use Reset');
  wrap.destroy();
});

it.each(['passive', 'ascendancy'] as const)('shows %s budget rejection in the proposal before commit', (kind) => {
  const existing = keys(100, kind === 'passive' ? PASSIVE_CAP : ASCENDANCY_CAP);
  const data = setup(makeTree(Object.fromEntries(existing.map((key) => [key,
    { in: [kind === 'passive' ? '1' : '10'], ...(kind === 'ascendancy' ? { ascendancyId: 'Witch1' } : {}) }]))));
  data.nodes[kind === 'passive' ? '1' : '10']!.out.push(...existing);
  useStore.setState({ allocation: buildAllocation(existing, [], []), ascendancyId: 'Witch1' });
  const p = proposal(kind === 'passive' ? '3' : '11', data);
  expect(p.error).toContain('limit');
  const state = useStore.getState();
  expect(state.tryAllocate(p.next, data)).toBe(false);
  expect(useStore.getState().allocation).toBe(state.allocation);
  expect(useStore.getState().past).toHaveLength(0);
});

it('enlarges touch targets, rejects overlap, restores mouse hit areas, and removes listeners', () => {
  const canvas = new EventTarget() as HTMLCanvasElement;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 500 }) as DOMRect;
  const win = new EventTarget();
  vi.stubGlobal('window', win);
  const wraps = [0, 20].map((x) => {
    const w = new Container(); w.position.set(x, 0); w.hitArea = new Rectangle(-5, -5, 10, 10); w.eventMode = 'static';
    w.getGlobalPosition(); return w;
  });
  const ctx = { nodeWraps: new Map(wraps.map((w, i) => [String(i), w])) } as MountContext;
  const stop = attachTouchTargets(canvas, ctx);
  const send = (type: string, pointerType: string, x = 10) => {
    const event = Object.assign(new Event(type), { pointerId: 1, pointerType, clientX: x, clientY: 0 });
    Object.defineProperty(event, 'target', { value: canvas });
    win.dispatchEvent(event);
  };
  send('pointerdown', 'touch');
  expect((wraps[0]!.hitArea as Rectangle).width).toBe(10);
  expect(ctx.touchTargetAmbiguous).toBe(true);
  expect(useStore.getState().validationMessage).toBeNull();
  win.dispatchEvent(Object.assign(new Event('pointerup'), { pointerId: 1, clientX: 10, clientY: 0 }));
  expect(useStore.getState().validationMessage).toContain('zoom in');
  send('pointerdown', 'touch', 0);
  expect(ctx.touchTargetAmbiguous).toBe(false);
  expect((wraps[0]!.hitArea as Rectangle).width).toBe(44);
  expect((wraps[1]!.hitArea as Rectangle).width).toBe(10);
  useStore.getState().setHovered({ nodeKey: '0', clientX: 0, clientY: 0, inputType: 'touch' });
  win.dispatchEvent(Object.assign(new Event('pointercancel'), { pointerId: 99 }));
  expect(useStore.getState().hovered?.nodeKey).toBe('0'); // scrolling a DOM tooltip
  win.dispatchEvent(Object.assign(new Event('pointercancel'), { pointerId: 1 }));
  expect(useStore.getState().hovered).toBeNull();
  win.dispatchEvent(Object.assign(new Event('pointermove'), { pointerId: 1, pointerType: 'mouse' }));
  expect((wraps[0]!.hitArea as Rectangle).width).toBe(10);
  expect(ctx.touchTargetAmbiguous).toBe(false);
  stop(); send('pointerdown', 'touch');
  expect((wraps[0]!.hitArea as Rectangle).width).toBe(10);
  wraps.forEach((w) => w.destroy()); vi.unstubAllGlobals();
});

it.each(['pan', 'pan back', 'pinch', 'cancel', 'release outside', 'release moved', 'viewport gesture'] as const)(
  'does not show ambiguous-tap feedback for a %s', (gesture) => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 500, height: 500 }) as DOMRect;
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    const wraps = [0, 20].map((x) => {
      const w = new Container(); w.position.set(x, 10); w.hitArea = new Rectangle(-5, -5, 10, 10); w.eventMode = 'static';
      w.getGlobalPosition(); return w;
    });
    const ctx = { nodeWraps: new Map(wraps.map((w, i) => [String(i), w])), lastGestureEndAt: -Infinity } as MountContext;
    const stop = attachTouchTargets(canvas, ctx);
    const send = (type: string, x = 10, id = 1) => {
      const event = Object.assign(new Event(type), { pointerId: id, pointerType: 'touch', clientX: x, clientY: 10 });
      Object.defineProperty(event, 'target', { value: canvas });
      win.dispatchEvent(event);
    };
    const sourceAllocation = useStore.getState().allocation;
    send('pointerdown');
    expect(ctx.touchTargetAmbiguous).toBe(true);
    expect(useStore.getState().validationMessage).toBeNull();
    if (gesture === 'pan' || gesture === 'pan back') send('pointermove', 40);
    if (gesture === 'pan back') send('pointermove', 10);
    if (gesture === 'pinch') { send('pointerdown', 30, 2); send('pointerup', 30, 2); }
    if (gesture === 'viewport gesture') ctx.lastGestureEndAt = performance.now();
    send(gesture === 'cancel' ? 'pointercancel' : 'pointerup',
      gesture === 'release outside' ? -1 : gesture === 'release moved' || gesture === 'pan' ? 40 : 10);
    expect(useStore.getState().validationMessage).toBeNull();
    expect(useStore.getState().allocation).toBe(sourceAllocation);
    expect(useStore.getState().past).toHaveLength(0);
    // A subsequent deliberate ambiguous tap still receives useful feedback.
    send('pointerdown'); send('pointerup', 12);
    expect(useStore.getState().validationMessage).toContain('zoom in');
    stop(); wraps.forEach((w) => w.destroy()); vi.unstubAllGlobals();
  },
);

it('prioritizes a direct artwork hit over neighboring touch padding', () => {
  expect(chooseTouchTarget([{ key: 'a', direct: true, distance: 4 }, { key: 'b', direct: false, distance: 12 }]))
    .toEqual({ key: 'a', ambiguous: false });
});

it('accepts a clearly closer near miss and refuses ambiguous near misses or overlapping artwork', () => {
  expect(chooseTouchTarget([{ key: 'a', direct: false, distance: 8 }, { key: 'b', direct: false, distance: 17 }]).key).toBe('a');
  expect(chooseTouchTarget([{ key: 'a', direct: false, distance: 10 }, { key: 'b', direct: false, distance: 12 }]).ambiguous).toBe(true);
  expect(chooseTouchTarget([{ key: 'a', direct: true, distance: 1 }, { key: 'b', direct: true, distance: 10 }]).ambiguous).toBe(true);
  expect(chooseTouchTarget([])).toEqual({ key: null, ambiguous: false });
});
