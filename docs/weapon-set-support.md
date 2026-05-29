# PoE2 Weapon Set Support — Design

How weapon-set passive allocation works in the planner. Base tree data comes
from GGG's official
[poe2-skilltree-export](https://github.com/grindinggear/poe2-skilltree-export);
weapon-set allocation is pure user build state layered on top.

## Model

A build has three allocation buckets ([`src/state/allocation.ts`](../src/state/allocation.ts)):

```ts
interface Allocation {
  shared: ReadonlySet<string>; // the main tree — active in both weapon sets
  set1:   ReadonlySet<string>; // Weapon Set 1 branch
  set2:   ReadonlySet<string>; // Weapon Set 2 branch
}
```

- **Shared is truly shared** — one main tree, active in both weapon sets.
- **Set 1 / Set 2 are leaf branches** off the main tree. A set node connects to
  the class start over `shared ∪ setN`. The main tree connects over `shared`
  **only** — it never routes through a weapon-set node, and the two sets never
  route through each other.

### Points

A weapon set's **active** total is `shared + setN`, validated against the
passive-point budget *independently per set* (shared counts toward both). The
set-specific count additionally has its own specialization cap.

```text
shared + set1 ≤ PASSIVE_CAP   (123)
shared + set2 ≤ PASSIVE_CAP
set1 ≤ WEAPON_SET_CAP          (24)
set2 ≤ WEAPON_SET_CAP
```

The two sets can have different active totals and different unspent remainders.
Caps are fixed constants in [`src/state/store.ts`](../src/state/store.ts).

## Editing

A **Main / Set 1 / Set 2** selector (`allocationMode`) picks which tree you're
editing; clicks add/remove nodes only in that tree:

- **Main** — frontier `shared`, blocks `set1 ∪ set2`.
- **Set 1** — frontier `shared ∪ set1`, blocks `set2`.
- **Set 2** — frontier `shared ∪ set2`, blocks `set1`.

Per-mode frontier/blocked sets come from `frontierForMode` / `blockedForMode`.
Clicking a node that belongs to a different tree is a no-op. There is no
node-conversion between trees — switch mode and re-allocate.

`resolveCascade` ([`src/interaction/pathing.ts`](../src/interaction/pathing.ts))
revalidates after every edit: the main tree is pruned to shared-only
reachability first, then each set is pruned against the *surviving* main tree —
so removing a shared node correctly drops any branch that hung off it.

## Rendering

Both trees are always visible. Nodes paint with the normal allocated frame; the
**edge colour** carries the set identity ([`src/render/TreeCanvas.tsx`](../src/render/TreeCanvas.tsx)):
main = gold, Set 1 = green, Set 2 = red. A Set 1 ↔ Set 2 edge belongs to neither
tree and stays uncoloured.

## Weapon Sets toggle

A "Weapon Sets" checkbox (off by default) gates the whole feature. When off:
the edit selector is hidden, editing is forced to the main tree, counters
collapse to a single `Passives N / 123`, and tooltips omit weapon-set wording.
It's a free user preference (not persisted); loading a build that already uses
sets flips it on so points are never hidden.

## Persistence

`BuildSnapshot` stores `shared` / `set1` / `set2`
([`persistence.ts`](../src/state/persistence.ts),
[`shareHash.ts`](../src/state/shareHash.ts)). Backward compatible: a
pre-weapon-set build (single `allocated` list, or share hash with only `n=`)
loads as shared-only. Share hash adds `w1=` / `w2=` for the set branches.

## Not implemented

Gear/skill-gem weapon-set binding, DPS/stat calculation, automatic tree
optimization, user-configurable point totals, and automated tests (no test
runner is set up in this project).
