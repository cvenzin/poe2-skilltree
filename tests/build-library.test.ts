import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeBuildLibrary, nameCurrentBuild, useBuildLibrary } from '../src/state/buildLibrary';
import { beginSharedDraft, copyToTreeVersion, deleteSavedBuild, newBuild, saveBuildName, switchSavedBuild } from '../src/state/buildActions';
import { LIBRARY_KEY, LEGACY_KEY, parseLibrary } from '../src/state/buildStorage';
import { flushPersistence, loadPersistedSnapshot, readSnapshot, startPersistence } from '../src/state/persistence';
import { resolveBootVersion } from '../src/state/bootVersion';
import { buildAllocation } from '../src/state/allocation';
import { useStore, type BuildSnapshot } from '../src/state/store';
import { decodeShareHash, encodeShareHash, reconcileShareHash } from '../src/state/shareHash';
import { makeTree } from './fixtures/tree';

const storage = new Map<string, string>();
const setItem = vi.fn((key: string, value: string) => { storage.set(key, value); });
const snapshot: BuildSnapshot = { version: '0.5.5', className: 'Witch', ascendancyId: null,
  shared: ['2'], set1: ['3'], set2: ['6'] };
let stop: (() => void) | undefined;

function boot() {
  initializeBuildLibrary();
  useStore.setState({ activeVersion: snapshot.version });
  useStore.getState().loadSnapshot(loadPersistedSnapshot() ?? snapshot);
  // Keep fixture rendering dependencies out of these state-level tests.
  useStore.setState({ status: { kind: 'ready', version: snapshot.version, data: makeTree(), atlases: null! } });
  stop = startPersistence(snapshot.version);
}

beforeEach(() => {
  storage.clear(); setItem.mockClear();
  useStore.setState(useStore.getInitialState(), true);
  useBuildLibrary.setState(useBuildLibrary.getInitialState(), true);
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem });
  vi.stubGlobal('location', { pathname: '/', search: '', hash: '' });
  vi.stubGlobal('history', { replaceState: vi.fn() });
});
afterEach(() => {
  stop?.(); stop = undefined;
  useBuildLibrary.setState(useBuildLibrary.getInitialState(), true);
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('build library', () => {
  it('supports HTTP without randomUUID for legacy migration, naming, duplication and version copies', () => {
    vi.stubGlobal('crypto', { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) });
    storage.set(LEGACY_KEY, JSON.stringify(snapshot));
    boot();
    const migrated = useBuildLibrary.getState().library;
    expect(migrated.builds).toHaveLength(1);
    expect(useBuildLibrary.getState().storageBlocked).toBe(false);
    const migratedId = migrated.activeId;
    expect(saveBuildName('Renamed legacy')).toBe(true);
    expect(useBuildLibrary.getState().library.activeId).toBe(migratedId);
    expect(saveBuildName('Copy', true)).toBe(true);
    expect(newBuild()).toBe(true);
    expect(saveBuildName('New HTTP build')).toBe(true);
    expect(copyToTreeVersion('0.5.2', { ...snapshot, shared: ['2'] })).toBe(true);
    const library = useBuildLibrary.getState().library;
    expect(library.builds).toHaveLength(4);
    const ids = library.builds.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    useBuildLibrary.setState(useBuildLibrary.getInitialState(), true);
    initializeBuildLibrary();
    expect(useBuildLibrary.getState().library).toEqual(library);
  });

  it('starts a usable library when the legacy save is corrupt, keeping the original entry', () => {
    storage.set(LEGACY_KEY, '{broken');
    boot();
    expect(saveBuildName('Fresh build')).toBe(true);
    expect(storage.get(LEGACY_KEY)).toBe('{broken');
    expect(useBuildLibrary.getState().library.builds).toHaveLength(1);
  });

  it.each(['modern', 'legacy'])('migrates the %s last save once and preserves the original storage entry', (format) => {
    const raw = JSON.stringify(format === 'modern' ? snapshot : { ...snapshot, shared: undefined, allocated: ['2'] });
    storage.set(LEGACY_KEY, raw);
    initializeBuildLibrary();
    const library = useBuildLibrary.getState().library;
    expect(library.builds).toHaveLength(1);
    expect(library.builds[0]!.name).toBe('My build');
    expect(library.builds[0]!.snapshot.shared).toEqual(['2']);
    expect(library.activeId).toBe(library.builds[0]!.id);
    expect(storage.get(LEGACY_KEY)).toBe(raw);
    useBuildLibrary.setState(useBuildLibrary.getInitialState(), true);
    initializeBuildLibrary();
    expect(useBuildLibrary.getState().library).toEqual(library);
  });

  it('names, renames and duplicates using stable IDs, allowing duplicate names', () => {
    boot();
    expect(saveBuildName('  Build A  ')).toBe(true);
    const firstId = useBuildLibrary.getState().library.activeId;
    expect(saveBuildName('Build A renamed')).toBe(true);
    expect(useBuildLibrary.getState().library.activeId).toBe(firstId);
    expect(saveBuildName('Build A renamed', true)).toBe(true);
    const library = useBuildLibrary.getState().library;
    expect(library.builds).toHaveLength(2);
    expect(library.activeId).not.toBe(firstId);
    expect(library.builds[0]!.snapshot).toEqual(library.builds[1]!.snapshot);
    expect(saveBuildName('   ')).toBe(false);
    expect(useBuildLibrary.getState().library.builds).toHaveLength(2);
  });

  it('flushes pending edits before switching without overwriting either build and clears undo history', () => {
    boot(); saveBuildName('A');
    const firstId = useBuildLibrary.getState().library.activeId!;
    saveBuildName('B', true);
    const secondId = useBuildLibrary.getState().library.activeId!;
    useStore.getState().commitAllocation(buildAllocation(['2', '3'], [], ['6']));
    expect(switchSavedBuild(firstId)).toBe(true);
    vi.advanceTimersByTime(1000);
    const library = parseLibrary(storage.get(LIBRARY_KEY)!);
    expect(library.builds.find((b) => b.id === secondId)!.snapshot.shared).toEqual(['2', '3']);
    expect(library.builds.find((b) => b.id === firstId)!.snapshot.shared).toEqual(['2']);
    expect(useStore.getState().past).toEqual([]);
    expect(useStore.getState().future).toEqual([]);
    expect(readSnapshot(snapshot.version)!.set1).toEqual(['3']);
    expect(readSnapshot(snapshot.version)!.set2).toEqual(['6']);
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it.each(['rename', 'duplicate', 'failed duplicate'])('%s respects the current build history boundary', (action) => {
    boot(); saveBuildName('Original');
    useStore.getState().commitAllocation(buildAllocation(['2', '3'], [], ['6']));
    useStore.getState().commitAllocation(buildAllocation(['2', '3', '6'], [], []));
    useStore.getState().undo();
    const { past, future } = useStore.getState();
    expect(past).toHaveLength(1);
    expect(future).toHaveLength(1);
    const before = readSnapshot(snapshot.version);
    if (action === 'failed duplicate') setItem.mockImplementation(() => { throw new Error('quota'); });

    expect(saveBuildName('Changed', action !== 'rename')).toBe(action !== 'failed duplicate');
    if (action === 'duplicate') {
      expect(useStore.getState().past).toEqual([]);
      expect(useStore.getState().future).toEqual([]);
      useStore.getState().undo();
      useStore.getState().redo();
      expect(readSnapshot(snapshot.version)).toEqual(before);
      // New edits still get their own undo/redo history in the copy.
      useStore.getState().commitAllocation(buildAllocation(['2'], [], []));
      useStore.getState().undo();
      expect(readSnapshot(snapshot.version)).toEqual(before);
      useStore.getState().redo();
      expect(readSnapshot(snapshot.version)!.shared).toEqual(['2']);
    } else {
      expect(useStore.getState().past).toBe(past);
      expect(useStore.getState().future).toBe(future);
    }
    setItem.mockImplementation((key, value) => { storage.set(key, value); });
  });

  it('keeps duplicate allocations and attribute choices independent', () => {
    boot();
    useStore.setState({ attributeChoices: { '2': 'intelligence' }, defaultAttribute: 'intelligence' });
    saveBuildName('A');
    const firstId = useBuildLibrary.getState().library.activeId!;
    saveBuildName('B', true);
    useStore.setState({ attributeChoices: { '2': 'strength' }, defaultAttribute: 'strength' });
    useStore.getState().commitAllocation(buildAllocation(['2'], [], []));
    flushPersistence();
    const original = useBuildLibrary.getState().library.builds.find((b) => b.id === firstId)!;
    expect(original.snapshot.attributeChoices).toEqual({ '2': 'intelligence' });
    expect(original.snapshot.defaultAttribute).toBe('intelligence');
    expect(original.snapshot.set1).toEqual(['3']);
  });

  it('reopens the last active build and its tree version after a reload', () => {
    boot(); saveBuildName('A');
    const id = useBuildLibrary.getState().library.activeId;
    stop?.();
    useStore.setState(useStore.getInitialState(), true);
    useBuildLibrary.setState(useBuildLibrary.getInitialState(), true);
    initializeBuildLibrary();
    expect(useBuildLibrary.getState().library.activeId).toBe(id);
    expect(resolveBootVersion('')).toBe(snapshot.version);
    expect(loadPersistedSnapshot()).toEqual(snapshot);
    expect(resolveBootVersion('#v=0.5.2&c=Witch&n=Ag')).toBe('0.5.2');
  });

  it('opens shared links as separate drafts and supports legacy share round trips', () => {
    boot(); saveBuildName('Original');
    const original = useBuildLibrary.getState().library.builds[0]!;
    const raw = decodeShareHash('#v=0.5.5&c=Witch&n=Ag')!;
    const imported = reconcileShareHash(raw, makeTree())!;
    expect(beginSharedDraft({ version: snapshot.version, ...imported })).toBe(true);
    useStore.getState().loadSnapshot(imported);
    flushPersistence();
    expect(useBuildLibrary.getState().library.activeId).toBeNull();
    expect(useBuildLibrary.getState().library.builds[0]).toEqual(original);
    const hash = encodeShareHash({ version: snapshot.version, ...imported,
      sharedKeys: imported.shared, set1Keys: imported.set1, set2Keys: imported.set2 });
    expect(reconcileShareHash(decodeShareHash(hash)!, makeTree())).toEqual(imported);
    saveBuildName('Imported');
    expect(useBuildLibrary.getState().library.builds).toHaveLength(2);
  });

  it('keeps the source build when copying to another tree version', () => {
    boot(); saveBuildName('A');
    const original = useBuildLibrary.getState().library.builds[0]!;
    expect(copyToTreeVersion('0.5.2', snapshot)).toBe(true);
    expect(useBuildLibrary.getState().library.builds[0]).toEqual(original);
    expect(useBuildLibrary.getState().library.builds[1]!.snapshot.version).toBe('0.5.2');
    expect(useStore.getState().pendingVersionMigration?.version).toBe('0.5.2');
    // Old persistence must not write the old version into the newly selected build.
    flushPersistence();
    expect(loadPersistedSnapshot()!.version).toBe('0.5.2');
  });

  it('switches cross-version builds through the version loading flow', () => {
    boot(); saveBuildName('A');
    nameCurrentBuild('Older', { ...snapshot, version: '0.5.2' }, true);
    const id = useBuildLibrary.getState().library.activeId!;
    expect(switchSavedBuild(id)).toBe(true);
    expect(useStore.getState().activeVersion).toBe('0.5.2');
    expect(useStore.getState().pendingVersionMigration?.snapshot.shared).toEqual(['2']);
  });

  it('preserves an unnamed source draft when making a version copy', () => {
    boot();
    expect(copyToTreeVersion('0.5.2', snapshot)).toBe(true);
    const { builds } = useBuildLibrary.getState().library;
    expect(builds).toHaveLength(2);
    expect(builds[0]!.name).toBe('My build');
    expect(builds[0]!.snapshot).toEqual(snapshot);
    expect(builds[1]!.snapshot.version).toBe('0.5.2');
  });

  it('can view an initial shared build when storage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('disabled'); } });
    initializeBuildLibrary();
    expect(beginSharedDraft(snapshot)).toBe(true);
    expect(loadPersistedSnapshot()).toEqual(snapshot);
    expect(useBuildLibrary.getState().saveStatus).toBe('error');
  });

  it('deletes active builds, selects a remaining build, then creates a blank draft when empty', () => {
    boot(); saveBuildName('A');
    const firstId = useBuildLibrary.getState().library.activeId!;
    saveBuildName('B', true);
    const secondId = useBuildLibrary.getState().library.activeId!;
    expect(deleteSavedBuild(secondId)).toBe(true);
    expect(useBuildLibrary.getState().library.activeId).toBe(firstId);
    expect(deleteSavedBuild(firstId)).toBe(true);
    expect(useBuildLibrary.getState().library.builds).toEqual([]);
    expect(useBuildLibrary.getState().library.activeId).toBeNull();
    expect(readSnapshot(snapshot.version)!.shared).toEqual([]);
    useBuildLibrary.setState(useBuildLibrary.getInitialState(), true);
    initializeBuildLibrary();
    expect(useBuildLibrary.getState().library.builds).toEqual([]);
  });

  it('autosaves drafts, ignores hover changes and flushes on page exit', () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal('addEventListener', (event: string, fn: () => void) => listeners.set(event, fn));
    vi.stubGlobal('removeEventListener', (event: string) => listeners.delete(event));
    boot();
    setItem.mockClear();
    useStore.getState().setHovered({ nodeKey: '2', clientX: 0, clientY: 0 });
    vi.advanceTimersByTime(1000);
    expect(setItem).not.toHaveBeenCalled();
    useStore.getState().commitAllocation(buildAllocation(['2', '3'], [], []));
    listeners.get('pagehide')!();
    expect(parseLibrary(storage.get(LIBRARY_KEY)!).draft!.shared).toEqual(['2', '3']);
    stop?.();
    expect(listeners.size).toBe(0);
  });

  it('preserves work and shows a save error when storage is full; recovers when saving works', () => {
    boot(); saveBuildName('A');
    const before = storage.get(LIBRARY_KEY);
    setItem.mockImplementation(() => { throw new Error('quota'); });
    useStore.getState().commitAllocation(buildAllocation(['2', '3'], [], []));
    vi.advanceTimersByTime(500);
    expect(useBuildLibrary.getState().saveStatus).toBe('error');
    expect(newBuild()).toBe(false);
    expect(useStore.getState().allocation.shared.has('3')).toBe(true);
    expect(storage.get(LIBRARY_KEY)).toBe(before);
    setItem.mockImplementation((key, value) => { storage.set(key, value); });
    flushPersistence();
    expect(useBuildLibrary.getState().saveStatus).toBe('saved');
    expect(loadPersistedSnapshot()!.shared).toEqual(['2', '3']);
  });

  it('does not overwrite corrupt library data', () => {
    storage.set(LIBRARY_KEY, '{broken');
    boot();
    vi.advanceTimersByTime(1000);
    expect(useBuildLibrary.getState().saveStatus).toBe('error');
    expect(storage.get(LIBRARY_KEY)).toBe('{broken');
    expect(saveBuildName('A')).toBe(false);
  });
});
