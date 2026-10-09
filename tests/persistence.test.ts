import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPersistedSnapshot, startPersistence } from '../src/state/persistence';
import { buildAllocation } from '../src/state/allocation';
import { useStore } from '../src/state/store';

const storage = new Map<string, string>();
const setItem = vi.fn((key: string, value: string) => { storage.set(key, value); });
let stop: (() => void) | undefined;

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  storage.clear();
  setItem.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem });
});
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('saved builds', () => {
  it('migrates legacy allocated arrays and filters invalid key types', () => {
    storage.set('poe2-tree:last', JSON.stringify({ version: '0.5.0', className: 'Witch', allocated: ['2', 3, null] }));
    expect(loadPersistedSnapshot('0.5.0')).toEqual({ version: '0.5.0', className: 'Witch',
      ascendancyId: null, shared: ['2'], set1: [], set2: [] });
    expect(loadPersistedSnapshot('0.5.2')).toBeNull();
  });

  it('ignores corrupt or unavailable storage', () => {
    storage.set('poe2-tree:last', '{broken');
    expect(loadPersistedSnapshot('0.5.2')).toBeNull();
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('disabled'); } });
    expect(loadPersistedSnapshot('0.5.2')).toBeNull();
  });

  it('debounces build changes without hover events delaying the save', () => {
    stop = startPersistence('0.5.2');
    useStore.getState().setClass('Witch');
    vi.advanceTimersByTime(300);
    useStore.getState().commitAllocation(buildAllocation(['2'], ['3'], ['4']));
    vi.advanceTimersByTime(400);
    useStore.getState().setHovered({ nodeKey: '5', clientX: 0, clientY: 0 });
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(loadPersistedSnapshot('0.5.2')).toEqual({ version: '0.5.2', className: 'Witch',
      ascendancyId: null, shared: ['2'], set1: ['3'], set2: ['4'] });
  });

  it('cancels pending writes and unsubscribes on teardown', () => {
    stop = startPersistence('0.5.2');
    useStore.getState().setClass('Witch');
    stop();
    useStore.getState().commitAllocation(buildAllocation(['2'], [], []));
    vi.advanceTimersByTime(1000);
    expect(setItem).not.toHaveBeenCalled();
  });
});
