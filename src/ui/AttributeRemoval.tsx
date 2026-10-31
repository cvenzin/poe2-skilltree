import { useEffect, useMemo, useRef } from 'react';
import type { TreeData } from '../data/types';
import { useStore } from '../state/store';
import { proposeNodeEdit, removalImpact } from '../interaction/nodeActions';

/** Keep cascade review at the removal button, inside the existing bonus editor. */
export default function AttributeRemoval({ nodeKey, data, editable }: Readonly<{
  nodeKey: string; data: TreeData; editable: boolean;
}>) {
  const state = useStore();
  const { allocation, allocationMode, className, ascendancyId } = state;
  const review = state.pendingRemoval?.key === nodeKey ? state.pendingRemoval : null;
  const proposal = useMemo(() => proposeNodeEdit(nodeKey, data, { allocation, allocationMode, className, ascendancyId }),
    [nodeKey, data, allocation, allocationMode, className, ascendancyId]);
  const error = typeof proposal === 'string' ? proposal : proposal.error;
  const button = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const hovering = useRef(false);
  const wasReview = useRef(false);
  useEffect(() => {
    hovering.current = false;
    if (review) cancel.current?.focus();
    else if (wasReview.current) button.current?.focus();
    wasReview.current = !!review;
  }, [review]);
  useEffect(() => () => useStore.getState().setAttributeRemovalPreview(null), []);

  return <div className="attribute-dialog__remove">
    {review ? <>
      <p role="status" id="attribute-removal-impact">
        <strong>Remove {review.proposal.removed.length} nodes?</strong>{' '}
        {removalImpact(review.source, review.proposal.next, data, review.ascendancyId)}.
      </p>
      <div className="attribute-dialog__remove-actions">
        <button ref={cancel} type="button" className="attribute-dialog__action"
          onClick={() => { const live = useStore.getState(); if (live.pendingRemoval === review) live.cancelRemoval(); }}>Cancel</button>
        <button type="button" className="attribute-dialog__action attribute-dialog__danger" aria-describedby="attribute-removal-impact"
          onClick={() => { const live = useStore.getState(); if (live.pendingRemoval === review) live.confirmRemoval(); }}>Remove</button>
      </div>
    </> : <>
      <p>Removing this node also removes any passives that depend on its path.</p>
      {error && <p role="status">{error}</p>}
      <button ref={button} type="button" className="attribute-dialog__action attribute-dialog__danger" disabled={!editable || !!error}
        onPointerEnter={() => { hovering.current = true; useStore.getState().setAttributeRemovalPreview(nodeKey); }}
        onPointerLeave={(event) => {
          hovering.current = false;
          if (document.activeElement !== event.currentTarget) useStore.getState().setAttributeRemovalPreview(null);
        }}
        onFocus={() => useStore.getState().setAttributeRemovalPreview(nodeKey)}
        onBlur={() => { if (!hovering.current) useStore.getState().setAttributeRemovalPreview(null); }}
        onClick={() => {
          const live = useStore.getState();
          if (live.attributeEditor?.kind === 'node' && live.attributeEditor.nodeKey === nodeKey) live.removeAttributeNode(nodeKey);
        }}>Remove node</button>
    </>}
  </div>;
}
