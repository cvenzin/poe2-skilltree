---
name: update-poe2-tree
description: Import or update Path of Exile 2 passive skill-tree exports from GGG releases in this repository, register versions, and verify data and rendering compatibility. Use for adding a tree version or updating to the latest export; not for general build advice or unrelated UI changes.
---

# Update PoE 2 tree exports

Import a reproducible upstream export into `public/trees/<version>/`, register
it in `src/data/versions.ts`, and verify it works with the planner. Resolve
paths from the repository root and follow its `AGENTS.md`.

## Select the upstream version

- Inspect [GGG's export releases](https://github.com/grindinggear/poe2-skilltree-export/releases)
  when the task is performed. Honor a requested version; for "latest", resolve
  the latest stable published release rather than assuming the default branch
  or the highest local folder is current. Use tags or the GitHub releases API if
  the release page cannot display its downloads.
- Record the exact tag, release URL, and commit when available. For a re-export
  under an existing tag, compare its contents before replacing anything locally.
- Download the release's export asset when provided, or check out/download the
  source at the exact release tag. Stage it in a temporary directory outside
  `public/trees`; preserve upstream documentation and asset filenames.
- A request only to check for updates calls for a comparison and report. Import
  files when the user asks to add or update a version.

## Inspect and integrate

- Compare with existing version directories. The destination must contain
  `data.json` and `assets/` directly, without an extra archive wrapper directory.
  Copy export content only; keep temporary archives and upstream `.git` metadata
  out of the project. Retain older versions so existing shared links work.
- Check the incoming schema against `src/data/types.ts`, `loader.ts`, and
  `normalize.ts`: required fields, edge endpoints, class starts, playable
  ascendancies, node IDs/keys, unlock constraints, and multiple-choice nodes.
  Investigate differences before changing adapters; keep upstream data intact.
- Check `src/render/atlas.ts` and `frameForNode.ts` against incoming atlases.
  Verify required static atlases, per-class `background-<class>` atlases,
  `meta.image` files relative to each atlas JSON, frame keys, and `meta.scale`.
  Data and assets must come from the same export.
- Add the version once to `VERSIONS` in `src/data/versions.ts`, keeping the
  newest-first order. For a routine update to the latest stable release, set
  `DEFAULT_VERSION` to the new version; preserve it for historical additions
  or when the user requests that. Recheck `DEFAULT_CLASS` against the export's
  first playable class if class availability/order changes.
- Review any newly introduced mechanics. Use the relevant
  [PoE 2 Wiki](https://www.poe2wiki.net/wiki/Path_of_Exile_2_Wiki) article for
  mechanics context and [PoE2DB](https://poe2db.tw/) for game-data lookups and
  stat wording. Use official GGG material to resolve conflicts and keep the
  selected GGG export authoritative for bundled tree data. Check patch/version
  applicability and distinguish released content from previews or unused
  entries. A data import alone does not establish changes to point caps,
  allocation rules, or build serialization.
- Make only compatibility changes needed by this export. Update project docs
  when supported behavior changes. Record the upstream source/tag, commit,
  data-file SHA-256, material schema/asset differences, and completed checks in
  `docs/tree-imports.md`. Include the source and significant changes in the
  change description.

## Verify the result

- Parse the imported JSON and check required fields and referenced atlas images.
  Confirm every registered version has its expected directory. TypeScript and
  Vite builds alone do not validate runtime JSON or atlas content.
- Run `npm run build` and `npm run lint`. Inspect the running app under
  `/poe2-skilltree/` for asset 404s, missing frames, and console/load errors.
- Switch between the new and an older version. Check playable class and
  ascendancy selection, class backgrounds, search, tooltip stats, path preview
  and allocation, cascade removal, budgets, undo/redo, and both weapon sets.
  Exercise newly changed node mechanics and mobile pan/zoom where relevant.
- Round-trip a shared build using the new export, reload a saved build, and
  check an existing older-version link still loads its own data and allocations.
- Review the diff for accidental export modifications, unrelated deletions, or
  temporary files. Report the imported tag, default version, compatibility
  changes, checks completed, and anything that could not be verified. Do not
  describe browser checks as passed unless they were actually performed.
