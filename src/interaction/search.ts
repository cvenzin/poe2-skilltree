import type { TreeData } from '../data/types';
import { stripStatsMarkup } from './statsMarkup';
import { computeConstraintHiddenKeys } from '../data/normalize';

/**
 * Search index for a single loaded tree (INSTRUCTIONS.md §10.1).
 *
 * Each entry is `{ key, haystack }` where `haystack` is the node's name +
 * stripped stats text, lowercased and stripped of combining marks (so an
 * `e`-acute matches `e`). The plain matcher is `haystack.includes(query)`
 * which is sub-ms over ~1500 entries; we don't need a trigram index yet.
 *
 * NOT indexed:
 *   - `flavourText`, `reminderText`, `masteryEffects[].reminderText` (lore/help)
 *   - Mastery nodes themselves (hidden — PoE 1 leftover, see memory)
 *   - Ascendancy nodes belonging to non-playable ascendancies (filtered from render)
 *   - Nodes without world positions (no place to highlight or frame on)
 *
 * The `[Tag|Display]` markup is stripped so typing either the glossary tag
 * (e.g. "CriticalDamageBonus") or the display ("Critical Damage Bonus") works.
 */
export interface SearchEntry {
  key: string;
  haystack: string;
}

export function buildSearchIndex(data: TreeData): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const [key, node] of Object.entries(data.nodes)) {
    if (key === 'root') continue;
    if (node.isMastery) continue;
    if (node.x === undefined || node.y === undefined) continue;
    if (node.ascendancyId && !data.playableAscendancyIds.has(node.ascendancyId)) continue;

    const name = node.name ?? '';
    const stats = (node.stats ?? []).map(stripStatsMarkup).join(' ');
    const haystack = normalizeForSearch(`${name} ${stats}`);
    if (haystack.trim().length === 0) continue;
    out.push({ key, haystack });
  }
  return out;
}

/** Case- and accent-insensitive normalisation (§10.1). NFD decomposes a base
 *  letter + diacritic, then `[̀-ͯ]` strips the combining marks. */
export function normalizeForSearch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Substring match over the precomputed haystack. Returns the matched node
 *  keys in index order — stable across re-runs with the same data + query. */
export function findMatches(query: string, index: readonly SearchEntry[]): string[] {
  const q = normalizeForSearch(query.trim());
  if (q.length === 0) return [];
  const matches: string[] = [];
  for (const entry of index) {
    if (entry.haystack.includes(q)) matches.push(entry.key);
  }
  return matches;
}

/** Drop matches whose `unlockConstraint` isn't currently satisfied — those
 *  nodes are invisible in the canvas, so highlighting them with cyan rings
 *  would point at empty space. Allocating "The Unseen Path" makes the gated
 *  matches reappear on the next keystroke / allocation change. */
export function filterConstraintHidden(
  matches: readonly string[],
  data: TreeData,
  ascendancyId: string | null,
  allocated: ReadonlySet<string>,
): string[] {
  if (data.constrainedNodeKeys.size === 0) return [...matches];
  const hidden = computeConstraintHiddenKeys(data, ascendancyId, allocated);
  if (hidden.size === 0) return [...matches];
  return matches.filter((k) => !hidden.has(k));
}
