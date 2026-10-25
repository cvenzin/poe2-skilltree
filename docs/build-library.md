# Local build library

The toolbar's **My builds** selector manages named builds. New drafts autosave,
but must be named to stay in the list after another build opens. Names are
trimmed and required; duplicate names are allowed because builds use stable IDs.
Each saved entry contains its name, update timestamp, and complete
`BuildSnapshot`: tree version, class, ascendancy, shared and both weapon-set
allocations, attribute choices, and default attribute.

## Storage and restore

`poe2-tree:builds` contains a schema-versioned library (`schema: 1`), named
`builds`, `activeId`, and an optional `draft`. A null active ID selects the draft.
The original `poe2-tree:last` save migrates once to a named **My build** when
there is no library. Its original entry remains as a backup. An existing empty
library takes precedence over that entry, so deleted builds never return.
The original `allocated` array is still accepted as shared-only allocation.

Boot precedence remains URL hash, active library snapshot, defaults. Opening a
shared URL creates an independent draft; saving it creates a new named entry.
Switching builds clears the URL hash, loads the build's own version, and resets
history and transient editing state through the existing snapshot restore.
Unavailable or invalid saved builds are preserved in the library instead of
being replaced with a blank tree.

## Save boundaries

Build edits autosave after 500 ms. Hover, search, camera, and undo history are
not build data. Pending edits flush before library actions, on page hide, and
when the document becomes hidden. Old-version persistence cannot write into a
newly selected build during asynchronous tree loading.

Naming, duplication, selection, and deletion commit only after browser storage
accepts the library. Failed autosaves retain the latest snapshot in memory and
show a visible error; switching is blocked until a save succeeds. Corrupt or
unreadable storage is left untouched for recovery; reload after resolving it.
If a shared URL or a fallback tree opens during startup while storage is full,
it stays in an independent draft in memory. Named builds remain intact when
saving recovers. During editing, opening a shared URL for another version first
requires the current build to save successfully.
The library is local to this browser, device, and site origin. There is no cloud
sync or cross-tab merge; avoid editing the library in multiple tabs at once.

## Version changes and deletion

Changing tree versions or accepting a patch update creates a named copy using
the existing reconciliation rules. Allocations or choices removed by a version
change require confirmation. An unnamed source draft is first saved as
**My build**, so the original is retained as well.

Deletion requires confirmation with the build's name. Deleting the active build
opens a remaining build with an available version; deleting the last usable
build opens a blank draft. Deleting a build cannot be undone. Allocation
undo/redo never crosses build boundaries.
Duplicating starts the copy with empty undo/redo history; renaming keeps the
current build's history.

## Verification

`tests/build-library.test.ts` covers migration, stable IDs, independent copies,
pending-edit flushing, reload, sharing and legacy hashes, version switching,
deletion, page-exit saves, storage errors, and corrupt-data preservation.
`tests/build-restore.test.ts` covers save failures before shared-link version
changes, startup drafts, recovery, and reload without overwriting named builds.
The existing allocation, persistence, sharing, and export suites remain in use.
UI checks cover desktop and mobile naming, switching, delete confirmation,
touch targets, dialog sizing, and reuse of the saved name during export.
