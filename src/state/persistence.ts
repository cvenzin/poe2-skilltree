import { useStore, allocationBudgetError, type BuildSnapshot } from './store';
import { exclusiveAllocationError, multipleChoiceAllocationError, revalidateAllocation, shareAscendancyAllocation } from './buildRules';
import { useBuildLibrary, persistLibrarySnapshot } from './buildLibrary';
import { LIBRARY_KEY, parseLibrary, parseSnapshot, selectedSnapshot } from './buildStorage';
import type { TreeData } from '../data/types';
import { buildAllocation } from './allocation';
import { attributeOptions, parseAttributeChoices, reconcileAttributeChoices } from './attributes';

/** localStorage key for the last saved build. */
const STORAGE_KEY = 'poe2-tree:last';
const DEBOUNCE_MS = 500;

/** Snapshot the current store state into a JSON-friendly build descriptor.
 *  Returns null if no class is set (nothing meaningful to save). */
export function readSnapshot(version: string): BuildSnapshot | null {
  const s = useStore.getState();
  if (!s.className) return null;
  return {
    version,
    className: s.className,
    ascendancyId: s.ascendancyId,
    shared: [...s.allocation.shared],
    set1: [...s.allocation.set1],
    set2: [...s.allocation.set2],
    ...(Object.keys(s.attributeChoices).length ? { attributeChoices: s.attributeChoices } : {}),
    ...(s.defaultAttribute ? { defaultAttribute: s.defaultAttribute } : {}),
  };
}

/** Validate a stored snapshot against the live data: the class must still be
 *  playable, the ascendancy (if any) must still belong to that class, and
 *  every allocated node key must still exist. Drops the ones that don't, and
 *  dedupes and revalidates connectivity / constraints in each weapon set.
 *  Returns null for unusable classes, conflicting choices, exceeded budgets,
 *  or exclusive keystones/sockets. */
export function reconcileSnapshot(snap: BuildSnapshot, data: TreeData): Omit<BuildSnapshot, 'version'> | null {
  const cls = data.classes.find((c, index) => c.name === snap.className && data.playableClassIndices.includes(index));
  if (!cls) return null;
  const ascendancyId =
    snap.ascendancyId && cls.ascendancies.some((asc) => asc.id === snap.ascendancyId) &&
      data.playableAscendancyIds.has(snap.ascendancyId)
      ? snap.ascendancyId
      : null;
  const exists = (k: string) => data.nodes[k] !== undefined &&
    (!data.nodes[k]!.ascendancyId || data.nodes[k]!.ascendancyId === ascendancyId);
  const normalized = shareAscendancyAllocation(buildAllocation(
    snap.shared.filter(exists),
    snap.set1.filter(exists),
    snap.set2.filter(exists),
  ), data);
  if (exclusiveAllocationError(normalized, data)) return null;
  // Removing unavailable nodes can orphan branches or their unlock gates.
  // Use the same fixed-point cascade as edits, preserving legal radius roots.
  const alloc = revalidateAllocation(normalized, data, snap.className, ascendancyId);
  const choices = reconcileAttributeChoices(parseAttributeChoices(snap.attributeChoices), alloc, data, ascendancyId);
  if (multipleChoiceAllocationError(alloc, data) || allocationBudgetError(alloc, ascendancyId, data)) return null;
  const defaultAttribute = attributeOptions(data, alloc, ascendancyId).find((option) => option.choice === snap.defaultAttribute)?.choice;
  return {
    className: snap.className,
    ascendancyId,
    shared: [...alloc.shared],
    set1: [...alloc.set1],
    set2: [...alloc.set2],
    ...(Object.keys(choices).length ? { attributeChoices: choices } : {}),
    ...(defaultAttribute ? { defaultAttribute } : {}),
  };
}

/** Read the persisted snapshot for the given version. Returns null on absent,
 *  malformed, or version-mismatched data.
 *
 *  Backward compatibility: pre-weapon-set builds stored a single `allocated`
 *  list. Those load as shared-only — `allocated` → `shared`, set1/set2 empty,
 *  Weapon Set 1 active. */
export function loadPersistedSnapshot(version?: string): BuildSnapshot | null {
  try {
    const state = useBuildLibrary.getState();
    let snapshot: BuildSnapshot | null;
    if (state.initialized) snapshot = selectedSnapshot(state.library);
    else {
      const libraryRaw = localStorage.getItem(LIBRARY_KEY);
      const raw = localStorage.getItem(STORAGE_KEY);
      snapshot = libraryRaw ? selectedSnapshot(parseLibrary(libraryRaw)) : raw ? parseSnapshot(JSON.parse(raw)) : null;
    }
    return snapshot && (version === undefined || snapshot.version === version) ? snapshot : null;
  } catch {
    return null;
  }
}

/**
 * Save the restored build immediately, then subscribe to store changes and
 * auto-persist edits with a 500 ms debounce. Returns an unsubscribe function.
 *
 * Only fields that belong in a build are watched — `hovered`, `previewPath`,
 * `past`, `future`, `rejectionTick` etc. are not. (Subscribing to them would
 * thrash the debounce on every pointer move.)
 */
let flushPending: (() => void) | undefined;
export function flushPersistence(): void { flushPending?.(); }

export function startPersistence(version: string): () => void {
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let lastSerialised: string | null = null;
  try { lastSerialised = localStorage.getItem(STORAGE_KEY); } catch { /* storage disabled */ }

  const writeIfChanged = () => {
    if (timer !== undefined) globalThis.clearTimeout(timer);
    timer = undefined;
    const snap = readSnapshot(version);
    if (!snap) return;
    if (useBuildLibrary.getState().initialized) {
      if (useStore.getState().activeVersion !== version) return;
      persistLibrarySnapshot(snap);
      return;
    }
    const next = JSON.stringify(snap);
    if (next === lastSerialised) return;
    try {
      localStorage.setItem(STORAGE_KEY, next);
      lastSerialised = next;
    } catch {
      // Quota exceeded or storage disabled — silently drop. Save is best-effort.
    }
  };

  // Restore and version migration happen before this subscription starts.
  // Save that state now so a reload keeps the selected version without an edit.
  writeIfChanged();
  flushPending = writeIfChanged;
  const onPageHide = () => writeIfChanged();
  globalThis.addEventListener?.('pagehide', onPageHide);
  const onVisibility = () => { if (document.visibilityState === 'hidden') writeIfChanged(); };
  globalThis.document?.addEventListener('visibilitychange', onVisibility);

  const schedule = () => {
    if (useBuildLibrary.getState().initialized) useBuildLibrary.setState({ saveStatus: 'saving' });
    if (timer !== undefined) globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(writeIfChanged, DEBOUNCE_MS);
  };

  const unsub = useStore.subscribe((s, prev) => {
    if (
      s.allocation !== prev.allocation ||
      s.attributeChoices !== prev.attributeChoices ||
      s.defaultAttribute !== prev.defaultAttribute ||
      s.className !== prev.className ||
      s.ascendancyId !== prev.ascendancyId
    ) {
      schedule();
    }
  });

  return () => {
    unsub();
    if (flushPending === writeIfChanged) flushPending = undefined;
    globalThis.removeEventListener?.('pagehide', onPageHide);
    globalThis.document?.removeEventListener('visibilitychange', onVisibility);
    if (timer !== undefined) globalThis.clearTimeout(timer);
  };
}

/** Manual purge — wired to a "Clear saved build" link in a settings menu later. */
export function clearPersistedSnapshot(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
