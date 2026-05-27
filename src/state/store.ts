import { create } from 'zustand';
import type { TreeData } from '../data/types';
import type { AtlasBundle } from '../render/atlas';

/** Fixed budgets per PoE 2 rules — 123 passives at level 90 with quest
 *  rewards, 8 ascendancy points fully cleared. Not user-editable. */
export const PASSIVE_CAP = 123;
export const ASCENDANCY_CAP = 8;
/** Linear single-stack history (INSTRUCTIONS.md §9.1). Each entry is a
 *  `Set<string>` snapshot — small enough that storing snapshots is cheaper
 *  than a command pattern. */
const UNDO_LIMIT = 50;

export type LoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; version: string; stage: 'data' | 'atlases' }
  | { kind: 'ready'; version: string; data: TreeData; atlases: AtlasBundle }
  | { kind: 'error'; version: string | null; message: string };

/** Hovered node state — populated by the renderer's pointer events, consumed
 *  by the DOM-overlay tooltip. `clientX/Y` are CSS pixels for direct use as
 *  a `getBoundingClientRect`-shaped reference in Floating UI. */
export interface HoveredNode {
  nodeKey: string;
  clientX: number;
  clientY: number;
}

/** Persisted view of the build — used by both localStorage restore (§10.5)
 *  and the URL share-hash (§10.4, phase 10c). Kept JSON-friendly: `allocated`
 *  is an array, not a Set. */
export interface BuildSnapshot {
  version: string;
  className: string;
  ascendancyId: string | null;
  allocated: string[];
}

interface AppState {
  status: LoadStatus;
  /** Which export version the App is currently loading or has loaded. Distinct
   *  from `status` so the version dropdown can read it independently of
   *  load-progress state. `null` only between app start and the manifest fetch
   *  completing. Changing this re-triggers the data/atlas load effect. */
  activeVersion: string | null;
  className: string | null;        // resolved on data load (first playable class)
  ascendancyId: string | null;     // null = no ascendancy rendered
  hovered: HoveredNode | null;
  /** Set of allocated node keys. Class start is implicit — never stored here,
   *  but always considered part of the allocation frontier (see pathing.ts). */
  allocated: ReadonlySet<string>;
  /** Shortest unallocated path from the frontier to the currently hovered
   *  unallocated node, as `[firstNew, ..., target]`. */
  previewPath: readonly string[] | null;

  // --- 10a: budgets + undo/redo ---
  /** Snapshot history of `allocated`, oldest → newest, capped at UNDO_LIMIT. */
  past: ReadonlySet<string>[];
  /** Redo stack, top = most recently undone. */
  future: ReadonlySet<string>[];
  /** Per-budget rejection counters. Increment when an allocation is rejected
   *  against that budget; the matching chip uses the value as a React `key`
   *  to retrigger its CSS shake animation. Per-budget so a rejection on one
   *  chip doesn't remount the other. */
  passiveRejectionTick: number;
  ascendancyRejectionTick: number;

  /** Popover visibility for the reset-confirm prompt. In the store (not local
   *  to ResetButton) so the `R` hotkey can open it and a second `R` can confirm. */
  resetConfirmOpen: boolean;

  // --- 10b: search ---
  /** Raw text in the search input. Empty string = no search active. */
  searchQuery: string;
  /** Matched node keys for the current `searchQuery`. Order is index-stable
   *  so Enter / Shift+Enter step-through is deterministic. */
  searchMatches: readonly string[];
  /** Index into `searchMatches` for the currently-focused result (Enter steps
   *  through). -1 = no specific focus (bbox framing applies); otherwise the
   *  camera frames just `searchMatches[searchCursor]`. */
  searchCursor: number;
  /** Camera state captured the first time the user types into the search input,
   *  restored on Esc-clear so they return to where they were looking. Cleared
   *  again on context switch (class/ascendancy/version). */
  preSearchCamera: { x: number; y: number; scale: number } | null;

  // --- setters ---
  /** Incremented by `retry()` — App's load effect depends on it so a bump
   *  re-runs the loader without a page reload (§10.6 error-card Retry). */
  retryToken: number;

  setStatus: (s: LoadStatus) => void;
  setActiveVersion: (v: string) => void;
  retry: () => void;
  setClass: (name: string) => void;
  setAscendancy: (id: string | null) => void;
  setHovered: (h: HoveredNode | null) => void;
  setPreviewPath: (path: readonly string[] | null) => void;

  /** Commit a new allocation set. Pushes the previous set to `past`, clears
   *  `future`. Does NOT enforce budgets — that's `tryAllocate`. */
  commitAllocation: (next: ReadonlySet<string>) => void;
  /** Allocation entry point used by the renderer. Returns true if committed,
   *  false if rejected by a budget (bumps rejectionTick). */
  tryAllocate: (next: ReadonlySet<string>, data: TreeData) => boolean;
  /** Wipe `allocated`. Keeps class/ascendancy. Pushes the previous set to undo. */
  resetAllocation: () => void;

  undo: () => void;
  redo: () => void;

  setResetConfirmOpen: (open: boolean) => void;

  /** Update the query AND the precomputed matches in one transition. Pass an
   *  empty query to clear; the toolbar debounces the input then calls this. */
  setSearch: (query: string, matches: readonly string[]) => void;
  /** Capture the camera state right before the user starts typing. Idempotent
   *  — only stores a value if `preSearchCamera` is currently null. */
  capturePreSearchCamera: (cam: { x: number; y: number; scale: number }) => void;
  clearSearch: () => void;
  /** Move the search cursor by `delta` (wraps at ends). No-op if no matches. */
  stepSearch: (delta: 1 | -1) => void;

  /** Set everything at once from a persisted snapshot (localStorage / share
   *  hash). Clears undo history — the imported build doesn't sit on top of
   *  a phantom history (§9.1). */
  loadSnapshot: (snap: Omit<BuildSnapshot, 'version'>) => void;
}

/** Counts of allocated nodes split into passive vs the currently-selected
 *  ascendancy (per §9 rule 7 table). Nodes whose `ascendancyId` doesn't match
 *  the selected one are silently ignored — pathing should prevent that case,
 *  but this is defensive. */
export function countBudgets(
  allocated: ReadonlySet<string>,
  ascendancyId: string | null,
  data: TreeData
): { passive: number; ascendancy: number } {
  let passive = 0;
  let ascendancy = 0;
  for (const key of allocated) {
    const node = data.nodes[key];
    if (!node) continue;
    // Ascendancy start is implicit (like the class start) — never counted
    // toward the budget. Defensive guard for stale state that has one in
    // `allocated` from before the click-handler stopped adding it.
    if (node.isAscendancyStart) continue;
    if (!node.ascendancyId) {
      passive++;
    } else if (node.ascendancyId === ascendancyId) {
      ascendancy++;
    }
  }
  return { passive, ascendancy };
}

function pushHistory(past: ReadonlySet<string>[], current: ReadonlySet<string>): ReadonlySet<string>[] {
  const next = [...past, current];
  if (next.length > UNDO_LIMIT) next.shift();
  return next;
}

export const useStore = create<AppState>()((set, get) => ({
  status: { kind: 'idle' },
  activeVersion: null,
  retryToken: 0,
  className: null,
  ascendancyId: null,
  hovered: null,
  allocated: new Set<string>(),
  previewPath: null,

  past: [],
  future: [],
  passiveRejectionTick: 0,
  ascendancyRejectionTick: 0,
  resetConfirmOpen: false,
  searchQuery: '',
  searchMatches: [],
  searchCursor: -1,
  preSearchCamera: null,

  setStatus: (s) => set({ status: s }),
  setActiveVersion: (v) => set({ activeVersion: v }),
  retry: () => set((s) => ({ retryToken: s.retryToken + 1, status: { kind: 'idle' } })),

  // Context switches reset the allocation AND clear undo history — the user
  // doesn't expect to undo from a fresh class back into a previous class's
  // allocation (§9.1).
  setClass: (name) => set((s) => {
    if (s.className === name) return s;
    return {
      className: name,
      ascendancyId: null,
      allocated: new Set<string>(),
      past: [],
      future: [],
      previewPath: null,
      // Context switch — search is per-tree-view, clear it.
      searchQuery: '',
      searchMatches: [],
      searchCursor: -1,
      preSearchCamera: null,
    };
  }),
  setAscendancy: (id) => set({
    ascendancyId: id,
    previewPath: null,
    past: [],
    future: [],
    searchQuery: '',
    searchMatches: [],
    searchCursor: -1,
    preSearchCamera: null,
  }),
  setHovered: (h) => set({ hovered: h, previewPath: null }),
  setPreviewPath: (path) => set({ previewPath: path }),

  commitAllocation: (next) => set((s) => ({
    allocated: next,
    past: pushHistory(s.past, s.allocated),
    future: [],
    previewPath: null,
  })),

  tryAllocate: (next, data) => {
    const s = get();
    const counts = countBudgets(next, s.ascendancyId, data);
    if (counts.passive > PASSIVE_CAP) {
      set({ passiveRejectionTick: s.passiveRejectionTick + 1 });
      return false;
    }
    if (counts.ascendancy > ASCENDANCY_CAP) {
      set({ ascendancyRejectionTick: s.ascendancyRejectionTick + 1 });
      return false;
    }
    s.commitAllocation(next);
    return true;
  },

  resetAllocation: () => set((s) => ({
    allocated: new Set<string>(),
    past: s.allocated.size > 0 ? pushHistory(s.past, s.allocated) : s.past,
    future: [],
    previewPath: null,
  })),

  undo: () => set((s) => {
    const prev = s.past.at(-1);
    if (prev === undefined) return s;
    return {
      allocated: prev,
      past: s.past.slice(0, -1),
      future: [...s.future, s.allocated],
      previewPath: null,
    };
  }),

  redo: () => set((s) => {
    const next = s.future.at(-1);
    if (next === undefined) return s;
    return {
      allocated: next,
      past: [...s.past, s.allocated],
      future: s.future.slice(0, -1),
      previewPath: null,
    };
  }),

  setResetConfirmOpen: (open) => set({ resetConfirmOpen: open }),

  setSearch: (query, matches) => set((s) => ({
    searchQuery: query,
    searchMatches: matches,
    // Reset cursor to "no specific match focused" — Enter sets it to 0 to
    // start step-through. Empty matches → -1.
    searchCursor: matches.length === 0 ? -1 : Math.min(s.searchCursor, matches.length - 1),
  })),

  capturePreSearchCamera: (cam) => set((s) => (
    s.preSearchCamera ? s : { preSearchCamera: cam }
  )),

  clearSearch: () => set({
    searchQuery: '',
    searchMatches: [],
    searchCursor: -1,
    preSearchCamera: null,
  }),

  stepSearch: (delta) => set((s) => {
    if (s.searchMatches.length === 0) return s;
    // First Enter on a fresh result set → focus the first match (index 0),
    // not "go to the next of -1" which would be index 1.
    const start = s.searchCursor === -1 ? (delta > 0 ? 0 : s.searchMatches.length - 1) : s.searchCursor + delta;
    const wrapped = ((start % s.searchMatches.length) + s.searchMatches.length) % s.searchMatches.length;
    return { searchCursor: wrapped };
  }),

  loadSnapshot: (snap) => set({
    className: snap.className,
    ascendancyId: snap.ascendancyId,
    allocated: new Set(snap.allocated),
    past: [],
    future: [],
    previewPath: null,
  }),
}));
