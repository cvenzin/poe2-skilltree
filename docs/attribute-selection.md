# Attribute travel nodes

Generic attribute nodes are identified by the upstream `isGenericAttribute`
flag. Their original node keys, PassiveSkills IDs and graph links never change.
Selected bonuses use the names, stats and icons in the version's `skillOverrides`.

## Editing

Open **Build** to find **Default for new attribute nodes**, below the point
overview on desktop and mobile. Collapsing the toolbar hides the control to
keep the tree clear; tree-triggered bonus and first-allocation dialogs remain available.
Choose a default once; future path allocations apply it to all newly allocated
generic nodes in one undo step. Mouse hover previews a path and click allocates;
on touch, tap once to pin the preview and tap the same target again to allocate.
Changing targets or panning/pinching cancels that touch confirmation. The first
confirmed path containing an attribute node asks for a default before committing.
Cancelling leaves the path unallocated and requires a fresh touch preview.
Changing the default never rewrites existing choices.

Tap an allocated generic node in the tree currently being edited to open its
bonus picker. On phones this is a bottom sheet with large labelled buttons.
Changing the bonus leaves the path intact. **Remove node** is a separate action
that uses the same cascade rules as ordinary removal. Pan, pinch and long-press
inspection retain their gesture suppression.

Older builds remain **Unspecified**. **Unspecified allocated nodes** displays
their count below the default; selecting it opens the picker, which offers
**Apply default to unspecified nodes**, including both weapon sets. This is one
undoable edit and preserves all existing choices. Each shared node has one choice
active in both sets; each exclusive node's choice belongs to that branch.
This count describes existing nodes awaiting a bonus choice, not unspent points;
it does not block sharing or export.

Pathfinder alternatives are available only while the bundled export's
`AscendancyRanger3Notable9` (Traveller's Wisdom) is allocated in the shared tree
and belongs to the selected ascendancy. Removing its gate clears those choices
to unspecified and clears an unavailable default. Undo restores the gate and
its choices together. Standard Strength, Dexterity and Intelligence choices
remain available. This adapter is verified against every bundled version.

## State, persistence and sharing

`attributeChoices` maps numeric node keys to stable semantic values (`strength`,
`dexterity`, `intelligence`, `damage`, `defences`, `cost_efficiency`). Missing
entries mean unspecified. `defaultAttribute` is an optional build preference.
Allocation edits and attribute edits share immutable history snapshots; defaults
affect future edits and are saved separately from undo history. Undo and redo
clear a default if their restored allocation no longer unlocks it. Restoring
the unlock restores historical node choices, but does not reselect a cleared default.

LocalStorage snapshots include these optional fields. Share hashes add one
delta-encoded node list per chosen bonus (`at_strength=`, `at_dexterity=`, etc.)
and optional `ad=` for the default. Existing `n=` and weapon-set links still load.
Import reconciliation drops unavailable, unallocated, non-generic and locked
choices rather than interpreting a node's table ID as an attribute selection.

## Export

GGG's [Build Planner v1 format](https://www.pathofexile.com/developer/docs/game#buildplanner)
supports recommendations through `additional_text`. A chosen attribute exports
as an object retaining its original node ID and weapon-set assignment, with text
such as `+5 to Intelligence is recommended`. Unspecified nodes carry no
recommendation. The exported link also preserves the choices and default.
Players still select the recommended bonus when allocating points in-game.
