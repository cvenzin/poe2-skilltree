import { create } from 'zustand';
import type { TreeData } from '../data/types';
import type { AtlasBundle } from '../render/atlas';
import { attributeOptions, choicesForAllocation, isAttributeChoice, parseAttributeChoices, reconcileAttributeChoices,
  type AttributeChoice, type AttributeChoices } from './attributes';
import { budgetBonuses, exclusiveAllocationError, revalidateAllocation } from './buildRules';
import { allAllocated, isAllocated, buildAllocation } from './allocation';
import { createAttributeState, type AttributeState } from './attributeState';
export type { AttributeEditor } from './attributeState';
import { pushHistory, type BuildEdit } from './buildHistory';
import {
  type Allocation,
  type AllocationMode,
  EMPTY_ALLOCATION,
  isEmptyAllocation,
} from './allocation';

/** Fixed budgets per PoE 2 rules — 123 passives at level 100 with quest
 *  rewards, 8 ascendancy points fully cleared. Not user-editable. */
export const PASSIVE_CAP = 123;
export const ASCENDANCY_CAP = 8;
/** Base specialization limit per set, before allocated ascendancy bonuses. */
export const WEAPON_SET_CAP = 24;

export type LoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; version: string }
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

/** Persisted view of the build — used by both localStorage restore
 *  and the URL share-hash. Kept JSON-friendly: the
 *  allocation buckets are arrays, not Sets.
 *
 *  Weapon-set buckets are stored separately (see docs/weapon-set-support.md).
 *  Backward compatibility with pre-weapon-set builds (a single `allocated`
 *  list) is handled in the persistence / share-hash decode layer, which maps
 *  the legacy list onto `shared`. */
export interface BuildSnapshot {
  version: string;
  className: string;
  ascendancyId: string | null;
  /** Main-tree (shared) allocations — active in both weapon sets. */
  shared: string[];
  /** Weapon Set 1 branch allocations. */
  set1: string[];
  /** Weapon Set 2 branch allocations. */
  set2: string[];
  attributeChoices?: AttributeChoices;
  defaultAttribute?: AttributeChoice;
}

export interface AppState extends AttributeState {
  status: LoadStatus;
  /** Which export version the App is currently loading or has loaded. Distinct
   *  from `status` so the version dropdown can read it independently of
   *  load-progress state. `null` only between app start and the manifest fetch
   *  completing. Changing this re-triggers the data/atlas load effect. */
  activeVersion: string | null;
  className: string | null;        // resolved on data load (first playable class)
  ascendancyId: string | null;     // null = no ascendancy rendered
  hovered: HoveredNode | null;
  /** Transient validation message shown when an action is blocked (cap
   *  reached). Null when nothing to show; the toast auto-dismisses. */
  validationMessage: string | null;
  /** Allocation buckets: main tree (`shared`) + the two weapon-set branches
   *  (`set1` / `set2`). Class and ascendancy starts are implicit — never stored
   *  here, but always part of the allocation frontier (see pathing.ts). */
  allocation: Allocation;
  /** Which tree the user is currently editing — clicks add/remove nodes in this
   *  tree only. `shared` = the main tree. */
  allocationMode: AllocationMode;
  /** User opt-in for the weapon-set UI. Off by default so new users see a plain
   *  single tree. The sets UI is shown when this is true OR the build already
   *  has set allocations (so loading a build never hides points). UI-only — not
   *  persisted; derived back from the allocation on load. */
  weaponSetsEnabled: boolean;
  /** Shortest unallocated path from the active frontier to the currently
   *  hovered unallocated node, as `[firstNew, ..., target]`. */
  previewPath: readonly string[] | null;

  // --- 10a: budgets + undo/redo ---
  /** Immutable allocation + attribute edits, oldest first, capped in buildHistory. */
  past: BuildEdit[];
  /** Redo stack, top = most recently undone. */
  future: BuildEdit[];
  /** Per-budget rejection counters. Increment when an allocation is rejected
   *  against that budget; the matching chip uses the value as a React `key`
   *  to retrigger its CSS shake animation. Per-budget so a rejection on one
   *  chip doesn't remount the others. */
  passiveRejectionTick: number;
  ascendancyRejectionTick: number;
  weaponSet1RejectionTick: number;
  weaponSet2RejectionTick: number;

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
   *  re-runs the loader without a page reload. */
  retryToken: number;

  setStatus: (s: LoadStatus) => void;
  setActiveVersion: (v: string) => void;
  retry: () => void;
  setClass: (name: string) => void;
  setAscendancy: (id: string | null) => void;
  setHovered: (h: HoveredNode | null) => void;
  /** Atomically publish a hover target and the path computed for that target. */
  setHoverState: (h: HoveredNode, path: readonly string[] | null) => void;
  /** Move the tooltip anchor within its current target without invalidating its preview. */
  updateHoveredPosition: (h: HoveredNode) => void;
  setPreviewPath: (path: readonly string[] | null) => void;
  setValidationMessage: (msg: string | null) => void;

  /** Set which tree the user is editing (Main / Set 1 / Set 2). */
  setAllocationMode: (mode: AllocationMode) => void;
  /** Toggle the weapon-set UI. Turning it off snaps editing back to the main
   *  tree. */
  setWeaponSetsEnabled: (enabled: boolean) => void;

  /** Revalidate and commit an allocation edit, retaining the previous immutable
   *  snapshot in history. Reject edits that lose a needed budget bonus. */
  commitAllocation: (next: Allocation, data?: TreeData) => void;
  /** Allocation entry point used by the renderer. Returns true if committed,
   *  false if rejected by a budget (bumps the matching rejectionTick). */
  tryAllocate: (next: Allocation, data: TreeData) => boolean;
  /** Wipe all allocation buckets. Keeps class/ascendancy and the edit mode.
   *  Pushes the previous allocation to undo. */
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
   *  a phantom history. */
  loadSnapshot: (snap: Omit<BuildSnapshot, 'version'>) => void;
}

/** Budget counts derived from an {@link Allocation}.
 *
 *  Shared allocations are active in *both* weapon sets, so each set's active
 *  total is `shared + setN` and is validated against the passive-point budget
 *  (base `PASSIVE_CAP` plus bonuses) independently — the two sets can have different active totals
 *  and different unspent remainders. The set-specific counts additionally have
 *  their own weapon-set specialization cap (base `WEAPON_SET_CAP` plus bonuses).
 *
 *  Ascendancy nodes are counted once toward the ascendancy budget regardless of
 *  bucket (they should always be `shared`, but the count is defensive).
 *  Ascendancy starts and multiple-choice hubs are free (never counted). */
export interface BudgetCounts {
  /** Main-tree (shared) passive nodes — active in both weapon sets. */
  shared: number;
  /** Weapon Set 1-only nodes (weapon-set 1 specialization used). */
  set1: number;
  /** Weapon Set 2-only nodes (weapon-set 2 specialization used). */
  set2: number;
  /** Passive points active in Weapon Set 1 (`shared + set1`). */
  activeIn1: number;
  /** Passive points active in Weapon Set 2 (`shared + set2`). */
  activeIn2: number;
  /** Ascendancy nodes matching the selected ascendancy. */
  ascendancy: number;
}

export function countBudgets(
  allocation: Allocation,
  ascendancyId: string | null,
  data: TreeData
): BudgetCounts {
  let shared = 0;
  let set1 = 0;
  let set2 = 0;
  let ascendancy = 0;

  const classify = (key: string, bucket: AllocationMode): void => {
    const node = data.nodes[key];
    if (!node) return;
    // Ascendancy start is implicit (like the class start) — never counted.
    if (node.isAscendancyStart || node.classStartIndex || node.isMastery || key === 'root') return;
    // Multiple-choice hubs (e.g. "Projectile Proximity Specialisation") have
    // no stats and exist only as routing nodes for the choice options. The
    // chosen option carries the actual cost — the hub is free.
    if (node.isMultipleChoice) return;
    // Ascendancy points are a separate budget and aren't weapon-set-split —
    // count them once regardless of which bucket they happen to sit in.
    if (node.ascendancyId) {
      if (node.ascendancyId === ascendancyId) ascendancy++;
      return;
    }
    if (bucket === 'shared') shared++;
    else if (bucket === 'set1') set1++;
    else set2++;
  };

  for (const key of allocation.shared) classify(key, 'shared');
  for (const key of allocation.set1) classify(key, 'set1');
  for (const key of allocation.set2) classify(key, 'set2');

  return { shared, set1, set2, activeIn1: shared + set1, activeIn2: shared + set2, ascendancy };
}

export function effectiveBudgetCaps(allocation: Allocation, ascendancyId: string | null, data: TreeData) {
  const bonus = budgetBonuses(allocation, ascendancyId, data);
  return { passive: PASSIVE_CAP + bonus.passive, weaponSet: WEAPON_SET_CAP + bonus.weaponSet };
}

export function allocationBudgetError(allocation: Allocation, ascendancyId: string | null, data: TreeData) {
  const counts = countBudgets(allocation, ascendancyId, data);
  const caps = effectiveBudgetCaps(allocation, ascendancyId, data);
  if (counts.ascendancy > ASCENDANCY_CAP) return { tick: 'ascendancyRejectionTick', message: 'Ascendancy point limit exceeded (8).' } as const;
  for (const set of [1, 2] as const) {
    if (counts[set === 1 ? 'activeIn1' : 'activeIn2'] > caps.passive)
      return { tick: 'passiveRejectionTick', message: 'Weapon Set ' + set + ' would exceed the passive point limit (' + caps.passive + '). Refund passive points first.' } as const;
    if (counts[set === 1 ? 'set1' : 'set2'] > caps.weaponSet)
      return { tick: set === 1 ? 'weaponSet1RejectionTick' : 'weaponSet2RejectionTick', message: 'Weapon Set ' + set + ' would exceed the weapon set point limit (' + caps.weaponSet + '). Refund weapon set points first.' } as const;
  }
  return null;
}

export const useStore = create<AppState>()((set, get, api) => ({
  ...createAttributeState(set, get, api),
  status: { kind: 'idle' },
  activeVersion: null,
  retryToken: 0,
  className: null,
  ascendancyId: null,
  hovered: null,
  validationMessage: null,
  allocation: EMPTY_ALLOCATION,
  allocationMode: 'shared',
  weaponSetsEnabled: false,
  previewPath: null,

  past: [],
  future: [],
  passiveRejectionTick: 0,
  ascendancyRejectionTick: 0,
  weaponSet1RejectionTick: 0,
  weaponSet2RejectionTick: 0,
  resetConfirmOpen: false,
  searchQuery: '',
  searchMatches: [],
  searchCursor: -1,
  preSearchCamera: null,

  setStatus: (status) => set((s) => status.kind === 'ready' ? {
    status,
    attributeChoices: reconcileAttributeChoices(s.attributeChoices, s.allocation, status.data, s.ascendancyId),
    defaultAttribute: attributeOptions(status.data, s.allocation, s.ascendancyId)
      .some((option) => option.choice === s.defaultAttribute) ? s.defaultAttribute : null,
    attributeEditor: null, past: [], future: [],
  } : { status, attributeEditor: null }),
  setActiveVersion: (v) => set({ activeVersion: v, attributeEditor: null }),
  retry: () => set((s) => ({ retryToken: s.retryToken + 1, status: { kind: 'idle' } })),

  // Context switches reset the allocation AND clear undo history — the user
  // doesn't expect to undo from a fresh class back into a previous class's
  // allocation.
  setClass: (name) => set((s) => {
    if (s.className === name) return s;
    return {
      className: name,
      hovered: null,
      ascendancyId: null,
      allocation: EMPTY_ALLOCATION,
      attributeChoices: {},
      attributeEditor: null,
      defaultAttribute: s.defaultAttribute && ['strength', 'dexterity', 'intelligence'].includes(s.defaultAttribute) ? s.defaultAttribute : null,
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
  setAscendancy: (id) => set((s) => {
    if (s.ascendancyId === id) return s;
    const data = s.status.kind === 'ready' ? s.status.data : null;
    if (data && id && !data.classes.find((cls) => cls.name === s.className)?.ascendancies
      .some((asc) => asc.id === id && data.playableAscendancyIds.has(id))) return s;
    const allocation = data ? revalidateAllocation(s.allocation, data, s.className, id) : EMPTY_ALLOCATION;
    const error = data ? allocationBudgetError(allocation, id, data) : null;
    if (error) return { validationMessage: error.message, [error.tick]: s[error.tick] + 1 };
    return {
      ascendancyId: id, allocation, hovered: null,
      attributeChoices: data ? reconcileAttributeChoices(s.attributeChoices, allocation, data, id) : {},
      defaultAttribute: data && !attributeOptions(data, allocation, id)
        .some((option) => option.choice === s.defaultAttribute) ? null : s.defaultAttribute,
      attributeEditor: null, previewPath: null, validationMessage: null,
      past: [], future: [], searchQuery: '', searchMatches: [], searchCursor: -1, preSearchCamera: null,
    };
  }),
  setHovered: (h) => set({ hovered: h, previewPath: null }),
  setHoverState: (hovered, previewPath) => set((s) => {
    const samePath = s.previewPath === previewPath || (s.previewPath !== null && previewPath !== null &&
      s.previewPath.length === previewPath.length && s.previewPath.every((key, index) => key === previewPath[index]));
    const sameHover = s.hovered?.nodeKey === hovered.nodeKey && s.hovered.clientX === hovered.clientX &&
      s.hovered.clientY === hovered.clientY;
    if (sameHover && samePath) return s;
    return { hovered, previewPath: samePath ? s.previewPath : previewPath };
  }),
  updateHoveredPosition: (hovered) => set((s) => {
    if (!s.hovered || s.hovered.nodeKey !== hovered.nodeKey ||
      (s.hovered.clientX === hovered.clientX && s.hovered.clientY === hovered.clientY)) return s;
    return { hovered };
  }),
  setPreviewPath: (path) => set({ previewPath: path }),
  setValidationMessage: (msg) => set({ validationMessage: msg }),

  // Switching the edited tree clears any in-flight preview (it was computed
  // for the old tree's frontier).
  setAllocationMode: (mode) => set({ allocationMode: mode, previewPath: null, attributeEditor: null }),
  // Turning sets off snaps editing back to the main tree so a stale Set 1/2
  // mode can't allocate into a hidden bucket.
  setWeaponSetsEnabled: (enabled) => set(enabled
    ? { weaponSetsEnabled: true }
    : { weaponSetsEnabled: false, allocationMode: 'shared', previewPath: null }),

  commitAllocation: (next, suppliedData) => set((s) => {
    const data = suppliedData ?? (s.status.kind === 'ready' ? s.status.data : null);
    if (data) {
      const invalid = exclusiveAllocationError(next, data);
      if (invalid) return { validationMessage: invalid };
      next = revalidateAllocation(next, data, s.className, s.ascendancyId);
      const error = allocationBudgetError(next, s.ascendancyId, data);
      if (error) return { validationMessage: error.message, [error.tick]: s[error.tick] + 1 };
    }
    const choices = data ? choicesForAllocation(s.attributeChoices, s.allocation, next, data, s.ascendancyId, s.defaultAttribute)
      : Object.fromEntries(Object.entries(s.attributeChoices).filter(([key]) => isAllocated(next, key)));
    const defaultAttribute = data && !attributeOptions(data, next, s.ascendancyId)
      .some((option) => option.choice === s.defaultAttribute) ? null : s.defaultAttribute;
    return {
      allocation: next, attributeChoices: choices, defaultAttribute,
      past: pushHistory(s.past, s), future: [], previewPath: null, attributeEditor: null,
      validationMessage: null,
    };
  }),

  tryAllocate: (next, data) => {
    const s = get();
    const invalid = exclusiveAllocationError(next, data);
    if (invalid) { set({ validationMessage: invalid }); return false; }
    const pruned = revalidateAllocation(next, data, s.className, s.ascendancyId);
    const error = allocationBudgetError(pruned, s.ascendancyId, data);
    if (error) {
      set({ validationMessage: error.message, [error.tick]: s[error.tick] + 1 });
      return false;
    }
    if (!attributeOptions(data, pruned, s.ascendancyId).some((option) => option.choice === s.defaultAttribute) &&
      [...allAllocated(pruned)].some((key) => data.nodes[key]?.isGenericAttribute && !isAllocated(s.allocation, key))) {
      set({ attributeEditor: { kind: 'default', pending: pruned }, hovered: null, previewPath: null });
      return false;
    }
    s.commitAllocation(pruned, data);
    return true;
  },

  resetAllocation: () => set((s) => ({
    allocation: EMPTY_ALLOCATION,
    attributeChoices: {},
    attributeEditor: null,
    defaultAttribute: s.defaultAttribute && ['strength', 'dexterity', 'intelligence'].includes(s.defaultAttribute) ? s.defaultAttribute : null,
    past: isEmptyAllocation(s.allocation) ? s.past : pushHistory(s.past, s),
    future: [],
    previewPath: null,
  })),

  undo: () => set((s) => {
    const prev = s.past.at(-1);
    if (prev === undefined) return s;
    return {
      allocation: prev.allocation,
      attributeChoices: prev.attributeChoices,
      attributeEditor: null,
      past: s.past.slice(0, -1),
      future: [...s.future, { allocation: s.allocation, attributeChoices: s.attributeChoices }],
      previewPath: null,
    };
  }),

  redo: () => set((s) => {
    const next = s.future.at(-1);
    if (next === undefined) return s;
    return {
      allocation: next.allocation,
      attributeChoices: next.attributeChoices,
      attributeEditor: null,
      past: pushHistory(s.past, s),
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

  loadSnapshot: (snap) => set((s) => {
    const allocation = buildAllocation(snap.shared, snap.set1, snap.set2);
    if (s.status.kind === 'ready') {
      const data = s.status.data;
      const cls = data.classes.find((entry, index) => entry.name === snap.className && data.playableClassIndices.includes(index));
      if (!cls || (snap.ascendancyId && (!data.playableAscendancyIds.has(snap.ascendancyId) ||
        !cls.ascendancies.some((asc) => asc.id === snap.ascendancyId))))
        return { validationMessage: 'The build class and ascendancy do not match.' };
      const invalid = exclusiveAllocationError(allocation, data) ?? allocationBudgetError(allocation, snap.ascendancyId, data)?.message;
      if (invalid) return { validationMessage: invalid };
    }
    return {
      hovered: null, allocationMode: 'shared', validationMessage: null,
      searchQuery: '', searchMatches: [], searchCursor: -1, preSearchCamera: null, resetConfirmOpen: false,
      className: snap.className,
      ascendancyId: snap.ascendancyId,
      attributeChoices: parseAttributeChoices(snap.attributeChoices),
      defaultAttribute: isAttributeChoice(snap.defaultAttribute) ? snap.defaultAttribute : null,
      attributeEditor: null,
      allocation,
      // Reveal the sets UI only when the loaded build actually uses sets.
      weaponSetsEnabled: snap.set1.length > 0 || snap.set2.length > 0,
      past: [], future: [], previewPath: null,
    };
  }),
}));
