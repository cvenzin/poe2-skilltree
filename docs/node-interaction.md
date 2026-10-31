# Tree interaction design

The tree is the primary place to inspect and edit a build. Keep node details
compact, make the effect of an edit visible before it happens, and leave room
for the tree. Input behavior follows the pointer being used: a mouse on a
phone-sized screen uses desktop interactions, and touch on a larger screen
uses mobile interactions.

## Desktop: mouse and pen

### Inspect and allocate

- Hover a node to see its name and stats. For an available unallocated node,
  highlight the path to it and show the point cost.
- Click the node to allocate the path. If the path needs a default attribute
  choice, show the choice and the full path cost before completing it.
- Keep the tooltip informational: it follows the pointer, does not intercept
  it, and has no allocation or close button. Escape dismisses it until the
  pointer leaves and re-enters the node.

### Remove

- Hover an allocated non-attribute node to mark the nodes its removal would
  also remove in red and show the point refund. This includes dependent
  weapon-set branches.
- Click to remove the node and its dependent branches immediately, without a
  confirmation. The edit is undoable in one step.
- Clicking an allocated attribute node opens its bonus editor. Its Remove
  control previews the effect; a removal that affects other nodes requires
  confirmation inside the editor.

## Mobile: touch

### Inspect and allocate

- Tap an unallocated node to show its details and highlighted path; tap the
  same node again to allocate. Alternatively, long press to inspect, release,
  and tap the same node once to allocate. A long press alone never allocates.
- Keep the tooltip at the top or bottom of the screen, opposite the finger.
  Once a valid path is ready, show its cost and a quiet “Tap again to allocate”
  cue. Keep inspection visible after release so the user can read it.
- Allow long tooltip content to scroll. The close control, a tap on empty tree
  space, or a pan or pinch dismisses inspection. Scrolling and dismissal must
  not edit the build.
- Favor the node directly under the finger. When a touch is too ambiguous to
  choose safely, ask the user to tap closer or zoom in rather than choosing a
  different node silently.

### Remove

- Tap an allocated node to remove it. If removal would also remove dependent
  nodes, mark those nodes on the tree and ask for confirmation with the point
  impact. A single-node removal is immediate.
- An allocated attribute node opens its bonus editor. Removing dependent nodes
  from that editor requires confirmation there. Cancelling leaves the build
  unchanged; a completed edit is undoable in one step.

## Keyboard access

Search highlights matching nodes on the tree. Enter and Shift+Enter move
through matches; Alt+Enter opens a separate accessible inspector for the
current match. It provides the full node details and an action to allocate,
edit an attribute, or remove. Escape closes it and returns focus to search.
Keyboard cascade removals use a confirmation. Undo and redo remain in the
Build menu and are also available through their keyboard shortcuts.

## Shared behavior

- **Costs and availability:** Show the actual cost of a proposed path,
  accounting for free skills, automatic options, ascendancy points, and the
  edited tree. Explain rejected or unavailable edits when the reason is known.
- **Weapon sets:** Main, Set 1, and Set 2 edit only their own allocations.
  A shared removal can affect both weapon-set branches; show the affected
  branches before committing. See [weapon-set support](weapon-set-support.md)
  for connectivity and budget rules.
- **Special choices:** Replacing an option that would remove dependent nodes
  requires confirmation. Class starts are implicit; use Reset in the Build
  menu to clear allocations.
- **Safe interaction:** Pan, pinch, cancelled pointers, and releasing a gesture
  must not allocate or remove nodes. Changes to the build or editing context
  invalidate any pending preview or confirmation rather than committing a
  stale action.
