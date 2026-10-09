import { Container, TilingSprite, Sprite } from 'pixi.js';
import { getFrame } from '../atlas';
import type { AtlasBundle } from '../atlas';
import type { WorldSize } from './types';
import type { TreeData } from '../../data/types';
import { computeClassStartRingRadius, computeActiveDiscRotation } from './geometry';

export function drawBackground(parent: Container, atlases: AtlasBundle, world: WorldSize): void {
  const tex = getFrame(atlases, 'background', 'background:Background2');
  const bg = new TilingSprite({ texture: tex, width: world.width, height: world.height });
  // Parent shifts (-minX, -minY); cancel that so the tile origin aligns with
  // the actual world origin.
  bg.position.set(world.minX, world.minY);
  // Pure decoration — never intercept clicks meant for nodes / edges above it.
  bg.eventMode = 'none';
  parent.addChild(bg);
}

/**
 * Renders the central class/ascendancy backdrop disc at world origin. Drawn
 * as an early layer so main-tree passives that sit over the disc area aren't
 * occluded by it.
 *
 * Frame layout in each `background-<class>` atlas (verified empirically):
 *   `Class0`              → default class image (no ascendancy chosen)
 *   `Class<asc index +1>` → ascendancy-specific image
 *
 * Witch is the only class with 4 ascendancies (Abyssal Lich is a Witch3b
 * variant) but still has only 4 frames — so the 4th ascendancy falls back to
 * the default class image. The try/catch handles both that case and any
 * other missing-frame oddities.
 */
/** Disc art is sized to the class-start ring diameter — class-start nodes
 *  sit at its outer edge. */
const DISC_TO_RING_RATIO = 1;

/** Frame slightly overshoots the ring so its ornate ornaments wrap *around*
 *  the class-start nodes instead of sitting inside the disc edge. */
const FRAME_TO_RING_RATIO = 1.36;

export function drawCentralBackdrop(
  parent: Container,
  atlases: AtlasBundle,
  data: TreeData,
  className: string,
  ascendancyId: string | null
): void {
  const cls = data.classes.find((c) => c.name === className);
  if (!cls) return;
  const atlasName = `background-${cls.name.toLowerCase()}`;
  const frameKey = pickBackdropFrameKey(cls, ascendancyId);

  const tex = tryGetFrame(atlases, atlasName, frameKey)
    ?? tryGetFrame(atlases, atlasName, `class${cls.name}:Class0`); // fallback to default
  if (!tex) return;

  const size = computeClassStartRingRadius(data) * 2 * DISC_TO_RING_RATIO;
  const bg = new Sprite(tex);
  bg.anchor.set(0.5);
  bg.position.set(0, 0);
  bg.width = size;
  bg.height = size;
  // Decoration only — must not absorb clicks meant for the class-start
  // nodes that sit on this disc's outer edge.
  bg.eventMode = 'none';
  parent.addChild(bg);
}

function pickBackdropFrameKey(
  cls: import('../../data/types').ClassEntry,
  ascendancyId: string | null
): string {
  const base = `class${cls.name}`;
  if (!ascendancyId) return `${base}:Class0`;
  const ascIdx = cls.ascendancies.findIndex((a) => a.id === ascendancyId);
  // `+ 1` because Class0 is the default class image; ascendancies start at Class1.
  return ascIdx >= 0 ? `${base}:Class${ascIdx + 1}` : `${base}:Class0`;
}

function tryGetFrame(atlases: AtlasBundle, atlasName: string, frameKey: string) {
  try { return getFrame(atlases, atlasName, frameKey); }
  catch { return null; }
}

/** Decorative ring around the central class/ascendancy area. Sized to match
 *  the class disc texture so the frame and disc art read as a single unit.
 *
 *  In-game this is two stacked layers: `MainCircle` is the base ring,
 *  `MainCircleActive` is a glow/highlight overlay rendered on top. Both are
 *  always visible regardless of whether an ascendancy is picked. */
export function drawMainCircle(
  parent: Container,
  atlases: AtlasBundle,
  data: TreeData,
  className: string
): void {
  // Frame slightly overshoots the disc so its ornaments wrap around the
  // class-start nodes from outside. Knob: `FRAME_TO_RING_RATIO` above.
  // Layer order (back → front): disc backdrop (drawn by caller) → Active
  // overlay → Normal frame on top. The Active is a glow/highlight that
  // sits underneath the gold ornamental ring.
  //
  // The Active highlight is baked into the texture at the Witch's position
  // (top of the ring). Rotate it so it lines up with the selected class's
  // start node instead. The Normal frame is rotationally symmetric.
  const size = computeClassStartRingRadius(data) * 2 * FRAME_TO_RING_RATIO;
  addRingSprite(parent, atlases, 'startNode:MainCircleActive', size, computeActiveDiscRotation(data, className));
  addRingSprite(parent, atlases, 'startNode:MainCircle', size, 0);
}

function addRingSprite(
  parent: Container,
  atlases: AtlasBundle,
  frameKey: string,
  width: number,
  rotation: number
): void {
  const tex = tryGetFrame(atlases, 'group-background', frameKey);
  if (!tex) return;
  const sprite = new Sprite(tex);
  sprite.anchor.set(0.5);
  sprite.position.set(0, 0);
  sprite.width = width;
  sprite.height = width;
  sprite.rotation = rotation;
  // MainCircle and MainCircleActive are drawn above the nodes layer so their
  // ornamental ring isn't occluded by class-start node frames. Mark them
  // non-interactive so they don't absorb clicks on nodes underneath.
  sprite.eventMode = 'none';
  parent.addChild(sprite);
}
