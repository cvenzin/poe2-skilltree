# Tree export imports

## 0.5.2

- Source: [GGG release 0.5.2](https://github.com/grindinggear/poe2-skilltree-export/releases/tag/0.5.2).
- Commit: `1e9eb2d8c1946398c3aaaacfbaead5c75c0d1fa6`.
- Imported on: 2026-10-09.
- Destination: `public/trees/0.5.2/`, copied from the release commit's source
  archive. The release had no separately uploaded export assets.
- `data.json` SHA-256: `f83c94ce7b09f2bfc5b3b1d63523c2ab3d2582d0e964f6aeec34b8b0390abcfe`.
- Upstream data, atlas JSON, WebP images, and README are preserved unmodified.

Compared with the bundled 0.5.1 export, 0.5.2 has the same 5,151 node keys and
6,074 edges, with eight changed node records. Changes include infusion stat
wording, Ice Storm / Lightning Storm stats, and Zarokh's Gift socket wording.
No new top-level or node fields were introduced, and edge topology is unchanged.
Atlas JSON metadata changed; frame definitions and WebP images did not.
Required images, frame keys for all rendered node
states, scales, bounds, playable class starts, and class backgrounds were
checked against the existing adapters.

The new export becomes the default. Versions 0.5.1 and 0.5.0 remain available
for existing shared builds. No application compatibility changes or budget
changes were needed.

Validation: all 38 imported files match the release commit byte-for-byte.
Production build and lint pass. Browser checks covered all eight playable
classes and 22 ascendancies, updated Ice Storm tooltip stats, search/path
preview, click allocation, undo/redo, saved-build reload, shared links with
both weapon sets, all version switches, and an older-version shared link.
Mobile checks covered toolbar/search, long-press suppression, quick-tap
allocation, and touch pan/pinch without unintended allocations. No browser
errors or failed HTTP responses were observed in these checks.

Focused checks against all three bundled versions covered graph endpoints,
weapon-set isolation, dependent-branch cascade pruning, passive and weapon-set
budget rejection, immutable undo/redo snapshots, share round-trips, legacy
saved builds, and unlock constraints. Verification also exposed an existing
renderer lint issue: updating `propsRef` during render. Its update now runs in
the existing class/ascendancy effect, and switching was rechecked in the browser.
