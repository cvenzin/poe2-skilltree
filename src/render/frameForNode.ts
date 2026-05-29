import type { TreeNode } from '../data/types';

/** Visual state of a node sprite. Drives which atlas variants are used. */
export type NodeState = 'idle' | 'preview' | 'allocated';

/** Result of {@link spritesForNode}. `null` means "don't draw a sprite of this kind for this node". */
export interface NodeSprites {
  icon: { atlas: 'skills' | 'skills-disabled'; key: string } | null;
  frame: { atlas: 'frame'; key: string } | null;
}

/**
 * Pick the icon + frame atlas keys for a node in the given visual state.
 *
 * Atlas conventions verified against 0.5.0 (see INSTRUCTIONS.md §2):
 * - **Icons** (skills{,-disabled}.json):
 *   `<kind>Inactive:<path>` for idle (in `skills-disabled.json`)
 *   `<kind>Active:<path>`   for preview + allocated (in `skills.json`)
 *   where `<kind>` ∈ {normal, notable, keystone}.
 * - **Frames** (frame.json): per-type triplets ending in `Unallocated /
 *   CanAllocate / Allocated`, except normal small nodes which use the names
 *   `PSSkillFrame / PSSkillFrameHighlighted / PSSkillFrameActive`, and jewel
 *   sockets which use `JewelSocketAltNormal / *CanAllocate / *Active`.
 *
 * PoE only changes the **frame** between preview and allocated — the icon
 * art switches once (idle → bright) and stays bright. The "intense blue"
 * preview look comes from the CanAllocate frame's pre-rendered art.
 */
export function spritesForNode(node: TreeNode, state: NodeState = 'idle'): NodeSprites {
  // Masteries are PoE 1 leftover data — PoE 2 does not have a mastery system
  // (as of 0.5.0). 359 mastery nodes still exist in the export but their
  // `icon` paths aren't packed into any atlas, so they have no usable visual.
  // Hide them entirely; their edges are also filtered out in TreeCanvas.
  if (node.isMastery) return { icon: null, frame: null };

  // The synthetic "root" node + a handful of placeholder nodes carry no icon
  // and no visual identity. Skip them.
  if (!node.icon && !node.isJewelSocket && !node.isAscendancyStart) {
    return { icon: null, frame: null };
  }

  const frameKey = pickFrameKey(node, state);
  const icon = pickIcon(node, state);
  return {
    icon,
    frame: frameKey === null ? null : { atlas: 'frame', key: frameKey },
  };
}

/** Whether a node draws any sprite at all. Mirrors {@link spritesForNode}:
 *  masteries (PoE 1 leftover) and icon-less placeholder/connector nodes (e.g.
 *  the dangling stubs off some ascendancy notables like Acolyte of Chayula's
 *  "Chayula's Gift") render nothing. Edges touching such a node are suppressed
 *  in TreeCanvas so we never draw a connection line into empty space. */
export function nodeHasVisual(node: TreeNode): boolean {
  const { icon, frame } = spritesForNode(node);
  return icon !== null || frame !== null;
}

function pickFrameKey(node: TreeNode, state: NodeState): string | null {
  // Ascendancy start has a single bespoke frame regardless of state.
  if (node.isAscendancyStart) return 'frame:AscendancyStartNode';

  if (node.isJewelSocket) {
    return jewelSocketFrame(state);
  }
  if (node.isKeystone) {
    return suffixedFrame('Keystone', state);
  }
  if (node.isNotable) {
    return node.ascendancyId
      ? suffixedFrame('AscendancyFrameNotable', state)
      : suffixedFrame('Notable', state);
  }
  if (node.ascendancyId) {
    return suffixedFrame('AscendancyFrameNormal', state);
  }
  return normalSmallFrame(state);
}

/** `<prefix>FrameUnallocated/CanAllocate/Allocated`. Keystones use `KeystoneFrame*`,
 *  notables use `NotableFrame*`. Ascendancy variants pass their full base
 *  (e.g. `AscendancyFrameNotable`) which already contains `Frame` in the
 *  middle, so we test `includes` not `endsWith` — otherwise we'd produce
 *  e.g. `AscendancyFrameNotableFrameUnallocated`, which isn't in the atlas
 *  and the frame sprite silently disappears (leaving just the rectangular
 *  icon with no circular border). */
function suffixedFrame(prefix: string, state: NodeState): string {
  const suffixForFrameTypes = { idle: 'Unallocated', preview: 'CanAllocate', allocated: 'Allocated' };
  const base = prefix.includes('Frame') ? prefix : `${prefix}Frame`;
  return `frame:${base}${suffixForFrameTypes[state]}`;
}

/** Normal small nodes don't follow the suffix pattern — they have unique names. */
function normalSmallFrame(state: NodeState): string {
  if (state === 'allocated') return 'frame:PSSkillFrameActive';
  if (state === 'preview') return 'frame:PSSkillFrameHighlighted';
  return 'frame:PSSkillFrame';
}

/** Jewel socket frames use `JewelSocketAltNormal / *CanAllocate / *Active`. */
function jewelSocketFrame(state: NodeState): string {
  if (state === 'allocated') return 'frame:JewelSocketAltActive';
  if (state === 'preview') return 'frame:JewelSocketAltCanAllocate';
  return 'frame:JewelSocketAltNormal';
}

function pickIcon(node: TreeNode, state: NodeState): NodeSprites['icon'] {
  if (!node.icon) return null;
  const kind = pickIconKind(node);
  if (state === 'idle') {
    return { atlas: 'skills-disabled', key: `${kind}Inactive:${node.icon}` };
  }
  // Preview + allocated both use the bright Active icon — only the frame differs.
  return { atlas: 'skills', key: `${kind}Active:${node.icon}` };
}

function pickIconKind(node: TreeNode): 'keystone' | 'notable' | 'normal' {
  if (node.isKeystone) return 'keystone';
  if (node.isNotable) return 'notable';
  return 'normal';
}
