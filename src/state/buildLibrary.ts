import { create } from 'zustand';
import type { BuildSnapshot } from './store';
import { LIBRARY_KEY, LEGACY_KEY, parseLibrary, parseSnapshot, selectedSnapshot, type BuildLibrary } from './buildStorage';

interface LibraryState {
  initialized: boolean;
  library: BuildLibrary;
  saveStatus: 'saved' | 'saving' | 'error';
  error: string | null;
  storageBlocked: boolean;
}

const emptyLibrary = (): BuildLibrary => ({ schema: 1, builds: [], activeId: null, draft: null });
export const useBuildLibrary = create<LibraryState>(() => ({
  initialized: false, library: emptyLibrary(), saveStatus: 'saved', error: null, storageBlocked: false,
}));

const saveError = 'Could not save in this browser. Keep this page open and use Share or Export to back up your build.';

/** Write before committing library actions so failed saves never discard the current build. */
export function writeLibrary(library: BuildLibrary): boolean {
  if (useBuildLibrary.getState().storageBlocked) {
    useBuildLibrary.setState({ saveStatus: 'error' });
    return false;
  }
  try {
    const raw = JSON.stringify(library);
    if (localStorage.getItem(LIBRARY_KEY) !== raw) localStorage.setItem(LIBRARY_KEY, raw);
    useBuildLibrary.setState({ library, saveStatus: 'saved', error: null });
    return true;
  } catch {
    useBuildLibrary.setState({ saveStatus: 'error', error: saveError });
    return false;
  }
}

export function initializeBuildLibrary(): void {
  if (useBuildLibrary.getState().initialized) return;
  try {
    const raw = localStorage.getItem(LIBRARY_KEY);
    let library = raw ? parseLibrary(raw) : emptyLibrary();
    if (!raw) {
      const legacyRaw = localStorage.getItem(LEGACY_KEY);
      let snapshot: BuildSnapshot | null = null;
      // An unreadable legacy save stays as a backup without blocking a fresh library.
      try { snapshot = legacyRaw ? parseSnapshot(JSON.parse(legacyRaw)) : null; } catch { /* preserve legacy entry */ }
      if (snapshot) {
        const id = crypto.randomUUID();
        library = { ...library, activeId: id, builds: [{ id, name: 'My build', updatedAt: Date.now(), snapshot }] };
      }
    }
    useBuildLibrary.setState({ initialized: true, library });
    if (library.builds.length) writeLibrary(library);
  } catch {
    useBuildLibrary.setState({ initialized: true, saveStatus: 'error', storageBlocked: true,
      error: 'Saved builds could not be read. Existing browser data has been left unchanged. Use Share or Export to back up your work.' });
  }
}

export function currentBuildName(): string | undefined {
  const { library } = useBuildLibrary.getState();
  return library.builds.find((b) => b.id === library.activeId)?.name;
}

export function persistLibrarySnapshot(snapshot: BuildSnapshot): boolean {
  const { library } = useBuildLibrary.getState();
  if (JSON.stringify(selectedSnapshot(library)) === JSON.stringify(snapshot) &&
    useBuildLibrary.getState().error === null) {
    useBuildLibrary.setState({ saveStatus: 'saved' });
    return true;
  }
  const next = library.activeId ? {
    ...library, builds: library.builds.map((b) => b.id === library.activeId ? { ...b, snapshot, updatedAt: Date.now() } : b),
  } : { ...library, draft: snapshot };
  // Retain the latest snapshot in memory even if browser storage fills up.
  if (!writeLibrary(next)) { useBuildLibrary.setState({ library: next }); return false; }
  return true;
}

export function nameCurrentBuild(name: string, snapshot: BuildSnapshot, duplicate = false): boolean {
  name = name.trim();
  if (!name) return false;
  const { library } = useBuildLibrary.getState();
  const id = duplicate || !library.activeId ? crypto.randomUUID() : library.activeId;
  const build = { id, name, snapshot, updatedAt: Date.now() };
  return writeLibrary({ ...library, activeId: id, draft: null,
    builds: library.builds.some((b) => b.id === id)
      ? library.builds.map((b) => b.id === id ? build : b) : [...library.builds, build] });
}
