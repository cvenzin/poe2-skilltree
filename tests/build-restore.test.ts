import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeBuildLibrary, useBuildLibrary } from '../src/state/buildLibrary';
import { LIBRARY_KEY, parseLibrary, type BuildLibrary } from '../src/state/buildStorage';
import { applyBootSnapshot, handleSharedHashChange } from '../src/state/buildRestore';
import { flushPersistence, loadPersistedSnapshot, readSnapshot, startPersistence } from '../src/state/persistence';
import { resolveBootVersion } from '../src/state/bootVersion';
import { useStore, type BuildSnapshot } from '../src/state/store';
import { buildAllocation } from '../src/state/allocation';
import { makeTree } from './fixtures/tree';

const original: BuildSnapshot = { version: '0.5.5', className: 'Witch', ascendancyId: null,
  shared: ['2'], set1: ['3'], set2: ['6'] };
const storage = new Map<string, string>();
let full = false;
let stop: (() => void) | undefined;

function loadVersion(version: string) {
  const data = makeTree();
  useStore.getState().setActiveVersion(version);
  useStore.setState({ status: { kind: 'ready', version, data, atlases: null! } });
  applyBootSnapshot(version, data, useStore.getState().loadSnapshot);
  stop = startPersistence(version);
}

function reload() {
  stop?.(); stop = undefined;
  useStore.setState(useStore.getInitialState(), true);
  useBuildLibrary.setState(useBuildLibrary.getInitialState(), true);
  initializeBuildLibrary();
  loadVersion(resolveBootVersion(location.hash));
}

beforeEach(() => {
  vi.useFakeTimers(); full = false; storage.clear();
  useStore.setState(useStore.getInitialState(), true);
  useBuildLibrary.setState(useBuildLibrary.getInitialState(), true);
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { if (full) throw new Error('quota'); storage.set(key, value); },
  });
  vi.stubGlobal('location', { pathname: '/', search: '', hash: '' });
  const library: BuildLibrary = { schema: 1, activeId: 'original', draft: null,
    builds: [{ id: 'original', name: 'Original', updatedAt: 1, snapshot: original }] };
  storage.set(LIBRARY_KEY, JSON.stringify(library));
  initializeBuildLibrary();
  loadVersion(original.version);
});

afterEach(() => {
  stop?.(); stop = undefined;
  useBuildLibrary.setState(useBuildLibrary.getInitialState(), true);
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('build restore save failures', () => {
  it('blocks a cross-version share link until pending edits save, then opens an independent draft', () => {
    useStore.getState().commitAllocation(buildAllocation(['2', '3'], [], ['6']));
    const edited = readSnapshot(original.version);
    const past = useStore.getState().past;
    const saved = storage.get(LIBRARY_KEY);
    full = true;
    location.hash = '#v=0.5.2&c=Witch&n=Ag';
    handleSharedHashChange();
    expect(useStore.getState().activeVersion).toBe(original.version);
    expect(useBuildLibrary.getState().library.activeId).toBe('original');
    expect(useBuildLibrary.getState().saveStatus).toBe('error');
    expect(readSnapshot(original.version)).toEqual(edited);
    expect(useStore.getState().past).toBe(past);
    expect(storage.get(LIBRARY_KEY)).toBe(saved);

    full = false;
    handleSharedHashChange();
    expect(useStore.getState().activeVersion).toBe('0.5.2');
    stop?.();
    loadVersion('0.5.2');
    expect(useBuildLibrary.getState().library.activeId).toBeNull();
    expect(readSnapshot('0.5.2')!.shared).toEqual(['2']);
    expect(useStore.getState().past).toEqual([]);
    expect(parseLibrary(storage.get(LIBRARY_KEY)!).builds[0]!.snapshot).toEqual(edited);
  });

  it.each(['shared URL', 'blank fallback'])('keeps the source intact when a %s cannot be saved after switching versions', (mode) => {
    const saved = storage.get(LIBRARY_KEY);
    location.hash = mode === 'shared URL' ? '#v=0.5.2&c=Witch&n=Ag' : '#v=0.5.2&c=Invalid&n=Ag';
    handleSharedHashChange();
    stop?.();
    full = true;
    loadVersion('0.5.2');
    expect(useBuildLibrary.getState().saveStatus).toBe('error');
    expect(useBuildLibrary.getState().library.activeId).toBeNull();
    expect(useBuildLibrary.getState().library.builds[0]!.snapshot).toEqual(original);
    expect(storage.get(LIBRARY_KEY)).toBe(saved);
    expect(readSnapshot('0.5.2')!.shared).toEqual(mode === 'shared URL' ? ['2'] : []);

    full = false;
    flushPersistence();
    const library = parseLibrary(storage.get(LIBRARY_KEY)!);
    expect(library.builds[0]!.snapshot).toEqual(original);
    expect(library.draft).toEqual(readSnapshot('0.5.2'));
    expect(useBuildLibrary.getState().saveStatus).toBe('saved');
    // A base-URL reload selects the recovered draft, keeping the source available.
    location.hash = '';
    reload();
    expect(resolveBootVersion('')).toBe('0.5.2');
    expect(loadPersistedSnapshot()).toEqual(library.draft);
    expect(useBuildLibrary.getState().library.builds[0]!.snapshot).toEqual(original);
  });

  it('opens a startup shared link in memory when storage is already full', () => {
    full = true;
    location.hash = '#v=0.5.2&c=Witch&n=Ag';
    reload();
    expect(useBuildLibrary.getState().library.activeId).toBeNull();
    expect(useBuildLibrary.getState().library.builds[0]!.snapshot).toEqual(original);
    expect(readSnapshot('0.5.2')!.shared).toEqual(['2']);
    expect(useBuildLibrary.getState().saveStatus).toBe('error');
  });
});
