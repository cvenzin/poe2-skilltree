# Project guidance

## Scope and architecture

This is a static Path of Exile 2 passive-tree viewer and build planner, using
React, TypeScript, Vite, PixiJS v8, pixi-viewport, and Zustand. GitHub Pages
serves it under `/poe2-skilltree/`; use `import.meta.env.BASE_URL` for public
asset URLs.

- `src/data/`: export types, loading, normalization, and available versions.
- `src/interaction/`: graph pathing, search, and stat markup.
- `src/state/`: allocation rules, Zustand state, undo/redo, persistence, and sharing.
- `src/render/`: Pixi canvas, atlas loading, textures, and node visuals.
  `TreeCanvas.tsx` owns the React lifecycle; `render/tree/` contains scene mounting,
  class/ascendancy swaps, pointer interaction, camera, edges, nodes, and overlays.
- `src/ui/`: React controls, tooltips, keyboard shortcuts, and theme.
- `public/trees/<version>/`: upstream `data.json` and `assets/` for each tree version.

Use [README.md](README.md) for setup. Read
[docs/weapon-set-support.md](docs/weapon-set-support.md) when changing allocation,
pathing, budgets, weapon-set visuals, or build serialization. Update relevant
documentation when behavior changes; avoid duplicating detailed design here.

## Commands and verification

- Install dependencies with `npm ci` using the committed lockfile.
- `npm run dev` starts Vite; `npm run preview` serves the production build.
- Run `npm test`, `npm run build`, and `npm run lint` for application-code changes.
- Vitest regression tests live in `tests/` and cover allocation, pathing, budgets,
  history, persistence, sharing, and every bundled export's data/atlas compatibility.
  For behavior changes, also manually check affected flows and report verification.
  Allocation changes should cover preview/commit, cascade removal, both weapon
  sets, budget rejection, and undo/redo. Persistence changes should cover share
  round-trips, reload, and legacy builds. UI changes should include desktop and
  mobile interaction where relevant.
- `public/favicon.svg` is the icon source; regenerate PNGs with
  `node scripts/gen-icons.mjs` when changing it.

## Behavior to preserve

- Each node belongs to exactly one of `shared`, `set1`, or `set2`. Shared paths
  connect using shared nodes only; each weapon-set branch connects through
  `shared` plus its own set. Removing shared nodes must prune dependent branches.
- Allocation sets and undo/redo snapshots are immutable. Return fresh objects
  for changes so Zustand and history retain correct identity and contents.
- Budget constants live in `src/state/store.ts`. Validate passive totals per
  weapon set and specialization limits independently; keep ascendancy accounting
  separate. Verify mechanics before changing these rules or constants.
- Preserve legacy localStorage builds (`allocated` becomes `shared`) and share
  links with only `n=`. Keep class names, ascendancy IDs, node keys, and version
  handling stable. Boot precedence is URL hash, saved build, then defaults.
- Keep export quirks in normalization or rendering adapters. Respect playable
  class/ascendancy filtering and unlock constraints across pathing and search.
- Release Pixi textures, subscriptions, listeners, and ticker callbacks when
  switching versions or unmounting. Preserve pan/zoom and mobile long-press
  behavior when changing canvas interaction.

## File size and cohesion

Use these as practical guidelines, counting the whole file. At the review
threshold, consider whether independent responsibilities deserve separate
components, hooks, or modules. Prefer cohesive files and clear boundaries;
avoid fragmentation or abstractions created solely to meet a line count.

| File type | Ideal size (lines) | Consider refactoring at (lines) |
| --- | --- | --- |
| React component (`.tsx`) | 50–150 | 200–250 |
| Page / container component | 100–250 | 300–400 |
| Custom hook (`useX.ts`) | 30–100 | 150–200 |
| Service / API client (`.ts`) | 50–150 | 200–300 |
| Utility / helper (`.ts`) | 20–100 | 150–200 |
| Context / provider (`.tsx`) | 50–150 | 200–250 |
| Types / interfaces (`.ts`) | 30–150 | 250–300 |
| Constants / configuration | No strict limit | Based on complexity |
| Test files (`.test.ts`, `.test.tsx`) | 100–300 | 400–500 |

For existing large modules, extract cohesive pieces when related work benefits
from it. Keep unrelated refactors out of focused fixes. Generated and upstream
export files are exempt from these guidelines.

## PoE 2 sources and tree updates

- Use [GGG's official export releases](https://github.com/grindinggear/poe2-skilltree-export/releases)
  for tree data and assets. Preserve versioned exports and upstream attribution;
  make app-specific adaptations in code rather than editing exported data.
- Use the [Path of Exile 2 Wiki](https://www.poe2wiki.net/wiki/Path_of_Exile_2_Wiki)
  for mechanics, terminology, and other game context. Read the relevant article
  and check its patch context; prefer official GGG material when sources conflict.
  Avoid applying PoE 1 mechanics or assuming the newest wiki describes older trees.
- Use [PoE2DB](https://poe2db.tw/) for game-data lookups, stat wording, and
  cross-checking passives, skills, and items. Check the page's patch/version
  context and distinguish released content from previews or unused entries.
  Keep GGG's versioned exports authoritative for the bundled tree data.
- For requests to import or update tree releases, use the repository skill at
  [.agents/skills/update-poe2-tree/SKILL.md](.agents/skills/update-poe2-tree/SKILL.md).
