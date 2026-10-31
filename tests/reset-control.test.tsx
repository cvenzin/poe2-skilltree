import type { ReactElement, ButtonHTMLAttributes } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import ResetButton from '../src/ui/ResetButton';
import { useStore } from '../src/state/store';
import { buildAllocation } from '../src/state/allocation';
import { keys } from './fixtures/tree';

vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useEffect: () => {}, useRef: () => ({ current: null }),
}));
vi.mock('../src/state/store', async (original) => {
  const actual = await original<typeof import('../src/state/store')>();
  return { ...actual, useStore: Object.assign((select: (s: ReturnType<typeof actual.useStore.getState>) => unknown) =>
    select(actual.useStore.getState()), actual.useStore) };
});
type Element = ReactElement<{ children?: Element | Element[]; onClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'] }>;
function findButtons(element: Element): Element[] {
  const children = element.props.children;
  return [...(element.type === 'button' ? [element] : []), ...(Array.isArray(children) ? children : [children])
    .flatMap((child) => child && typeof child === 'object' && 'props' in child ? findButtons(child) : [])];
}
beforeEach(() => useStore.setState(useStore.getInitialState(), true));

it('keeps Reset confirmation for large builds, cancellation is harmless, and confirmation is one undoable edit', () => {
  const source = buildAllocation(keys(100, 11), ['4'], ['5']);
  useStore.setState({ allocation: source });
  findButtons(ResetButton() as Element)[0]!.props.onClick!({} as never);
  expect(useStore.getState().resetConfirmOpen).toBe(true);
  expect(useStore.getState().allocation).toBe(source);
  findButtons(ResetButton() as Element)[1]!.props.onClick!({} as never); // Cancel
  expect(useStore.getState().resetConfirmOpen).toBe(false);
  expect(useStore.getState().past).toHaveLength(0);
  findButtons(ResetButton() as Element)[0]!.props.onClick!({} as never);
  findButtons(ResetButton() as Element)[2]!.props.onClick!({} as never); // Confirm
  expect(useStore.getState().allocation.shared.size).toBe(0);
  expect(useStore.getState().allocation.set1.size + useStore.getState().allocation.set2.size).toBe(0);
  expect(useStore.getState().past).toHaveLength(1);
  useStore.getState().undo(); expect(useStore.getState().allocation).toBe(source);
});
