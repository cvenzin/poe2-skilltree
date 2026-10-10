# PoE 2 Skill Tree

A web-based viewer and planner for the Path of Exile 2 passive skill tree.
Lets you pick a class and ascendancy, search nodes, preview pathing, allocate
points within a budget, undo/redo, and share builds via URL.

Live: <https://poe2planner.app/>

## Features

- Class and ascendancy selection (filters to playable classes per export
  version).
- Search nodes by name or stats; Enter / Shift+Enter steps through matches.
- Click an unallocated node to preview the cheapest path from your class
  start; click again to allocate.
- Click an allocated node to cascade-unallocate every node that depended on
  it.
- Passive (123) and ascendancy (8) budget tracking; over-budget allocations are rejected and the chip flashes red.
- Undo / redo and a one-click reset.
- Select a default bonus for new attribute travel nodes, override individual
  nodes, or fill unspecified nodes from older builds. Choices support undo/redo,
  saving, sharing, and in-game export recommendations.
- Shareable URL hash encodes class, ascendancy, allocations, and version.
- Older trees show an update notice when a newer patch in the same version line
  is bundled; compatible allocations carry forward, and any changes are shown
  before applying the update.
- Export a `.build` file for PoE 2's in-game Build Planner, including both weapon sets.
- Pan, wheel-zoom, and pinch-zoom on touch.
- Mobile layout: collapsible toolbar and tooltips at the opposite screen edge
  from the pressed node (bottom for upper-half nodes, top for lower-half nodes).
  The tooltip stays at that edge during the hold; the toolbar fades while a
  top tooltip overlays it, then returns to normal when inspection ends.
  Long-press suppression prevents inspection from allocating nodes.
- Loading feedback appears only after 300 ms; the tree opens as soon as it is
  ready, with no minimum splash duration. The loader chooses its title font
  once when shown (the preloaded display face, or a stable system fallback).

## Tech stack

React 19, TypeScript, Vite, [pixi.js] v8, [pixi-viewport], [zustand],
[@floating-ui/react]. The viewer is a fully static SPA; GitHub Pages serves
the build with no backend.

[pixi.js]: https://pixijs.com/
[pixi-viewport]: https://github.com/davidfig/pixi-viewport
[zustand]: https://zustand-demo.pmnd.rs/
[@floating-ui/react]: https://floating-ui.com/

## Development

Use Node.js 24 (also used by CI).

```bash
npm ci
npm run dev      # vite dev server with HMR
npm run build    # tsc -b && vite build, output to dist/
npm run preview  # serve dist/ locally
npm run lint
npm test         # Vitest regression suite, including all bundled tree exports
```

Tests, lint, and the production build run in CI via [.github/workflows/deploy.yml]
on every push to `main`. Successful checks deploy `dist/` to GitHub Pages.

[.github/workflows/deploy.yml]: .github/workflows/deploy.yml

### Custom domain

GitHub Pages serves the site at `https://poe2planner.app/`. Vite's `base` is
`/` so public assets and tree exports load from the domain root. Keep the
repository's **Settings → Pages → Custom domain** set to `poe2planner.app`
and enable **Enforce HTTPS** once GitHub has provisioned the certificate.
DNS is managed at Porkbun and points the apex domain and `www` to GitHub Pages.
This repository deploys through GitHub Actions, so a `CNAME` file is not required.

### Export to the in-game Build Planner

Open the toolbar and choose **Export to PoE 2**. Name the build, then tap
**Download build** and save the `.build` file to Files or Downloads on your device.
Tap **Open GGG upload page**, sign in, and select the file you just downloaded.
Then select the guide in the game's Build Planner; points are still allocated in-game.

The file contains your passive tree, ascendancy (when selected), and weapon-set
assignments. It uses GGG's [Build Planner format](https://www.pathofexile.com/developer/docs/game#buildplanner)
and includes a link back to the planned tree. Export runs locally in your browser.
Gear, gems, and leveling stages are outside this planner's scope.

Attribute travel-node choices are included as recommendations on the relevant
nodes; you still choose the bonus in-game. See [attribute selection](docs/attribute-selection.md)
for mobile editing, defaults, legacy builds and Pathfinder alternatives.

### Regenerating icons

`public/favicon.svg` is the source of truth for the icon. To regenerate the
rasterized PNG variants (`apple-touch-icon.png`, `icon-192.png`,
`icon-512.png`):

```bash
node scripts/gen-icons.mjs
```

## Tree data

Tree data under `public/trees/<version>/` comes from GGG's official export:
<https://github.com/grindinggear/poe2-skilltree-export>. Adding a new version
is a matter of dropping a new export folder into `public/trees/` and
prepending the version string to [src/data/versions.ts]. Import provenance is
recorded in [docs/tree-imports.md](docs/tree-imports.md).

For repeatable release imports, use the repository's
[`update-poe2-tree` skill](.agents/skills/update-poe2-tree/SKILL.md), which covers
version selection, asset/schema compatibility, and runtime verification.
Project working instructions live in [AGENTS.md](AGENTS.md). For game mechanics
and terminology, consult the [PoE 2 Wiki](https://www.poe2wiki.net/wiki/Path_of_Exile_2_Wiki);
use [PoE2DB](https://poe2db.tw/) for game-data lookups and stat wording. Check
that the information applies to the tree's patch version.

[src/data/versions.ts]: src/data/versions.ts

## License

MIT — see [LICENSE](LICENSE).

Path of Exile 2 is a trademark of Grinding Gear Games Ltd. This product
isn't affiliated with or endorsed by Grinding Gear Games in any way.

### Fonts

UI titles use **OptimusPrinceps SemiBold** by Manfred Klein
(self-hosted at `public/fonts/`, free for personal and commercial use,
redistribution allowed) with **Cinzel** (Google Fonts, SIL OFL) as the
loading fallback.
