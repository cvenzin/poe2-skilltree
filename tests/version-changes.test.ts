import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadTreeData } from '../src/data/loader';
import { changeBuildVersion } from '../src/state/buildActions';
import { useBuildLibrary } from '../src/state/buildLibrary';
import { useStore } from '../src/state/store';
import { makeTree } from './fixtures/tree';

vi.mock('../src/data/loader', () => ({ loadTreeData: vi.fn() }));

function deferred() {
  let resolve!: (data: ReturnType<typeof makeTree>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReturnType<typeof makeTree>>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  useBuildLibrary.setState(useBuildLibrary.getInitialState(), true);
  vi.mocked(loadTreeData).mockReset();
  vi.stubGlobal('localStorage', { setItem: vi.fn(), getItem: () => null });
  vi.stubGlobal('history', { replaceState: vi.fn() });
  vi.stubGlobal('location', { pathname: '/', search: '' });
  vi.stubGlobal('confirm', vi.fn(() => true));
  useStore.setState({ activeVersion: '0.5.5', className: 'Witch',
    status: { kind: 'ready', version: '0.5.5', data: makeTree(), atlases: {} as never } });
  useStore.getState().loadSnapshot({ className: 'Witch', ascendancyId: null, shared: ['2'], set1: [], set2: [] });
});
afterEach(() => vi.unstubAllGlobals());

describe('latest tree-version selection', () => {
  it.each(['first', 'last'])('keeps the last selection when the %s request resolves first', async (order) => {
    const first = deferred(), last = deferred();
    vi.mocked(loadTreeData).mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
    const a = changeBuildVersion('0.5.2');
    const b = changeBuildVersion('0.5.1');
    if (order === 'first') {
      first.resolve(makeTree()); await a;
      expect(useStore.getState().activeVersion).toBe('0.5.5');
      expect(useBuildLibrary.getState().library.builds).toHaveLength(0);
      last.resolve(makeTree()); await b;
    } else {
      last.resolve(makeTree()); await b;
      first.resolve(makeTree()); await a;
    }
    expect(useStore.getState().activeVersion).toBe('0.5.1');
    expect(useStore.getState().pendingVersionMigration?.version).toBe('0.5.1');
    const builds = useBuildLibrary.getState().library.builds;
    expect(builds.map((build) => build.snapshot.version)).toEqual(['0.5.5', '0.5.1']);
  });

  it('cancels pending changes when the current version is selected again', async () => {
    const first = deferred();
    vi.mocked(loadTreeData).mockReturnValue(first.promise);
    const a = changeBuildVersion('0.5.2');
    await changeBuildVersion('0.5.5');
    first.resolve(makeTree()); await a;
    expect(useStore.getState().activeVersion).toBe('0.5.5');
    expect(useBuildLibrary.getState().library.builds).toHaveLength(0);
  });

  it('ignores stale failures and never confirms a stale lossy migration', async () => {
    const first = deferred(), last = deferred();
    vi.mocked(loadTreeData).mockReturnValueOnce(first.promise).mockReturnValueOnce(last.promise);
    const a = changeBuildVersion('0.5.2');
    const b = changeBuildVersion('0.5.1');
    last.resolve(makeTree()); await b;
    first.reject(new Error('old failure')); await a;
    expect(useStore.getState().validationMessage).toBeNull();
    expect(globalThis.confirm).not.toHaveBeenCalled();
    expect(useStore.getState().activeVersion).toBe('0.5.1');
  });

  it('reports a failure of the latest selection while keeping the source', async () => {
    vi.mocked(loadTreeData).mockRejectedValue(new Error('offline'));
    await changeBuildVersion('0.5.2');
    expect(useStore.getState().activeVersion).toBe('0.5.5');
    expect(useStore.getState().validationMessage).toContain('Could not load');
    expect(useBuildLibrary.getState().library.builds).toHaveLength(0);
  });

  it('keeps edits made while a version load is pending', async () => {
    const first = deferred();
    vi.mocked(loadTreeData).mockReturnValue(first.promise);
    const a = changeBuildVersion('0.5.2');
    useStore.getState().setClass('Ranger');
    first.resolve(makeTree()); await a;
    expect(useStore.getState().activeVersion).toBe('0.5.5');
    expect(useStore.getState().className).toBe('Ranger');
    expect(useBuildLibrary.getState().library.builds).toHaveLength(0);
  });
});
