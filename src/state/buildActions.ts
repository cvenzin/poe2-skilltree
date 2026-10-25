import { VERSIONS } from '../data/versions';
import { loadTreeData } from '../data/loader';
import { useStore, type BuildSnapshot } from './store';
import { flushPersistence, readSnapshot, reconcileSnapshot } from './persistence';
import { currentBuildName, nameCurrentBuild, useBuildLibrary, writeLibrary } from './buildLibrary';

export function clearBuildHash(): void {
  globalThis.history.replaceState(null, '', `${globalThis.location.pathname}${globalThis.location.search}`);
}

export function saveBeforeLeaving(): boolean {
  flushPersistence();
  return useBuildLibrary.getState().saveStatus !== 'error';
}

/** Shared links are independent drafts, including links opened through browser navigation. */
export function beginSharedDraft(snapshot: BuildSnapshot, { restoring = false } = {}): boolean {
  if (!restoring && !saveBeforeLeaving()) {
    const { library } = useBuildLibrary.getState();
    if (library.builds.length || library.draft) return false;
    // The viewer must still open shared URLs when storage is unavailable.
    useBuildLibrary.setState({ library: { ...library, activeId: null, draft: snapshot } });
    return true;
  }
  const { library } = useBuildLibrary.getState();
  const next = { ...library, activeId: null, draft: snapshot };
  if (writeLibrary(next)) return true;
  if (!restoring) return false;
  // Restore runs before persistence starts. Keep the loaded tree in a separate
  // in-memory draft even when storage fails, preserving every named snapshot.
  useBuildLibrary.setState({ library: next });
  return true;
}

export function switchSavedBuild(id: string): boolean {
  const s = useStore.getState();
  const build = useBuildLibrary.getState().library.builds.find((b) => b.id === id);
  if (!build || !(VERSIONS as readonly string[]).includes(build.snapshot.version)) {
    s.setValidationMessage('This build needs a tree version that is not available.');
    return false;
  }
  const snapshot = s.status.kind === 'ready' && build.snapshot.version === s.activeVersion
    ? reconcileSnapshot(build.snapshot, s.status.data) : build.snapshot;
  if (!snapshot) { s.setValidationMessage('This saved build could not be loaded.'); return false; }
  if (!saveBeforeLeaving()) return false;
  const { library } = useBuildLibrary.getState();
  if (!writeLibrary({ ...library, activeId: id, draft: null })) return false;
  clearBuildHash();
  if (s.activeVersion === build.snapshot.version) {
    s.loadSnapshot(snapshot);
    flushPersistence();
  } else s.setActiveVersion(build.snapshot.version, snapshot);
  return true;
}

export function newBuild(): boolean {
  const s = useStore.getState();
  if (s.status.kind !== 'ready' || !s.activeVersion || !saveBeforeLeaving()) return false;
  const className = s.status.data.classes[s.status.data.playableClassIndices[0]!]?.name;
  if (!className) return false;
  const draft: BuildSnapshot = { version: s.activeVersion, className, ascendancyId: null, shared: [], set1: [], set2: [] };
  if (!writeLibrary({ ...useBuildLibrary.getState().library, activeId: null, draft })) return false;
  clearBuildHash();
  s.loadSnapshot(draft);
  flushPersistence();
  return true;
}

export function saveBuildName(name: string, duplicate = false): boolean {
  const version = useStore.getState().activeVersion;
  const snapshot = version ? readSnapshot(version) : null;
  if (!snapshot || !name.trim() || !saveBeforeLeaving()) return false;
  if (!nameCurrentBuild(name, snapshot, duplicate)) return false;
  if (duplicate) useStore.setState({ past: [], future: [] });
  clearBuildHash();
  return true;
}

export function deleteSavedBuild(id: string): boolean {
  if (!saveBeforeLeaving()) return false;
  const { library } = useBuildLibrary.getState();
  const builds = library.builds.filter((b) => b.id !== id);
  if (library.activeId !== id) return writeLibrary({ ...library, builds });
  // Switch successfully before deleting, so a failed load cannot lose the current tree.
  const next = builds.find((b) => (VERSIONS as readonly string[]).includes(b.snapshot.version));
  if (!(next ? switchSavedBuild(next.id) : newBuild())) return false;
  const latest = useBuildLibrary.getState().library;
  return writeLibrary({ ...latest, builds: latest.builds.filter((b) => b.id !== id) });
}

/** Version changes preserve the source and save the converted tree as a separate build. */
export function copyToTreeVersion(version: string, snapshot: Omit<BuildSnapshot, 'version'>): boolean {
  const s = useStore.getState();
  if (version === s.activeVersion || !saveBeforeLeaving()) return false;
  if (!currentBuildName()) {
    const source = s.activeVersion ? readSnapshot(s.activeVersion) : null;
    if (!source || !nameCurrentBuild('My build', source)) return false;
  }
  const name = `${currentBuildName() ?? 'My build'} (${version})`;
  if (!nameCurrentBuild(name, { ...snapshot, version }, true)) return false;
  clearBuildHash();
  s.setActiveVersion(version, snapshot);
  return true;
}

let versionRequest = 0;

export async function changeBuildVersion(version: string): Promise<void> {
  // Even selecting the current version cancels an earlier pending selection.
  const request = ++versionRequest;
  const s = useStore.getState();
  const sourceId = useBuildLibrary.getState().library.activeId;
  const source = s.activeVersion ? readSnapshot(s.activeVersion) : null;
  if (!source || version === source.version) return;
  try {
    const data = await loadTreeData(version);
    if (request !== versionRequest || useBuildLibrary.getState().library.activeId !== sourceId || useStore.getState().activeVersion !== source.version ||
      JSON.stringify(readSnapshot(source.version)) !== JSON.stringify(source)) return;
    const snapshot = reconcileSnapshot(source, data);
    if (!snapshot) { s.setValidationMessage('This build cannot be carried into that tree version.'); return; }
    const kept = new Set([...snapshot.shared, ...snapshot.set1, ...snapshot.set2]);
    const changed = [...source.shared, ...source.set1, ...source.set2].some((key) => !kept.has(key)) ||
      snapshot.ascendancyId !== source.ascendancyId ||
      JSON.stringify(snapshot.attributeChoices) !== JSON.stringify(source.attributeChoices) ||
      snapshot.defaultAttribute !== source.defaultAttribute;
    if (changed && !globalThis.confirm(`Create a copy for tree ${version}? Some allocations or attribute choices are unavailable and will be removed. Your original build will be kept.`)) return;
    copyToTreeVersion(version, snapshot);
  } catch {
    if (request !== versionRequest || useBuildLibrary.getState().library.activeId !== sourceId ||
      useStore.getState().activeVersion !== source.version ||
      JSON.stringify(readSnapshot(source.version)) !== JSON.stringify(source)) return;
    s.setValidationMessage('Could not load that tree version. Your current build has been kept.');
  }
}
