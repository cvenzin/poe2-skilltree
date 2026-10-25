import type { BuildSnapshot } from './store';
import { isAttributeChoice, parseAttributeChoices } from './attributes';

export const LIBRARY_KEY = 'poe2-tree:builds';
export const LEGACY_KEY = 'poe2-tree:last';

export interface SavedBuild {
  id: string;
  name: string;
  updatedAt: number;
  snapshot: BuildSnapshot;
}

export interface BuildLibrary {
  schema: 1;
  builds: SavedBuild[];
  activeId: string | null;
  draft: BuildSnapshot | null;
}

/** Accept both modern snapshots and the original shared-only save format. */
export function parseSnapshot(value: unknown): BuildSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const parsed = value as Record<string, unknown>;
  if (typeof parsed.version !== 'string' || typeof parsed.className !== 'string') return null;
  if (!Array.isArray(parsed.shared) && !Array.isArray(parsed.allocated)) return null;
  const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [];
  return {
    version: parsed.version, className: parsed.className,
    ascendancyId: typeof parsed.ascendancyId === 'string' ? parsed.ascendancyId : null,
    shared: strings(Array.isArray(parsed.shared) ? parsed.shared : parsed.allocated),
    set1: strings(parsed.set1), set2: strings(parsed.set2),
    ...(parsed.attributeChoices ? { attributeChoices: parseAttributeChoices(parsed.attributeChoices) } : {}),
    ...(isAttributeChoice(parsed.defaultAttribute) ? { defaultAttribute: parsed.defaultAttribute } : {}),
  };
}

export function parseLibrary(raw: string): BuildLibrary {
  const value = JSON.parse(raw) as BuildLibrary;
  if (!value || value.schema !== 1 || !Array.isArray(value.builds)) throw new Error('Invalid build library');
  const ids = new Set<string>();
  const builds = value.builds.map((build) => {
    const snapshot = parseSnapshot(build?.snapshot);
    if (!snapshot || typeof build.id !== 'string' || !build.id || ids.has(build.id) ||
      typeof build.name !== 'string' || !build.name.trim() || !Number.isFinite(build.updatedAt)) {
      throw new Error('Invalid saved build');
    }
    ids.add(build.id);
    return { ...build, snapshot };
  });
  if (value.activeId !== null && !ids.has(value.activeId)) throw new Error('Invalid active build');
  const draft = value.draft === null ? null : parseSnapshot(value.draft);
  if (value.draft !== null && !draft) throw new Error('Invalid draft');
  return { schema: 1, builds, activeId: value.activeId, draft };
}

export function selectedSnapshot(library: BuildLibrary): BuildSnapshot | null {
  return library.activeId ? library.builds.find((b) => b.id === library.activeId)?.snapshot ?? null : library.draft;
}
