import type { ReactElement, InputHTMLAttributes } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SearchInput from '../src/ui/SearchInput';
import { useStore } from '../src/state/store';
import { makeTree } from './fixtures/tree';

// Run the real input handlers and debounce effect with controlled hook state,
// as in canvas-errors.test.ts; no DOM or WebGL dependency is needed.
const hooks = vi.hoisted(() => ({ states: [] as unknown[], cursor: 0,
  effects: [] as Array<() => (() => void) | void> }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useMemo: (compute: () => unknown) => compute(),
  useRef: (value: unknown) => {
    const i = hooks.cursor++;
    hooks.states[i] ??= { current: value };
    return hooks.states[i];
  },
  useState: (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.states)) hooks.states[i] = initial;
    return [hooks.states[i], (value: unknown) => { hooks.states[i] = value; }];
  },
  useEffect: (effect: () => (() => void) | void) => { hooks.effects.push(effect); },
}));
vi.mock('../src/state/store', async (original) => {
  const actual = await original<typeof import('../src/state/store')>();
  return { ...actual, useStore: Object.assign((select: (state: ReturnType<typeof actual.useStore.getState>) => unknown) =>
    select(actual.useStore.getState()), actual.useStore) };
});

const data = makeTree({ '2': { name: 'Life', x: 0, y: 0 }, '3': { name: 'Life', x: 10, y: 10 },
  '4': { name: 'Mana', x: 20, y: 20 }, '5': { name: 'Mana', x: 30, y: 30 } });
let cleanup: Array<() => void> = [];
function render() {
  cleanup.forEach((fn) => fn()); cleanup = [];
  hooks.cursor = 0; hooks.effects = [];
  const tree = SearchInput({ data, inputRef: { current: null } });
  const input = (tree.props as { children: ReactElement[] }).children[0]! as ReactElement<InputHTMLAttributes<HTMLInputElement>>;
  hooks.effects.forEach((effect) => { const stop = effect(); if (stop) cleanup.push(stop); });
  return input.props;
}
function type(query: string) {
  render().onChange!({ target: { value: query } } as never);
  return render();
}
function enter(shift = false) {
  render().onKeyDown!({ key: 'Enter', shiftKey: shift, preventDefault: vi.fn() } as never);
}
beforeEach(() => {
  vi.useFakeTimers(); hooks.states = [];
  useStore.setState(useStore.getInitialState(), true);
});
afterEach(() => { cleanup.forEach((fn) => fn()); cleanup = []; vi.useRealTimers(); });

it.each([false, true])('immediate Enter (shift=%s) uses the new draft and survives its pending debounce', (shift) => {
  type('life'); enter(shift);
  expect(useStore.getState().searchQuery).toBe('life');
  expect(useStore.getState().searchMatches).toEqual(['2', '3']);
  expect(useStore.getState().searchCursor).toBe(shift ? 1 : 0);
  render(); vi.advanceTimersByTime(200);
  expect(useStore.getState().searchCursor).toBe(shift ? 1 : 0);
});

it.each([false, true])('replacement Enter (shift=%s) never navigates stale results, including no matches', (shift) => {
  type('life'); vi.advanceTimersByTime(200); render(); enter();
  type('mana'); enter(shift);
  expect(useStore.getState().searchQuery).toBe('mana');
  expect(useStore.getState().searchMatches).toEqual(['4', '5']);
  expect(useStore.getState().searchCursor).toBe(shift ? 1 : 0);
  render(); vi.advanceTimersByTime(200); enter(shift);
  expect(useStore.getState().searchCursor).toBe(shift ? 0 : 1);
  type('zz-no-match'); enter(shift);
  expect(useStore.getState().searchQuery).toBe('zz-no-match');
  expect(useStore.getState().searchMatches).toEqual([]);
  expect(useStore.getState().searchCursor).toBe(-1);
  type(''); enter(shift);
  expect(useStore.getState().searchMatches).toEqual([]);
  expect(useStore.getState().searchCursor).toBe(-1);
});

it.each(['zz-no-match', ''])('immediate Enter on a fresh no-result query (%s) selects nothing', (query) => {
  type(query); enter();
  expect(useStore.getState().searchQuery).toBe(query);
  expect(useStore.getState().searchMatches).toEqual([]);
  expect(useStore.getState().searchCursor).toBe(-1);
});

it('Escape cancels a pending draft instead of reviving it', () => {
  type('life');
  render().onKeyDown!({ key: 'Escape', preventDefault: vi.fn() } as never);
  render(); vi.advanceTimersByTime(200);
  expect(useStore.getState().searchQuery).toBe('');
  expect(useStore.getState().searchMatches).toEqual([]);
});
