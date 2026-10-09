import { Container, Graphics } from 'pixi.js';
import type { TreeData } from '../../data/types';
import type { PathingContext, MountContext } from './types';
import { MEDIUM_RADIUS } from '../../interaction/pathing';
import { ringRadiusForWrap, destroyChildren } from './nodes';
import { isUnlockConstraintSatisfied } from '../../data/normalize';

/** Jewel radii in world units. The 0.5.0 export doesn't ship per-socket radius
 *  metadata, so we draw all three (Small / Medium / Large) — same values PoE 1
 *  used and the magnitudes that match the distances in `keystonesInRadius`.
 *  Each tier gets its own colour so the player can read which radius covers
 *  which nearby nodes. */
const JEWEL_RADIUS_SMALL = 800;

const JEWEL_RADIUS_MEDIUM = 1200;

const JEWEL_RADIUS_LARGE = 1500;

const JEWEL_RING_SMALL_COLOR = 0x80ffc0;

const JEWEL_RING_MEDIUM_COLOR = 0xa0e0ff;

const JEWEL_RING_LARGE_COLOR = 0xff90b0;

const KEYSTONE_RING_COLOR = 0xffd66a;

/** Bright violet for the constraint-gate / unlocked-node highlight. Chosen to
 *  contrast with the gold allocated-node frames and the cyan search rings, so
 *  the relationship is unambiguous at a glance. */
const UNLOCK_RING_COLOR = 0xc060ff;

const UNLOCK_RING_WIDTH = 5;

const UNLOCK_RING_ALPHA = 0.95;

function addRadiusRing(
  layer: Container,
  centre: { x: number; y: number },
  radius: number,
  color: number,
): void {
  const ring = new Graphics()
    .circle(centre.x, centre.y, radius)
    .stroke({ color, width: 4, alpha: 0.6 });
  ring.eventMode = 'none';
  layer.addChild(ring);
}

/**
 * Draw the radius preview around a hovered jewel socket. When the socket has
 * `keystonesInRadius`, also draw a small ring around each affected keystone
 * so the player sees what would be triggered by socketing a jewel here.
 *
 * Position via `worldContainer.toLocal(wrap.getGlobalPosition())` so the
 * overlay works uniformly for main-tree and ascendancy-overlay nodes.
 * Cleared whenever a non-socket node is hovered (or hover ends).
 */
export function applyJewelOverlay(
  hovered: { nodeKey: string } | null,
  data: TreeData,
  wraps: ReadonlyMap<string, Container>,
  layer: Container,
  worldContainer: Container,
  pathing: PathingContext | null,
): void {
  for (const child of [...layer.children]) child.destroy({ children: true });
  layer.removeChildren();
  if (!hovered) return;
  const node = data.nodes[hovered.nodeKey];
  if (!node) return;
  const wrap = wraps.get(hovered.nodeKey);
  if (!wrap) return;

  // Keystone hover, Entwined Realities allocated → visualise the Medium Radius
  // that defines which non-keystone passives become free-allocatable. Drawn in
  // the same violet as the unlock-highlight rings so it reads as the same
  // mechanic. Works for any keystone (allocated or not) for build planning.
  if (node.isKeystone && pathing?.entwinedActive) {
    const pos = worldContainer.toLocal(wrap.getGlobalPosition());
    const ring = new Graphics()
      .circle(pos.x, pos.y, MEDIUM_RADIUS)
      .stroke({ color: UNLOCK_RING_COLOR, width: 4, alpha: 0.55 });
    ring.eventMode = 'none';
    layer.addChild(ring);
    return;
  }

  if (!node.isJewelSocket) return;

  const pos = worldContainer.toLocal(wrap.getGlobalPosition());

  // Draw Large first so the inner rings paint on top — useful when one
  // tier's stroke happens to overlap a notable/keystone the player is reading.
  addRadiusRing(layer, pos, JEWEL_RADIUS_LARGE, JEWEL_RING_LARGE_COLOR);
  addRadiusRing(layer, pos, JEWEL_RADIUS_MEDIUM, JEWEL_RING_MEDIUM_COLOR);
  addRadiusRing(layer, pos, JEWEL_RADIUS_SMALL, JEWEL_RING_SMALL_COLOR);

  if (!node.keystonesInRadius) return;
  for (const skillId of node.keystonesInRadius) {
    const key = data.nodeBySkillId.get(skillId);
    if (!key) continue;
    const kWrap = wraps.get(key);
    if (!kWrap) continue;
    if (!kWrap.visible) continue; // skip constraint-hidden keystones

    const kPos = worldContainer.toLocal(kWrap.getGlobalPosition());
    const highlight = new Graphics()
      .circle(kPos.x, kPos.y, ringRadiusForWrap(kWrap))
      .stroke({ color: KEYSTONE_RING_COLOR, width: 6, alpha: 0.95 });
    highlight.eventMode = 'none';
    layer.addChild(highlight);
  }
}

/** Paint violet rings around constraint-gate nodes and every node they unlock,
 *  whenever the gate is satisfied. Driven by Druid Oracle's "The Unseen Path"
 *  in 0.5.0 — the notable plus the 200 Forbidden Path nodes it reveals all
 *  get the same ring, making the relationship obvious at a glance.
 *
 *  Idempotent on layer contents: clears and rebuilds every call. Cheap — at
 *  most ~201 single-stroke Graphics in 0.5.0. */
export function applyUnlockHighlight(
  ctx: MountContext,
  data: TreeData,
  allocated: ReadonlySet<string>,
): void {
  const layer = ctx.unlockHighlightLayer;
  const worldContainer = ctx.worldContainer;
  if (!layer || !worldContainer) return;
  destroyChildren(layer);

  const ascendancyId = ctx.pathing?.ascendancyId ?? null;
  if (data.constrainedNodeKeys.size === 0) return;

  const ringKeys = new Set<string>();
  for (const key of data.constrainedNodeKeys) {
    const constraint = data.nodes[key]?.unlockConstraint;
    if (!constraint) continue;
    if (!isUnlockConstraintSatisfied(constraint, ascendancyId, allocated, data)) continue;
    ringKeys.add(key);
    for (const skillId of constraint.nodes) {
      const gateKey = data.nodeBySkillId.get(skillId);
      if (gateKey) ringKeys.add(gateKey);
    }
  }
  if (ringKeys.size === 0) return;

  for (const key of ringKeys) {
    const wrap = ctx.nodeWraps.get(key);
    if (!wrap || !wrap.visible) continue;
    const pos = worldContainer.toLocal(wrap.getGlobalPosition());
    const ring = new Graphics()
      .circle(pos.x, pos.y, ringRadiusForWrap(wrap))
      .stroke({ color: UNLOCK_RING_COLOR, width: UNLOCK_RING_WIDTH, alpha: UNLOCK_RING_ALPHA });
    ring.eventMode = 'none';
    layer.addChild(ring);
  }
}
