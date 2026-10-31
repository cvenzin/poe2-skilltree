import { Container, Graphics } from 'pixi.js';
import { ringRadiusForWrap } from './nodes';
import type { MountContext } from './types';
import type { TreeData } from '../../data/types';
import type { AppState } from '../../state/store';
import { bucketOf } from '../../state/allocation';
import { proposeNodeEdit } from '../../interaction/nodeActions';

/** A mouse click removes immediately; preview the same validated cascade on hover.
 * Attribute nodes open their editor, so their hover must not imply removal. */
export function removalPreviewKeys(state: AppState, data: TreeData): readonly string[] {
  if (state.pendingRemoval) return state.pendingRemoval.proposal.removed;
  if (state.attributeRemovalPreview && state.attributeEditor?.kind === 'node' &&
    state.attributeEditor.nodeKey === state.attributeRemovalPreview) {
    const proposal = proposeNodeEdit(state.attributeRemovalPreview, data, state);
    return typeof proposal === 'string' || proposal.error ? [] : proposal.removed;
  }
  const hovered = state.hovered;
  if (!hovered || (hovered.inputType !== 'mouse' && hovered.inputType !== 'pen') ||
    data.nodes[hovered.nodeKey]?.isGenericAttribute || bucketOf(state.allocation, hovered.nodeKey) !== state.allocationMode) return [];
  const proposal = proposeNodeEdit(hovered.nodeKey, data, state);
  return typeof proposal === 'string' || proposal.error ? [] : proposal.removed;
}

export function drawRemovalPreview(layer: Graphics, keys: readonly string[], ctx: MountContext, world: Container): void {
  layer.clear();
  const scale = ctx.viewport?.scale.x || 1;
  for (const key of keys) {
    const wrap = ctx.nodeWraps.get(key);
    if (!wrap || !wrap.visible) continue;
    const point = world.toLocal(wrap.getGlobalPosition());
    const radius = Math.max(ringRadiusForWrap(wrap), 12 / scale);
    layer.circle(point.x, point.y, radius).stroke({ color: 0xe27273, width: 2.5 / scale });
  }
}
