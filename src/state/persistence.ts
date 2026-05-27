import { useStore, type BuildSnapshot } from './store';
import type { TreeData } from '../data/types';

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
    allocated: [...s.allocated],
  };
}

/** Validate a stored snapshot against the live data: the class must still be
 *  playable, the ascendancy (if any) must still belong to that class, and
 *  every allocated node key must still exist. Drops the ones that don't.
 *  Returns null if the class itself isn't usable. */
export function reconcileSnapshot(snap: BuildSnapshot, data: TreeData): Omit<BuildSnapshot, 'version'> | null {
  const cls = data.classes.find((c) => c.name === snap.className);
  if (!cls || cls.ascendancies.length === 0) return null;
  const ascendancyId =
    snap.ascendancyId && data.playableAscendancyIds.has(snap.ascendancyId)
      ? snap.ascendancyId
      : null;
  const allocated = snap.allocated.filter((k) => data.nodes[k] !== undefined);
  return {
    className: snap.className,
    ascendancyId,
    allocated,
  };
}

/** Read the persisted snapshot for the given version. Returns null on absent,
 *  malformed, or version-mismatched data. */
export function loadPersistedSnapshot(version: string): BuildSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BuildSnapshot>;
    if (parsed.version !== version) return null;
    if (typeof parsed.className !== 'string') return null;
    if (!Array.isArray(parsed.allocated)) return null;
    return {
      version,
      className: parsed.className,
      ascendancyId: typeof parsed.ascendancyId === 'string' ? parsed.ascendancyId : null,
      allocated: parsed.allocated.filter((k): k is string => typeof k === 'string'),
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
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(writeIfChanged, DEBOUNCE_MS);
  };

  const unsub = useStore.subscribe((s, prev) => {
    if (
      s.allocated !== prev.allocated ||
      s.className !== prev.className ||
      s.ascendancyId !== prev.ascendancyId
    ) {
      schedule();
    }
  });

  return () => {
    unsub();
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

/** Manual purge — wired to a "Clear saved build" link in a settings menu later. */
export function clearPersistedSnapshot(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}
