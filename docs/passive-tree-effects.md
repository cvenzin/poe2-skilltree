# Passive effects on tree planning

The bundled GGG exports remain unchanged. Allocation rules and derived tooltip
values use these adapters for 0.5.0 through 0.5.5.

## Free ascendancy skills and unlocks

`TreeNode.isFree` makes a skill cost zero points while retaining its normal
connectivity and prerequisite checks. This applies to Sanguimancy, Smith's
Masterwork and Sacred Unity. The same budget counter validates edits, imports
and in-game exports, allowing eight paid ascendancy points alongside a free skill.

Sacred Unity requires Vivid Stampede, Wild Protector and Primal Bounty. Locked
ascendancy nodes use the same visibility, search and allocation gates as locked
main-tree nodes. Overlay registrations are removed when switching ascendancy.

## Entwined Realities and radius previews

PoE 2 radius sizes are Small 1000, Medium 1150 and Large 1300, multiplied by
the passive-tree distance multiplier of 1.2. The corresponding rendered world
radii are **1200, 1380 and 1560**. Allocation, cascade retention and the Oracle
keystone hover ring all use the same Medium radius of 1380.

Sources checked on 2026-10-31:

- Path of Building PoE 2's [radius table and conversion](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/dev/src/Modules/Data.lua)
  and [exported game distance multiplier](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/dev/src/Data/Misc.lua).
- Its [Entwined Realities adapter](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/dev/src/Modules/ModParser.lua)
  applies Medium radius to normal and notable passives. Jewel sockets,
  ascendancies, keystones, masteries, class starts, instilling-only skills and
  constraint-hidden nodes are excluded from disconnected allocation.
- The bundled GGG exports' `keystonesInRadius` entries fit inside 1380 world
  units. They list only one keystone per node, even when circles overlap, so
  they are a cross-check rather than a complete allocation lookup.

Removing an anchor or Entwined Realities revalidates shared and both weapon-set
branches. Ordinary paths can preserve nodes that have an independent connection.

## Derived tooltip values

`src/interaction/passiveEffects.ts` derives tooltip values without changing
upstream data, allocation, IDs or build serialization.

- Allocated Titan Hulking Form scales small main-tree passive magnitudes by
  1.5. Attribute travel nodes, ascendancy skills, notables and keystones are
  excluded. Integer magnitudes truncate; life regeneration percentages retain
  two decimals. Damage ranges scale both endpoints; condition distances and
  additional-projectile counts are unchanged. The adapter handles the stat
  forms present in the bundled exports and needs review when new forms arrive.
- Allocated Smith's Masterwork shows its current +200 Armour bonus per
  allocated adjacent notable, alongside the original rule text.

See the wiki's [Hulking Form mechanics](https://www.poe2wiki.net/wiki/Hulking_Form)
and Path of Building PoE 2's [passive scaling](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/dev/src/Modules/CalcSetup.lua)
and [rounding](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2/blob/dev/src/Classes/ModStore.lua).
These are passive tooltip adjustments; gear effects and character-wide stat
totals remain outside the planner's scope.
