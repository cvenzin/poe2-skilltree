# Tree export imports

## 0.5.5

- Source: [GGG export commit 0.5.5](https://github.com/grindinggear/poe2-skilltree-export/commit/bd87e6512c92b868542eddfb1ba4ea8b6dc2da36).
- Commit: `bd87e6512c92b868542eddfb1ba4ea8b6dc2da36` (2026-09-04).
- This export was committed to `main` without a matching release or tag;
  GitHub's latest published release still points to 0.5.2. The live patch is
  documented in [GGG's 0.5.5 patch notes](https://www.pathofexile.com/forum/view-thread/4000864).
- Imported on: 2026-10-09.
- Destination: `public/trees/0.5.5/`, copied from the immutable commit's source archive.
- `data.json` SHA-256: `b52be9c4f17e4114064255ef1b8c58292e9db0e395d95af235a8d3fef0d44642`.
- All 38 upstream files, including data, matching assets, and README, are
  preserved unmodified and verified byte-for-byte against the staged archive.

The previously bundled 0.5.2 data matches its own release; it was not already
0.5.5 with an outdated label. This import adds 0.5.5 as a separate version and
sets it as the default, preserving 0.5.2, 0.5.1, and 0.5.0 for existing builds.
The version selector and share links derive their version from that selection.

Compared with 0.5.2, the export has 5,153 nodes and 6,076 edges (two additional
icon-less Huntress ascendancy connectors). There are 287 changed existing node
records, mostly Hit stat markup, plus node/group/edge updates, passive names,
and granted-skill metadata. Staunch Deflection gains Deflection Rating equal to
8% of Evasion Rating; Dominus' Providence replaces immunity to Elemental
Weakness with 30% reduced curse effect. These stats were cross-checked against
[PoE2DB's Staunch Deflection](https://poe2db.tw/us/Staunch_Deflection) and
[Dominus' Providence](https://poe2db.tw/us/Dominus_Providence) pages; those pages
do not expose a patch label, so the pinned GGG export remains authoritative.
The relevant PoE 2 Wiki page could not be read (HTTP 403).

No top-level or node fields were added. Classes, playable ascendancies,
multiple-choice rules, and unlock constraints remain compatible with the
existing adapters. Both skills atlases and their WebP images changed; other
assets are identical to 0.5.2. No application adapter or budget changes were
needed.

Validation: all 87 tests pass across all four bundled exports, including
data/atlas compatibility, allocation/pathing, weapon-set branches, history,
persistence, sharing, attributes, and in-game build export. Production build
and lint pass. The updated import skill passes its frontmatter validator.

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

