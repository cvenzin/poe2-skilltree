import { runExportDiagnostics } from './exportDiagnostics';
import type { RawTreeData, TreeData, TreeNode, Edge, UnlockConstraint } from './types';

/** Some exports retain linked records for skills unavailable in that version. */
export function isPassivePlaceholder(node: TreeNode): boolean {
  return node.id === null && !node.name && !node.icon && !node.stats?.length &&
    !node.isAscendancyStart && !node.classStartIndex?.length && !node.isJewelSocket;
}

// data.json arrives with mixed-type edge endpoints ("root" string, otherwise
// numeric). The renderer + pathing code only deals in node *keys*, which are
// always strings. Stringify everything once at load.
export function normalizeTreeData(raw: RawTreeData): TreeData {
  const edges: Edge[] = raw.edges.map((e) => ({
    from: String(e.from),
    to: String(e.to),
    orbit: e.orbit,
    orbitX: e.orbitX,
    orbitY: e.orbitY,
  }));

  // Drop the "Voices" Sinister Jewel Sockets (ids `voices_jewel_slot1..5`).
  // They're placed on the tree but graph-disconnected (no in/out/edges): in
  // game they only activate when the Voices unique jewel is socketed (it
  // "Allocates 2-4 Sinister Jewel sockets"). This planner doesn't model
  // jewels/items, so they can never be pathed to or filled — leaving them in
  // would render five unreachable sockets, pollute search ("Sinister Jewel
  // Socket"), and show empty radius rings on hover. Removing them here keeps
  // render / search / pathing / hover consistent from one place. Safe because
  // nothing connects to them (no edge references their keys).
  const nodes = Object.fromEntries(
    Object.entries(raw.nodes).filter(([, n]) => !n.id?.startsWith('voices_jewel_slot'))
  );

  // skill (numeric) → node key. The key is often the same string, but not
  // guaranteed — always look up via this map when you only have the skill id.
  const nodeBySkillId = new Map<number, string>();
  for (const [key, node] of Object.entries(nodes)) {
    if (typeof node.skill === 'number') {
      nodeBySkillId.set(node.skill, key);
    }
  }

  // class index (into raw.classes[]) → start node key.
  // The six start nodes carry `classStartIndex: [a, b]` (PoE 1 + PoE 2 share).
  const startNodeByClassIndex = new Map<number, string>();
  for (const [key, node] of Object.entries(nodes)) {
    if (node.classStartIndex) {
      for (const idx of node.classStartIndex) startNodeByClassIndex.set(idx, key);
    }
  }

  // Which ascendancyIds have at least one node in the data? Used to filter
  // empty-tree ascendancies like Witch3b (Abyssal Lich in 0.5.0).
  const ascIdsWithNodes = new Set<string>();
  for (const node of Object.values(nodes)) {
    if (node.ascendancyId) ascIdsWithNodes.add(node.ascendancyId);
  }

  // Nodes whose visibility/allocation gates on `unlockConstraint`. Oracle's
  // "The Unseen Path" (skill 5571) gates 197 main-tree nodes. Iterated whenever
  // allocation changes — keep the set hot so we don't re-scan ~5000 nodes.
  // Combination gates also unlock The Hollowkeeper, Path of the Renegade
  // and Spirit Walker's Sacred Unity.
  const constrainedNodeKeys = new Set<string>();
  for (const [key, node] of Object.entries(nodes)) {
    if (node.unlockConstraint) constrainedNodeKeys.add(key);
  }

  // Playable = classes with at least one *valid* ascendancy:
  //   - PoE 1 placeholder classes (Marauder, Duelist, Shadow, Templar) have
  //     empty `ascendancies` and are filtered out at the class level.
  //   - Unreleased/unfinished ascendancies show as `name === 'None'`
  //     (Ranger2, Druid3 in 0.5.0) — drop those.
  //   - Ascendancies with no nodes (Witch3b in 0.5.0) — drop those.
  const playableClassIndices: number[] = [];
  const playableAscendancyIds = new Set<string>();
  raw.classes.forEach((c, i) => {
    if (!c.ascendancies || c.ascendancies.length === 0) return;
    let anyValid = false;
    for (const asc of c.ascendancies) {
      if (!isValidAscendancy(asc, ascIdsWithNodes)) continue;
      playableAscendancyIds.add(asc.id);
      anyValid = true;
    }
    if (anyValid) playableClassIndices.push(i);
  });

  if (import.meta.env.DEV && import.meta.env.VITE_TREE_DIAGNOSTICS === 'true') {
    runExportDiagnostics(raw, edges, startNodeByClassIndex);
  }

  return {
    ...raw,
    nodes,
    edges,
    nodeBySkillId,
    startNodeByClassIndex,
    playableClassIndices,
    playableAscendancyIds,
    constrainedNodeKeys,
  };
}

/** Evaluate an `unlockConstraint` against the current ascendancy + allocation.
 *  Satisfied = (constraint's ascendancy, if set, matches the selected one) AND
 *  every skill in `constraint.nodes` is currently allocated.
 *
 *  Resolves skill ids → node keys via `data.nodeBySkillId`; an id with no node
 *  fails closed (constraint unsatisfiable). */
export function isUnlockConstraintSatisfied(
  constraint: UnlockConstraint,
  ascendancyId: string | null,
  allocated: ReadonlySet<string>,
  data: Pick<TreeData, 'nodeBySkillId'>,
): boolean {
  if (constraint.ascendancy && constraint.ascendancy !== ascendancyId) return false;
  for (const skillId of constraint.nodes) {
    const key = data.nodeBySkillId.get(skillId);
    if (!key) return false;
    if (!allocated.has(key)) return false;
  }
  return true;
}

/** Return the set of constraint-locked node keys that are currently hidden
 *  (constraint unsatisfied). Empty when no constrained nodes exist or all
 *  constraints are met. */
export function computeConstraintHiddenKeys(
  data: Pick<TreeData, 'nodes' | 'nodeBySkillId' | 'constrainedNodeKeys'>,
  ascendancyId: string | null,
  allocated: ReadonlySet<string>,
): Set<string> {
  const hidden = new Set<string>();
  for (const key of data.constrainedNodeKeys) {
    const constraint = data.nodes[key]?.unlockConstraint;
    if (!constraint) continue;
    if (!isUnlockConstraintSatisfied(constraint, ascendancyId, allocated, data)) {
      hidden.add(key);
    }
  }
  return hidden;
}

/**
 * Drop nodes from `allocated` whose `unlockConstraint` is no longer satisfied
 * by the current `(ascendancyId, allocated)` state. Runs to a fixed point so a
 * cascade (e.g. unallocating a gate that itself enables a deeper gate) settles
 * in one call.
 *
 * In 0.5.0 every constraint references Druid Oracle's "The Unseen Path"
 * (skill 5571), so this almost always converges in one pass — but the loop
 * costs nothing and shields against future chained constraints.
 *
 * Returns the *same* set instance when nothing was pruned, so callers can
 * cheaply compare identity to decide whether to push undo history.
 */
export function pruneConstraintLocked(
  allocated: ReadonlySet<string>,
  ascendancyId: string | null,
  data: Pick<TreeData, 'nodes' | 'nodeBySkillId' | 'constrainedNodeKeys'>,
): ReadonlySet<string> {
  if (data.constrainedNodeKeys.size === 0) return allocated;
  let current = allocated;
  let next = prunePass(current, ascendancyId, data);
  while (next !== current) {
    current = next;
    next = prunePass(current, ascendancyId, data);
  }
  return current;
}

function prunePass(
  allocated: ReadonlySet<string>,
  ascendancyId: string | null,
  data: Pick<TreeData, 'nodes' | 'nodeBySkillId'>,
): ReadonlySet<string> {
  let pruned: Set<string> | null = null;
  for (const key of allocated) {
    const constraint = data.nodes[key]?.unlockConstraint;
    if (!constraint) continue;
    if (isUnlockConstraintSatisfied(constraint, ascendancyId, allocated, data)) continue;
    pruned ??= new Set(allocated);
    pruned.delete(key);
  }
  return pruned ?? allocated;
}

function isValidAscendancy(
  asc: { id: string; name: string | null },
  ascIdsWithNodes: ReadonlySet<string>
): boolean {
  // `name` is JSON `null` for unreleased ascendancies (Ranger2, Druid3 in 0.5.0).
  if (!asc.name) return false;
  if (!ascIdsWithNodes.has(asc.id)) return false; // no tree (Witch3b in 0.5.0)
  return true;
}

// Resolve a class name → start node key. Throws on unknown class / missing
// start node, since these are programmer errors, not user input.
export function startNodeKeyForClass(className: string, data: TreeData): string {
  const idx = data.classes.findIndex((c) => c.name === className);
  if (idx < 0) throw new Error(`Unknown class: ${className}`);
  const key = data.startNodeByClassIndex.get(idx);
  if (!key) throw new Error(`No start node for class index ${idx} (${className})`);
  return key;
}

/** Node key of the start node for the given ascendancy, or null if none
 *  matches (or no ascendancy is selected). */
export function ascendancyStartKey(data: Pick<TreeData, 'nodes'>, ascendancyId: string | null): string | null {
  if (!ascendancyId) return null;
  for (const [key, node] of Object.entries(data.nodes)) {
    if (node.isAscendancyStart && node.ascendancyId === ascendancyId) return key;
  }
  return null;
}

/** Implicit allocation roots for a build: the class start plus the selected
 *  ascendancy start (if any). These are never stored in the allocation but seed
 *  every reachability walk (see pathing.ts). */
export function frontierKeysFor(data: TreeData, className: string, ascendancyId: string | null): Set<string> {
  const frontier = new Set<string>([startNodeKeyForClass(className, data)]);
  const ascStart = ascendancyStartKey(data, ascendancyId);
  if (ascStart) frontier.add(ascStart);
  return frontier;
}
