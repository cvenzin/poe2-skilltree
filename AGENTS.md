# Project guidance

## Scope and architecture

This is a static Path of Exile 2 passive-tree viewer and build planner using
React, TypeScript, Vite, PixiJS v8, pixi-viewport, and Zustand. GitHub Pages
serves it at `https://poe2planner.app/`. Use `import.meta.env.BASE_URL` for
public asset URLs.

- `src/data/` covers export types, loading, normalization, and available versions.
- `src/interaction/` covers graph pathing, search, and stat markup.
- `src/state/` covers allocation rules, Zustand state, undo/redo, persistence,
  and sharing. The budget constants currently live in `src/state/store.ts`.
- `src/render/` covers the Pixi canvas, atlas loading, textures, and node visuals.
  `TreeCanvas.tsx` owns the Pixi scene lifecycle in React. `render/tree/` handles
  scene mounting, class/ascendancy swaps, pointer interaction, camera, edges,
  nodes, and overlays.
- `src/ui/` covers React controls, tooltips, keyboard shortcuts, and theme.
- `public/trees/<version>/` contains upstream `data.json` and `assets/` for each
  tree version.

Use [README.md](README.md) for setup. Consult the relevant design docs before
changing behavior and update them when supported behavior changes.

- [Weapon-set support](docs/weapon-set-support.md) covers allocation, pathing,
  budgets, weapon-set visuals, and build serialization.
- [Build library](docs/build-library.md) covers storage, restore, and sharing.
- [Node interaction](docs/node-interaction.md) covers pointer, touch, and
  keyboard behavior.
- [Passive tree effects](docs/passive-tree-effects.md) covers special passive
  mechanics.

## Commands and verification

- Install dependencies with `npm ci` using the committed lockfile.
- `npm run dev` starts Vite; `npm run preview` serves the production build.
- Run relevant targeted tests during development. Before completing
  application-code changes, run `npm test`, `npm run build`, and `npm run lint`.
- Vitest regression tests live in `tests/` and cover allocation, pathing, budgets,
  history, persistence, sharing, and every bundled export's data/atlas compatibility.
- Add or update regression coverage when the existing suite would miss a
  meaningful behavior or compatibility change.
- Perform manual browser checks for affected runtime behavior when the
  environment permits.
  - For allocation, check path preview and commit, cascade removal, both weapon
    sets, budget rejection, and undo/redo.
  - For persistence, check share round-trips, reload, and legacy builds.
  - For rendering, check asset loading, missing frames, version/class switching,
    and resource cleanup.
  - For UI changes, check desktop and mobile interactions where relevant.
- Report verification as **passed, failed, skipped, or blocked**. Report a check
  as passed only after performing it. Explain failures and incomplete checks.
- Regenerate PNGs with `node scripts/gen-icons.mjs` when changing the icon
  source, `public/favicon.svg`.

### Preview browser and Vite connectivity

Use the in-app preview browser for local manual checks in this workspace. Start
Vite outside the network-restricted execution sandbox from the outset through
the normal execution approval mechanism.

```sh
npm run dev -- --host 0.0.0.0 --port 5188 --strictPort
```

- If the port is occupied, choose another explicit port.
- Wait for Vite to report ready. Verify HTTP connectivity from outside the
  network-restricted sandbox before opening the preview browser. Use
  `curl.exe --fail http://127.0.0.1:<port>/` on Windows or
  `curl --fail http://127.0.0.1:<port>/` elsewhere.
- Open the verified URL and inspect the affected flows, console errors, and
  failed asset requests.
- If navigation times out, close the failed preview tab and report the limitation.
- Stop the Vite process started for the check when finished, including its
  child processes.
- Keep firewall and browser security settings intact.

## Behavior to preserve

- Each allocated node belongs to exactly one of `shared`, `set1`, or `set2`.
  Shared paths connect using shared nodes only. Each weapon-set branch connects
  through `shared` plus its own set. Removing shared nodes must prune dependent
  branches.
- Allocation sets and undo/redo snapshots are immutable. Return fresh objects
  for changes so Zustand and history retain correct identity and contents.
- Validate passive totals per weapon set and specialization limits independently.
  Keep ascendancy accounting separate. Verify mechanics and patch applicability
  before changing these rules or constants.
- Preserve legacy localStorage builds (`allocated` becomes `shared`) and share
  links with only `n=`. Keep class names, ascendancy IDs, node keys, and version
  handling stable. Boot precedence is URL hash, saved build, then defaults.
- Handle upstream export quirks in normalization or rendering adapters. Respect
  playable class/ascendancy filtering and unlock constraints across pathing
  and search.
- Release Pixi textures, subscriptions, listeners, and ticker callbacks when
  switching versions or unmounting. Preserve pan/zoom and mobile long-press
  behavior when changing canvas interaction.

## File size and cohesion

Prefer cohesive modules with clear responsibilities. Use the whole file's line
count as a cue to review whether it has independent responsibilities.

- Consider refactoring React components, hooks, services, and utilities around
  200–300 lines.
- Consider refactoring page and container components around 300–400 lines.
- Consider splitting test files around 400–500 lines.
- Group types, interfaces, and configuration by concept.

During related work, extract cohesive pieces when doing so improves readability,
testing, or maintainability. Keep unrelated refactors out of focused changes.
Generated files and upstream exports are exempt.

## PoE 2 sources and tree updates

Check publication dates, patch applicability, and whether content is released,
previewed, unused, or historical.

- **Official announcements and clarifications.** Use [GGG's official PoE 2 forums](https://www.pathofexile.com/forum/view-category/poe2)
  for announcements, game status, and developer clarifications. Prefer GGG-authored
  posts. Distinguish community discussion and bug reports from confirmed GGG information.
- **Tree data and assets.** Use GGG's official [export releases](https://github.com/grindinggear/poe2-skilltree-export/releases)
  and [version-labelled commits on the default branch](https://github.com/grindinggear/poe2-skilltree-export/commits/main/).
  Preserve versioned exports, exact upstream provenance, and attribution. Keep
  exports intact and make application-specific adaptations in code.
- **Patch-specific behavior.** Check [GGG's Early Access patch notes](https://www.pathofexile.com/forum/view-forum/2212)
  for version-specific changes. Use official GGG material to resolve conflicts.
- **Mechanics and terminology.** Use the [Path of Exile 2 Wiki](https://www.poe2wiki.net/wiki/Path_of_Exile_2_Wiki)
  for mechanics and game context. Use PoE 2 mechanics that apply to the tree's patch.
- **Game-data cross-checks.** Use [PoE2DB](https://poe2db.tw/) for stat wording
  and cross-checking passives, skills, and items.

The selected, versioned GGG export is authoritative for bundled tree data.
Verify executable allocation rules and gameplay compatibility separately from
stat wording and data import checks.

For requests to check for new tree exports, import one, or update bundled exports,
follow the [tree-import skill](.agents/skills/update-poe2-tree/SKILL.md). Audit new
and changed tree-modifying passives against supported metadata and special-case
logic. Follow the skill's mechanics checklist, preserve older-version behavior,
and document unsupported or unverified effects.

You can select a candidate export as the default locally for verification. Ship
it as the default only after critical schema, atlas, allocation, and serialization
checks pass. Report remaining limitations.
