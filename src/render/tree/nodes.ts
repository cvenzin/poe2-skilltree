import type { TreeData, TreeNode } from '../../data/types';
import { getFrame } from '../atlas';
import type { AtlasBundle } from '../atlas';
import { Container, Rectangle, Graphics, Sprite } from 'pixi.js';
import { spritesForNode } from '../frameForNode';
import type { NodeState } from '../frameForNode';
import type { ClusterInfo } from './geometry';
import type { MountContext } from './types';
import { attachNodeInteraction } from './nodeInteraction';
import { attributeNode, type AttributeChoices, type AttributeChoice } from '../../state/attributes';

/**
 * For each registered wrap, compute its desired visual state from the store
 * (allocated > preview > idle) and rebuild its sprite contents with the
 * appropriate atlas variant — but only when the state actually changed.
 *
 * Texture swapping (not tinting) is what gives PoE's correct look: the
 * allocated frames are pre-rendered bright gold, the can-allocate frames
 * are pre-rendered intense blue, the idle frames are dim. The change is
 * lightweight in practice — only the path nodes near the cursor flip on
 * hover, ~10-30 rebuilds at most.
 */
export function applyNodeStates(
  data: TreeData,
  atlases: AtlasBundle,
  wraps: ReadonlyMap<string, Container>,
  prevStates: Map<string, string>,
  allocated: ReadonlySet<string>,
  previewPath: readonly string[] | null,
  choices: AttributeChoices = {},
  defaultChoice: AttributeChoice | null = null,
): void {
  const previewSet = previewPath ? new Set(previewPath) : null;
  for (const [key, wrap] of wraps) {
    const next = computeNodeState(key, allocated, previewSet);
    const original = data.nodes[key];
    if (!original) continue;
    const node = attributeNode(original, choices[key] ?? (next === 'preview' ? defaultChoice ?? undefined : undefined), data);
    const visualKey = `${next}:${node.icon ?? ''}`;
    if (prevStates.get(key) === visualKey) continue;
    rebuildSpriteContents(wrap, node, atlases, next);
    prevStates.set(key, visualKey);
  }
}

function computeNodeState(
  key: string,
  allocated: ReadonlySet<string>,
  preview: ReadonlySet<string> | null
): NodeState {
  if (allocated.has(key)) return 'allocated';
  if (preview?.has(key)) return 'preview';
  return 'idle';
}

/** Distance from a node's centre to where its cyan search-match ring should
 *  sit. Uses the wrap's local bounds (frame + icon) and adds a fixed visible
 *  gap so the ring clears the frame ornaments. */
const SEARCH_RING_GAP = 10;

export function ringRadiusForWrap(wrap: Container): number {
  const b = wrap.getLocalBounds();
  // Half-diagonal of the bbox approximates the worst-case node radius —
  // works whether the frame is square (normal) or wider (notable/keystone).
  const halfMax = Math.max(b.width, b.height) / 2;
  return halfMax + SEARCH_RING_GAP;
}

/** Scale applied to the wrap currently under the cursor (the hover target).
 *  Subtle enough to read as "this is the click target"
 *  without making nearby nodes look misplaced. */
const HOVER_TARGET_SCALE = 1.08;

/** Toggle the 1.08× scale-up on the hovered wrap. Resets the previously
 *  hovered wrap back to 1.0 so we don't leave stale-scaled nodes behind.
 *  Returns the new "currently scaled" wrap (or null if no node is hovered).
 *  Snap (not tweened) for v1 — animating would need ticker bookkeeping. */
export function applyHoverScale(
  wraps: ReadonlyMap<string, Container>,
  prevScaled: Container | null,
  nextKey: string | null,
): Container | null {
  if (prevScaled && !prevScaled.destroyed) prevScaled.scale.set(1);
  if (!nextKey) return null;
  const wrap = wraps.get(nextKey);
  if (!wrap || wrap.destroyed) return null;
  wrap.scale.set(HOVER_TARGET_SCALE);
  return wrap;
}

function rebuildSpriteContents(
  wrap: Container,
  node: TreeNode,
  atlases: AtlasBundle,
  state: NodeState
): void {
  destroyChildren(wrap);
  const sprites = spritesForNode(node, state);
  if (sprites.icon) addSprite(wrap, atlases, sprites.icon.atlas, sprites.icon.key, placeholderDot());
  if (sprites.frame) addSprite(wrap, atlases, sprites.frame.atlas, sprites.frame.key, null);
}

export function destroyChildren(layer: Container | null): void {
  if (!layer) return;
  for (const child of [...layer.children]) child.destroy({ children: true });
  layer.removeChildren();
}

export function drawOverlayNodes(
  overlay: Container,
  atlases: AtlasBundle,
  data: TreeData,
  cluster: ClusterInfo,
  ctx: MountContext,
): void {
  for (const entry of cluster.nodes) {
    const wrap = buildNodeSprite(entry.node, atlases);
    if (!wrap) continue;
    wrap.position.set(entry.x - cluster.cx, entry.y - cluster.cy);
    attachNodeInteraction(wrap, entry.key, data, ctx);
    ctx.nodeWraps.set(entry.key, wrap);
    ctx.ascendancyNodeKeys.add(entry.key);
    overlay.addChild(wrap);
  }
}

/** Main-tree nodes only. Ascendancy nodes are drawn by {@link drawAscendancyOverlay}. */
export function drawNodes(
  parent: Container,
  atlases: AtlasBundle,
  data: TreeData,
  ctx: MountContext,
): number {
  const layer = new Container();
  parent.addChild(layer);
  let drawn = 0;
  for (const [key, node] of Object.entries(data.nodes)) {
    if (key === 'root') continue;
    if (node.x === undefined || node.y === undefined) continue;
    if (node.ascendancyId) continue; // main tree only

    const wrap = buildNodeSprite(node, atlases);
    if (!wrap) continue;
    wrap.position.set(node.x, node.y);
    attachNodeInteraction(wrap, key, data, ctx);
    ctx.nodeWraps.set(key, wrap);
    if (node.unlockConstraint) ctx.constrainedWraps.add(key);
    layer.addChild(wrap);
    drawn++;
  }
  return drawn;
}

function buildNodeSprite(node: import('../../data/types').TreeNode, atlases: AtlasBundle): Container | null {
  const sprites = spritesForNode(node);
  const wrap = new Container();

  // Z-order: icon (square 34×34 art) goes UNDER the frame ring so the frame
  // masks the icon's square corners. Reversed = icon corners stick out and
  // the node looks like a rectangle. Each texture already encodes design-time
  // size via its `orig` rect (atlas loader applies `meta.scale`), so no extra
  // scale is needed here.
  if (sprites.icon) addSprite(wrap, atlases, sprites.icon.atlas, sprites.icon.key, placeholderDot());
  if (sprites.frame) addSprite(wrap, atlases, sprites.frame.atlas, sprites.frame.key, null);

  if (wrap.children.length === 0) return null;

  // Pin a stable hit area at idle-state size. Without this, swapping textures
  // on state change (via `wrap.removeChildren()` + re-add) briefly empties
  // the auto-computed bounds and Pixi fires pointerout → flicker loop.
  // The Allocated and CanAllocate variants are the same dimensions as the
  // Unallocated ones, so this rect stays correct across state swaps.
  const b = wrap.getLocalBounds();
  wrap.hitArea = new Rectangle(b.x, b.y, b.width, b.height);

  return wrap;
}

function addSprite(
  parent: Container,
  atlases: AtlasBundle,
  atlasName: string,
  frameKey: string,
  fallback: Graphics | null
): void {
  try {
    const tex = getFrame(atlases, atlasName, frameKey);
    fallback?.destroy();
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    parent.addChild(s);
  } catch {
    if (fallback) parent.addChild(fallback);
  }
}

function placeholderDot(): Graphics {
  return new Graphics().circle(0, 0, 12).fill({ color: 0x666666 });
}
