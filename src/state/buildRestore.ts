import type { TreeData } from '../data/types';
import { VERSIONS, DEFAULT_CLASS } from '../data/versions';
import { useStore } from './store';
import { loadPersistedSnapshot, reconcileSnapshot } from './persistence';
import { decodeShareHash, reconcileShareHash } from './shareHash';
import { beginSharedDraft, saveBeforeLeaving } from './buildActions';

/** Load external share links without leaving a build that could not be saved. */
export function handleSharedHashChange(): void {
  const raw = decodeShareHash(globalThis.location.hash);
  if (!raw || !(VERSIONS as readonly string[]).includes(raw.version)) return;
  const s = useStore.getState();
  if (raw.version !== s.activeVersion) {
    if (saveBeforeLeaving()) s.setActiveVersion(raw.version);
    return;
  }
  if (s.status.kind === 'ready') {
    const reconciled = reconcileShareHash(raw, s.status.data);
    if (reconciled && beginSharedDraft({ version: raw.version, ...reconciled })) s.loadSnapshot(reconciled);
    else s.setValidationMessage('Cannot load this build: its class, allocation rules, or point budgets are invalid.');
  }
}

/** Pick an initial allocation/class state for the just-loaded version.
 *  Order: URL hash → localStorage → first-playable-class defaults. */
export function applyBootSnapshot(
  version: string,
  data: TreeData,
  loadSnapshot: ReturnType<typeof useStore.getState>['loadSnapshot'],
): void {
  const hashRaw = decodeShareHash(globalThis.location.hash);
  if (hashRaw && hashRaw.version === version) {
    const reconciled = reconcileShareHash(hashRaw, data);
    if (reconciled && beginSharedDraft({ version, ...reconciled }, { restoring: true })) { loadSnapshot(reconciled); return; }
  }
  const persisted = loadPersistedSnapshot(version);
  const reconciledLs = persisted ? reconcileSnapshot(persisted, data) : null;
  if (reconciledLs) { loadSnapshot(reconciledLs); return; }

  const firstPlayable = firstPlayableClass(data);
  if (firstPlayable) {
    const snapshot = { className: firstPlayable.name, ascendancyId: null, shared: [], set1: [], set2: [] };
    // An unavailable or invalid saved build stays in the library for recovery.
    beginSharedDraft({ version, ...snapshot }, { restoring: true });
    loadSnapshot(snapshot);
  }
}

/** The class `applyBootSnapshot` will end up selecting, resolved *without*
 *  mutating store state — so the loader can eager-load that class's background
 *  before the first render. Must mirror `applyBootSnapshot`'s precedence
 *  (hash → localStorage → first playable). A wrong guess is harmless: the lazy
 *  swapContext path loads whatever class actually renders. */
export function resolveBootClassName(version: string, data: TreeData): string | null {
  const migration = useStore.getState().pendingVersionMigration;
  if (migration?.version === version) {
    const reconciled = reconcileSnapshot({ version, ...migration.snapshot }, data);
    if (reconciled) return reconciled.className;
  }

  const hashRaw = decodeShareHash(globalThis.location.hash);
  if (hashRaw && hashRaw.version === version) {
    const reconciled = reconcileShareHash(hashRaw, data);
    if (reconciled) return reconciled.className;
  }
  const persisted = loadPersistedSnapshot(version);
  const reconciledLs = persisted ? reconcileSnapshot(persisted, data) : null;
  if (reconciledLs) return reconciledLs.className;

  return firstPlayableClass(data)?.name ?? null;
}

function firstPlayableClass(data: TreeData) {
  const idx = data.playableClassIndices[0];
  return idx === undefined ? undefined : data.classes[idx];
}

/** The boot class, resolved *without* the parsed data so its background can
 *  start loading before data.json arrives. Every case is now answerable
 *  pre-parse since the share hash carries the class *name* (not a numeric
 *  index). Precedence mirrors `resolveBootClassName`:
 *   - share hash → its class name (unvalidated; a bogus name just 404s the
 *     preload, and the post-parse path picks the real class);
 *   - returning visitor → the saved class name (localStorage);
 *   - fresh visitor → {@link DEFAULT_CLASS}. */
export function bootClassNameWithoutData(version: string): string {
  const migration = useStore.getState().pendingVersionMigration;
  if (migration?.version === version) return migration.snapshot.className;

  const hashRaw = decodeShareHash(globalThis.location.hash);
  if (hashRaw?.version === version) return hashRaw.className;
  return loadPersistedSnapshot(version)?.className ?? DEFAULT_CLASS;
}
