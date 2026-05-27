# PoE 2 Skill Tree Viewer

A web-based viewer and planner for the Path of Exile 2 passive skill tree.
Lets you pick a class and ascendancy, search nodes, preview pathing, allocate
points within a budget, undo/redo, and share builds via URL.

Live: <https://cvenzin.github.io/poe2-skilltree/>

## Features

- Class and ascendancy selection (filters to playable classes per export
  version).
- Search nodes by name or stats; Enter / Shift+Enter steps through matches.
- Click an unallocated node to preview the cheapest path from your class
  start; click again to allocate.
- Click an allocated node to cascade-unallocate every node that depended on
  it.
- Passive and ascendancy budgets with editable caps.
- Undo / redo and a one-click reset.
- Shareable URL hash encodes class, ascendancy, allocations, and version.
- Pan, wheel-zoom, and pinch-zoom on touch.
- Mobile layout: collapsible toolbar, bottom-anchored tooltips, long-press
  suppression so dwelling on a node to read its stats doesn't allocate.

## Tech stack

React 19, TypeScript, Vite, [pixi.js] v8, [pixi-viewport], [zustand],
[@floating-ui/react]. The viewer is a fully static SPA; GitHub Pages serves
the build with no backend.

[pixi.js]: https://pixijs.com/
[pixi-viewport]: https://github.com/davidfig/pixi-viewport
[zustand]: https://zustand-demo.pmnd.rs/
[@floating-ui/react]: https://floating-ui.com/

## Development

```bash
npm install
npm run dev      # vite dev server with HMR
npm run build    # tsc -b && vite build, output to dist/
npm run preview  # serve dist/ locally
npm run lint
```

The build runs in CI via [.github/workflows/deploy.yml] on every push to
`main` and deploys `dist/` to GitHub Pages.

[.github/workflows/deploy.yml]: .github/workflows/deploy.yml

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
appending the version string to [src/data/versions.ts].

[src/data/versions.ts]: src/data/versions.ts

## License

MIT — see [LICENSE](LICENSE).

Path of Exile 2 is a trademark of Grinding Gear Games Ltd. This product
isn't affiliated with or endorsed by Grinding Gear Games in any way.
