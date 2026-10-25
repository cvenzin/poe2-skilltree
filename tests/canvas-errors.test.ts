import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TreeCanvas from '../src/render/TreeCanvas';
import { mount } from '../src/render/tree/mount';
import { useStore } from '../src/state/store';
import { makeTree } from './fixtures/tree';

// Exercise the component's mount effect without requiring a WebGL/DOM runtime.
const hooks = vi.hoisted(() => ({ effects: [] as Array<() => (() => void) | void>, refs: [] as unknown[] }));
vi.mock('react', async (original) => ({ ...await original<typeof import('react')>(),
  useEffect: (effect: () => (() => void) | void) => { hooks.effects.push(effect); },
  useRef: (value: unknown) => ({ current: hooks.refs.length ? hooks.refs.shift() : value }),
}));
vi.mock('../src/render/tree/mount', () => ({ mount: vi.fn() }));

const data = makeTree();
const atlases = {} as never;
let cleanup: (() => void) | void;

function mountCanvas() {
  hooks.effects = [];
  hooks.refs = [{}]; // host element
  TreeCanvas({ data, atlases, className: 'Witch', ascendancyId: null });
  cleanup = hooks.effects[0]!();
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  useStore.setState({ activeVersion: '0.5.5',
    status: { kind: 'ready', version: '0.5.5', data, atlases } });
  vi.mocked(mount).mockReset();
});
afterEach(() => { cleanup?.(); cleanup = undefined; });

describe('canvas initialization errors', () => {
  it('shows the existing error/retry state when Pixi initialization rejects', async () => {
    vi.mocked(mount).mockRejectedValue(new Error('WebGL unavailable'));
    mountCanvas();
    await Promise.resolve();
    expect(useStore.getState().status).toEqual({ kind: 'error', version: '0.5.5', message: 'WebGL unavailable' });
    cleanup?.(); cleanup = undefined;
    useStore.getState().retry();
    expect(useStore.getState().retryToken).toBe(1);
    expect(useStore.getState().status.kind).toBe('idle');
    useStore.getState().setStatus({ kind: 'ready', version: '0.5.5', data, atlases });
    vi.mocked(mount).mockResolvedValue(undefined);
    mountCanvas();
    await Promise.resolve();
    expect(useStore.getState().status.kind).toBe('ready');
  });

  it('releases partially mounted scene resources after a setup failure', async () => {
    const destroy = vi.fn(), disconnect = vi.fn(), unsubscribe = vi.fn(), ticker = vi.fn(), visibility = vi.fn();
    vi.mocked(mount).mockImplementation(async (_host, _data, _atlases, _props, ctx) => {
      ctx.app = { destroy } as never;
      ctx.observer = { disconnect } as never;
      ctx.unsubscribeStore = unsubscribe;
      ctx.removeTickerCallback = ticker;
      ctx.removeVisibilityListener = visibility;
      throw new Error('Scene setup failed');
    });
    mountCanvas(); await Promise.resolve();
    expect(useStore.getState().status.kind).toBe('error');
    cleanup?.(); cleanup = undefined;
    for (const release of [destroy, disconnect, unsubscribe, ticker, visibility]) expect(release).toHaveBeenCalledOnce();
  });

  it.each(['cancelled', 'replaced'])('ignores a late failure from a %s canvas', async (kind) => {
    let reject!: (error: Error) => void;
    vi.mocked(mount).mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    mountCanvas();
    if (kind === 'cancelled') { cleanup?.(); cleanup = undefined; }
    else useStore.setState({ status: { kind: 'ready', version: '0.5.2', data: makeTree(), atlases }, activeVersion: '0.5.2' });
    reject(new Error('Stale failure')); await Promise.resolve();
    expect(useStore.getState().status.kind).toBe('ready');
  });
});
