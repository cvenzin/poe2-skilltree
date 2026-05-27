import type { RawTreeData, TreeData } from './types';
import { normalizeTreeData } from './normalize';

export async function loadTreeData(version: string): Promise<TreeData> {
  const url = `/trees/${version}/data.json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${r.statusText}`);
  const raw = (await r.json()) as unknown;
  sanityCheck(raw, version);
  return normalizeTreeData(raw as RawTreeData);
}

// Minimal schema validation — enough to catch a wrong/corrupt file early
// (INSTRUCTIONS.md §10.6). Not a full validator; we trust the export format
// once the top-level shape is correct.
function sanityCheck(data: unknown, version: string): asserts data is RawTreeData {
  if (!data || typeof data !== 'object') {
    throw new Error(`data.json (${version}) is not an object`);
  }
  const required = ['classes', 'groups', 'nodes', 'edges', 'min_x', 'min_y', 'max_x', 'max_y'] as const;
  for (const key of required) {
    if (!(key in data)) throw new Error(`data.json (${version}) missing required field: ${key}`);
  }
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.classes) || d.classes.length === 0) {
    throw new Error(`data.json (${version}) has no classes`);
  }
  if (!Array.isArray(d.edges)) {
    throw new Error(`data.json (${version}) edges is not an array`);
  }
  if (typeof d.nodes !== 'object' || d.nodes === null) {
    throw new Error(`data.json (${version}) nodes is not an object`);
  }
  // At least one node must carry classStartIndex, otherwise the class-start
  // resolver (normalize.ts) silently produces no mappings.
  const nodes = d.nodes as Record<string, unknown>;
  const hasStart = Object.values(nodes).some((n) => {
    return n && typeof n === 'object' && Array.isArray((n as { classStartIndex?: unknown }).classStartIndex);
  });
  if (!hasStart) {
    throw new Error(`data.json (${version}) has no nodes with classStartIndex`);
  }
}
