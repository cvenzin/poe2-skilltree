import type { ReactElement, ButtonHTMLAttributes } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Toolbar from '../src/ui/Toolbar';
import { useKeyboardShortcuts } from '../src/ui/useKeyboardShortcuts';
import ResetButton from '../src/ui/ResetButton';
import { useStore } from '../src/state/store';
import { buildAllocation } from '../src/state/allocation';
import { keys, makeTree } from './fixtures/tree';

vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useEffect: (effect: () => void) => { if (captureShortcuts) effect(); }, useRef: () => ({ current: null }),
}));
vi.mock('../src/state/store', async (original) => {
  const actual = await original<typeof import('../src/state/store')>();
  return { ...actual, useStore: Object.assign((select: (s: ReturnType<typeof actual.useStore.getState>) => unknown) =>
    select(actual.useStore.getState()), actual.useStore) };
});
let captureShortcuts = false;
type Element = ReactElement<{ children?: Element | Element[]; onClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'] }>;
function findButtons(element: Element): Element[] {
  const children = element.props.children;
  return [...(element.type === 'button' ? [element] : []), ...(Array.isArray(children) ? children : [children])
    .flatMap((child) => child && typeof child === 'object' && 'props' in child ? findButtons(child) : [])];
}
beforeEach(() => useStore.setState(useStore.getInitialState(), true));

it('shows the R confirmation in a collapsed toolbar before accepting a second deliberate press', () => {
  const events = new EventTarget();
  vi.stubGlobal('window', Object.assign(events, { matchMedia: () => ({ matches: true }) }));
  vi.stubGlobal('HTMLElement', class {});
  try {
    const data = makeTree(), source = buildAllocation(keys(100, 11), [], []);
    useStore.setState({ status: { kind: 'ready', version: 'test', data, atlases: {} as never }, allocation: source });
    captureShortcuts = true;
    useKeyboardShortcuts();
    captureShortcuts = false;
    const render = () => renderToStaticMarkup(<Toolbar data={data} />);
    const press = (repeat = false) => events.dispatchEvent(Object.assign(new Event('keydown'), { key: 'r', repeat }));
    expect(render()).toContain('Open build controls');
    press();
    expect(render()).toContain('aria-label="Reset allocation"');
    press(true);
    expect(useStore.getState().allocation).toBe(source);
    press();
    expect(useStore.getState().allocation.shared.size).toBe(0);
    useStore.getState().undo();
    expect(useStore.getState().allocation).toBe(source);
  } finally { captureShortcuts = false; vi.unstubAllGlobals(); }
});

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
