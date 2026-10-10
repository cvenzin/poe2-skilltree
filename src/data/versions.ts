// Hardcoded list of skill-tree export versions staged under `public/trees/<version>/`.
// To add a new version: drop the export folder under `public/trees/`, then prepend
// the version string here. Bump `DEFAULT_VERSION` if it should be the initial pick.

export const VERSIONS = ['0.5.5', '0.5.2', '0.5.1', '0.5.0'] as const;
export const DEFAULT_VERSION: (typeof VERSIONS)[number] = '0.5.5';

/** Return the newest installed patch in the same major/minor line, if newer. */
export function getPatchUpdateVersion(version: string | null): string | null {
  if (!version) return null;
  const current = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!current) return null;

  const [, major, minor, patch] = current;
  const currentPatch = Number(patch);
  let update: { version: string; patch: number } | null = null;

  for (const candidate of VERSIONS) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(candidate);
    if (!match || match[1] !== major || match[2] !== minor) continue;
    const candidatePatch = Number(match[3]);
    if (candidatePatch > currentPatch && (!update || candidatePatch > update.patch)) {
      update = { version: candidate, patch: candidatePatch };
    }
  }

  return update?.version ?? null;
}

// The class a fresh visitor (no share hash, no saved build) lands on. Should
// match `data.playableClassIndices[0]` — in 0.5.0 that's Witch (index 1; the
// lower indices are PoE1 placeholder classes with no ascendancies). Used to
// start that class's background loading before data.json is parsed (App.tsx).
// A wrong guess is harmless: the post-parse boot logic picks the real default
// and the lazy backdrop path loads it — we'd just waste one preload.
export const DEFAULT_CLASS = 'Witch';
