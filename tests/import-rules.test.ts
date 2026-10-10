import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VERSION } from '../src/data/versions';
import { resolveBootVersion } from '../src/state/bootVersion';
import { loadPersistedSnapshot, reconcileSnapshot } from '../src/state/persistence';
import { decodeShareHash, encodeShareHash, reconcileShareHash } from '../src/state/shareHash';
import { useStore, type BuildSnapshot } from '../src/state/store';
import { makeTree, keys } from './fixtures/tree';

const storage = new Map<string, string>();
beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  storage.clear();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null });
});
afterEach(() => vi.unstubAllGlobals());

const snapshot: BuildSnapshot = { version: '0.5.2', className: 'Witch', ascendancyId: null,
  shared: ['2'], set1: [], set2: [] };
function hashOf(snap: BuildSnapshot) {
  return encodeShareHash({ ...snap, sharedKeys: snap.shared, set1Keys: snap.set1, set2Keys: snap.set2 });
}

describe('boot and snapshot context', () => {
  it('uses URL > saved build > default version, including legacy saved builds', () => {
    expect(resolveBootVersion('')).toBe(DEFAULT_VERSION);
    storage.set('poe2-tree:last', JSON.stringify({ version: '0.5.2', className: 'Witch', allocated: ['2'] }));
    expect(resolveBootVersion('')).toBe('0.5.2');
    expect(resolveBootVersion('#v=0.5.0&c=Witch')).toBe('0.5.0');
    expect(resolveBootVersion('#v=unknown&c=Witch')).toBe('0.5.2');
    expect(loadPersistedSnapshot()?.shared).toEqual(['2']);
    storage.set('poe2-tree:last', JSON.stringify({ ...snapshot, version: 'unknown' }));
    expect(resolveBootVersion('')).toBe(DEFAULT_VERSION);
  });

  it('resets hidden allocation modes and transient context on same-version imports', () => {
    const state = useStore.getState();
    state.loadSnapshot({ ...snapshot, set1: ['3'] });
    state.setAllocationMode('set1');
    state.setSearch('test', ['11']);
    state.setHovered({ nodeKey: '11', clientX: 0, clientY: 0 });
    state.loadSnapshot(snapshot);
    const loaded = useStore.getState();
    expect(loaded.allocationMode).toBe('shared');
    expect(loaded.weaponSetsEnabled).toBe(false);
    expect(loaded.hovered).toBeNull();
    expect(loaded.searchMatches).toEqual([]);
    expect(loaded.searchQuery).toBe('');
    expect(loaded.past).toEqual([]);
    expect(loaded.future).toEqual([]);
  });

  it('drops a playable ascendancy that belongs to a different class identically in storage and sharing', () => {
    const data = makeTree({ '20': { ascendancyId: 'Druid1' } });
    data.playableAscendancyIds.add('Druid1');
    const snap = { ...snapshot, ascendancyId: 'Druid1', shared: ['2', '20'] };
    const expected = { className: 'Witch', ascendancyId: null, shared: ['2'], set1: [], set2: [] };
    expect(reconcileSnapshot(snap, data)).toEqual(expected);
    expect(reconcileShareHash(decodeShareHash(hashOf(snap))!, data)).toEqual(expected);
  });
});

describe('import budgets and shared-only skills', () => {
  const passives = keys(100, 125);
  const asc = keys(1000, 9);
  const data = makeTree({ '4': { isKeystone: true }, '5': { isJewelSocket: true },
    '11': { grantedPassivePoints: 1, weaponPassivePointsGranted: 100 },
    ...Object.fromEntries(passives.map((key) => [key, {}])),
    ...Object.fromEntries(asc.map((key) => [key, { ascendancyId: 'Witch1' }])) });

  it.each([
    { shared: passives.slice(0, 124) },
    { set1: passives.slice(0, 25) },
    { set2: passives.slice(0, 25) },
    { ascendancyId: 'Witch1', shared: asc },
    { set1: ['4'] }, { set2: ['5'] },
  ])('rejects invalid storage, share hashes and direct ready-store imports: %j', (change) => {
    const snap = { ...snapshot, ...change };
    expect(reconcileSnapshot(snap, data)).toBeNull();
    expect(reconcileShareHash(decodeShareHash(hashOf(snap))!, data)).toBeNull();
    useStore.setState({ status: { kind: 'ready', version: '0.5.2', data, atlases: {} as never } });
    const before = useStore.getState().allocation;
    useStore.getState().loadSnapshot(snap);
    expect(useStore.getState().allocation).toBe(before);
    expect(useStore.getState().validationMessage).toBeTruthy();
  });

  it('accepts effective bonus budgets and round-trips both sets', () => {
    const snap = { ...snapshot, ascendancyId: 'Witch1', shared: ['11', ...passives.slice(0, 99)],
      set1: passives.slice(99, 124), set2: [passives[124]!] };
    storage.set('poe2-tree:last', JSON.stringify(snap));
    expect(reconcileSnapshot(loadPersistedSnapshot('0.5.2')!, data)).toMatchObject({ set1: snap.set1, set2: snap.set2 });
    expect(reconcileShareHash(decodeShareHash(hashOf(snap))!, data)).toMatchObject({ set1: snap.set1, set2: snap.set2 });
  });

  it('moves legacy exclusive ascendancy skills to shared without moving keystones or sockets', () => {
    const snap = { ...snapshot, ascendancyId: 'Witch1', set1: ['11', '3'] };
    expect(reconcileSnapshot(snap, data)).toMatchObject({ shared: ['2', '11'], set1: ['3'], set2: [] });
    expect(reconcileShareHash(decodeShareHash(hashOf(snap))!, data)).toMatchObject({ shared: ['2', '11'], set1: ['3'] });
  });
});
