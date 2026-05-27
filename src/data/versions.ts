// Hardcoded list of skill-tree export versions staged under `public/trees/<version>/`.
// To add a new version: drop the export folder under `public/trees/`, then append
// the version string here. Bump `DEFAULT_VERSION` if it should be the initial pick.

export const VERSIONS = ['0.5.0'] as const;
export const DEFAULT_VERSION: (typeof VERSIONS)[number] = '0.5.0';
