import { Container, Sprite, Texture } from 'pixi.js';
import type { TreeData } from '../data/types';
import { type AtlasBundle, getFrame } from './atlas';

export type MasteryRedraw = (allocated: ReadonlySet<string>) => void;

type MasteryState = 'active' | 'inactive';

interface MasteryEntry {
  sprite: Sprite;
  notableKeys: readonly string[];
  activeTexture: Texture | null;
  inactiveTexture: Texture | null;
  state: MasteryState;
}

const ACTIVE_ATLAS = 'mastery-effect-active';
const INACTIVE_ATLAS = 'mastery-effect-disabled';

/** The pre-rendered active mastery art is noticeably brighter than the rest
 *  of the tree at default opacity. Dim it so the cluster reads as "lit up"
 *  without dominating the surrounding nodes and edges. Inactive uses 1.0. */
const ACTIVE_ALPHA = 0.6;

/**
 * Draws the mastery-pattern background sprites — one per main-tree mastery
 * node, anchored on the mastery's (x, y). Patterns sit BELOW edges and nodes
 * as decorative cluster art, not allocatable sockets.
 *
 * Returns a redraw closure that flips each pattern between its inactive
 * (default) and active variant based on whether any notable directly
 * connected to the mastery (via the edge graph) is allocated. A mastery's
 * `group` field is the orbital cluster it sits in — typically just the
 * mastery itself — not the full visual cluster of notables around it. Those
 * notables live in adjacent groups and are linked back via the mastery's
 * own `in`/`out` edges, which is what we follow.
 */
export function drawMasteries(
  parent: Container,
  atlases: AtlasBundle,
  data: TreeData,
): MasteryRedraw {
  const layer = new Container();
  layer.eventMode = 'none';
  parent.addChild(layer);

  const entries = new Map<string, MasteryEntry>();

  for (const [key, node] of Object.entries(data.nodes)) {
    if (!node.isMastery) continue;
    if (node.x === undefined || node.y === undefined) continue;
    if (node.ascendancyId) continue;
    if (!node.activeEffectImage) continue;

    const inactiveTexture = tryGetFrame(atlases, INACTIVE_ATLAS, `masteryEffectInactive:${node.activeEffectImage}`);
    const activeTexture = tryGetFrame(atlases, ACTIVE_ATLAS, `masteryEffectActive:${node.activeEffectImage}`);
    if (!inactiveTexture && !activeTexture) continue;

    const sprite = new Sprite(inactiveTexture ?? activeTexture ?? Texture.EMPTY);
    sprite.anchor.set(0.5);
    sprite.position.set(node.x, node.y);
    layer.addChild(sprite);

    const notableKeys = [...node.in, ...node.out].filter((k) => data.nodes[k]?.isNotable === true);

    entries.set(key, {
      sprite,
      notableKeys,
      activeTexture,
      inactiveTexture,
      state: 'inactive',
    });
  }

  return (allocated) => {
    for (const entry of entries.values()) {
      const next: MasteryState = entry.notableKeys.some((k) => allocated.has(k)) ? 'active' : 'inactive';
      if (next === entry.state) continue;
      const tex = next === 'active' ? entry.activeTexture : entry.inactiveTexture;
      if (tex) entry.sprite.texture = tex;
      entry.sprite.alpha = next === 'active' ? ACTIVE_ALPHA : 1;
      entry.state = next;
    }
  };
}

function tryGetFrame(atlases: AtlasBundle, atlasName: string, key: string): Texture | null {
  try {
    return getFrame(atlases, atlasName, key);
  } catch {
    return null;
  }
}
