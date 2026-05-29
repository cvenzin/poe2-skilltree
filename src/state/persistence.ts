import { useStore, type BuildSnapshot } from './store';
import type { TreeData } from '../data/types';
import { buildAllocation, pruneAllocation } from './allocation';

/** localStorage key (INSTRUCTIONS.md §10.5). */
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
  };
}

/** Validate a stored snapshot against the live data: the class must still be
 *  playable, the ascendancy (if any) must still belong to that class, and
 *  every allocated node key must still exist. Drops the ones that don't, and
 *  dedupes / constraint-prunes the weapon-set buckets. Returns null if the
 *  class itself isn't usable. */
export function reconcileSnapshot(snap: BuildSnapshot, data: TreeData): Omit<BuildSnapshot, 'version'> | null {
  const cls = data.classes.find((c) => c.name === snap.className);
  if (!cls || cls.ascendancies.length === 0) return null;
  const ascendancyId =
    snap.ascendancyId && data.playableAscendancyIds.has(snap.ascendancyId)
      ? snap.ascendancyId
      : null;
  const exists = (k: string) => data.nodes[k] !== undefined;
  // Build a normalized allocation (a key lives in exactly one bucket), then
  // drop constraint-locked nodes the imported state doesn't satisfy — e.g. a
  // build saved on Druid Oracle with "The Unseen Path", imported on a different
  // ascendancy, loses the Forbidden Path nodes.
  const alloc = pruneAllocation(
    buildAllocation(
      snap.shared.filter(exists),
      snap.set1.filter(exists),
      snap.set2.filter(exists),
    ),
    ascendancyId,
    data,
  );
  return {
    className: snap.className,
    ascendancyId,
    shared: [...alloc.shared],
    set1: [...alloc.set1],
    set2: [...alloc.set2],
  };
}

/** Read the persisted snapshot for the given version. Returns null on absent,
 *  malformed, or version-mismatched data.
 *
 *  Backward compatibility: pre-weapon-set builds stored a single `allocated`
 *  list. Those load as shared-only — `allocated` → `shared`, set1/set2 empty,
 *  Weapon Set 1 active. */
export function loadPersistedSnapshot(version: string): BuildSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BuildSnapshot> & { allocated?: unknown };
    if (parsed.version !== version) return null;
    if (typeof parsed.className !== 'string') return null;

    const asStrings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];

    // New format has `shared`; legacy format has only `allocated` → shared.
    const hasNewFormat = Array.isArray(parsed.shared);
    const shared = hasNewFormat ? asStrings(parsed.shared) : asStrings(parsed.allocated);
    if (!hasNewFormat && !Array.isArray(parsed.allocated)) return null;

    return {
      version,
      className: parsed.className,
      ascendancyId: typeof parsed.ascendancyId === 'string' ? parsed.ascendancyId : null,
      shared,
      set1: asStrings(parsed.set1),
      set2: asStrings(parsed.set2),
    };
  } catch {
    // Corrupt JSON or storage disabled — start fresh.
    return null;
  }
}

/**
 * Subscribe to store changes and auto-persist the build to localStorage,
 * debounced 500 ms. Returns an unsubscribe function.
 *
 * Only fields that belong in a build are watched — `hovered`, `previewPath`,
 * `past`, `future`, `rejectionTick` etc. are not. (Subscribing to them would
 * thrash the debounce on every pointer move.)
 */
export function startPersistence(version: string): () => void {
  let timer: number | undefined;
  let lastSerialised: string | null = null;

  const writeIfChanged = () => {
    timer = undefined;
    const snap = readSnapshot(version);
    if (!snap) return;
    const next = JSON.stringify(snap);
    if (next === lastSerialised) return;
    lastSerialised = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Quota exceeded or storage disabled — silently drop. Save is best-effort.
    }
  };

  const schedule = () => {
    if (timer !== undefined) globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(writeIfChanged, DEBOUNCE_MS);
  };

  const unsub = useStore.subscribe((s, prev) => {
    if (
      s.allocation !== prev.allocation ||
      s.className !== prev.className ||
      s.ascendancyId !== prev.ascendancyId
    ) {
      schedule();
    }
  });

  return () => {
    unsub();
    if (timer !== undefined) globalThis.clearTimeout(timer);
  };
}

/** Manual purge — wired to a "Clear saved build" link in a settings menu later. */
export function clearPersistedSnapshot(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
