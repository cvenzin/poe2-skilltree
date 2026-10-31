import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { bucketOf } from '../state/allocation';
import { proposeNodeEdit, modeName } from '../interaction/nodeActions';
import type { TreeData } from '../data/types';
import { nodePanelTheme } from './theme';

/** Full, scrollable details and actions are explicit keyboard/search inspection,
 * separate from the ordinary pointer tooltip. Native dialog manages focus. */
export default function KeyboardNodeInspector({ nodeKey, data, children }: Readonly<{
  nodeKey: string; data: TreeData; children: ReactNode;
}>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const state = useStore();
  const proposal = proposeNodeEdit(nodeKey, data, state);
  const error = typeof proposal === 'string' ? proposal : proposal.error;
  const allocated = bucketOf(state.allocation, nodeKey) !== null;
  const attribute = allocated && data.nodes[nodeKey]?.isGenericAttribute;
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const dismiss = () => { ref.current?.close(); useStore.getState().dismissInspection(); };
  return <dialog ref={ref} className="keyboard-node-inspector" style={nodePanelTheme}
    aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); dismiss(); }}
    onKeyDown={(e) => e.stopPropagation()}>
    <h2 id={titleId} className="visually-hidden">{data.nodes[nodeKey]?.name}</h2>
    {children}
    <div className="keyboard-node-actions">
      {state.weaponSetsEnabled && <p>Editing: {modeName[state.allocationMode]}</p>}
      {error && <p role="status">{error}</p>}
      <button type="button" onClick={dismiss}>Close</button>
      {!error && <button type="button" onClick={() => {
        const live = useStore.getState();
        if (live.hovered?.nodeKey !== nodeKey || live.status.kind !== 'ready' || live.status.data !== data) return;
        ref.current?.close();
        if (attribute) live.openAttributeEditor({ kind: 'node', nodeKey });
        else if (allocated) live.requestRemoval(nodeKey, data);
        else live.requestNodeAllocation(nodeKey, data);
      }}>{attribute ? 'Edit attribute' : allocated ? 'Remove node' : 'Allocate path'}</button>}
    </div>
  </dialog>;
}
