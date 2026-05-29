// Hardcoded list of skill-tree export versions staged under `public/trees/<version>/`.
// To add a new version: drop the export folder under `public/trees/`, then append
// the version string here. Bump `DEFAULT_VERSION` if it should be the initial pick.

export const VERSIONS = ['0.5.0'] as const;
export const DEFAULT_VERSION: (typeof VERSIONS)[number] = '0.5.0';

// The class a fresh visitor (no share hash, no saved build) lands on. Should
// match `data.playableClassIndices[0]` — in 0.5.0 that's Witch (index 1; the
// lower indices are PoE1 placeholder classes with no ascendancies). Used to
// start that class's background loading before data.json is parsed (App.tsx).
// A wrong guess is harmless: the post-parse boot logic picks the real default
// and the lazy backdrop path loads it — we'd just waste one preload.
export const DEFAULT_CLASS = 'Witch';
