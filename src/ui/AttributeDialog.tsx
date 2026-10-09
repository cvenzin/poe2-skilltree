import { useEffect, useId, useRef } from 'react';
import type { TreeData } from '../data/types';
import { useStore, type AttributeEditor } from '../state/store';
import { allAllocated, bucketOf } from '../state/allocation';
import { attributeOptions, attributeRecommendation, type AttributeChoice } from '../state/attributes';

export default function AttributeDialog({ data, editor }: Readonly<{ data: TreeData; editor: AttributeEditor }>) {
  const allocation = useStore((s) => s.allocation);
  const choices = useStore((s) => s.attributeChoices);
  const defaultChoice = useStore((s) => s.defaultAttribute);
  const ascendancyId = useStore((s) => s.ascendancyId);
  const mode = useStore((s) => s.allocationMode);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const options = attributeOptions(data, allocation, ascendancyId);
  const nodeKey = editor.kind === 'node' ? editor.nodeKey : null;
  const selected = nodeKey ? choices[nodeKey] : defaultChoice;
  const unspecified = [...allAllocated(allocation)].filter((key) => data.nodes[key]?.isGenericAttribute && !choices[key]).length;
  const pending = editor.kind === 'default' ? editor.pending : undefined;
  const pendingCount = pending ? [...allAllocated(pending)].filter((key) =>
    data.nodes[key]?.isGenericAttribute && bucketOf(allocation, key) === null).length : 0;
  const editable = nodeKey === null || bucketOf(allocation, nodeKey) === mode;

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const dismiss = () => {
    ref.current?.close();
    useStore.getState().openAttributeEditor(null);
  };
  const choose = (choice: AttributeChoice) => {
    const state = useStore.getState();
    if (nodeKey) {
      state.setNodeAttribute(nodeKey, choice);
      dismiss();
    } else {
      state.setDefaultAttribute(choice);
      if (pending) {
        // Recheck budgets and gates before committing the pending path.
        state.tryAllocate(pending, data);
        dismiss();
      }
    }
  };

  return (
    <dialog className="attribute-dialog" ref={ref} aria-labelledby={titleId} aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); dismiss(); }} onKeyDown={(event) => event.stopPropagation()}>
      <header>
        <h2 id={titleId}>{nodeKey ? 'Choose this node’s bonus' : 'New attribute nodes'}</h2>
        <button type="button" className="attribute-dialog__close" aria-label="Close attribute picker" onClick={dismiss}>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M4 4L16 16M16 4L4 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <p id={descriptionId}>{nodeKey ? 'Change the bonus without removing your path.'
        : pending ? `Choose a default for the ${pendingCount} new attribute ${pendingCount === 1 ? 'node' : 'nodes'} in this path.`
          : 'Your default applies to future allocations. Existing choices stay as they are.'}</p>
      {nodeKey && <p className="attribute-dialog__status">{selected
        ? `Selected: ${options.find((option) => option.choice === selected)?.override.name ?? 'Unspecified'}` : 'Selected: Unspecified'}
        {bucketOf(allocation, nodeKey) === 'shared' ? ' · Shared' : mode === 'set1' ? ' · Weapon Set 1' : ' · Weapon Set 2'}</p>}
      <div className="attribute-dialog__options" aria-label="Node bonus">
        {options.map(({ choice, override }) => (
          <button key={choice} type="button" className={`attribute-dialog__option attribute-dialog__option--${choice}`}
            aria-pressed={selected === choice} disabled={!editable} onClick={() => choose(choice)}>
            <strong>{override.name}</strong>
            <span>{attributeRecommendation(override)}</span>
          </button>
        ))}
      </div>
      {!nodeKey && !pending && unspecified > 0 && (
        <button type="button" className="attribute-dialog__action" disabled={!defaultChoice}
          onClick={() => { useStore.getState().applyDefaultToUnspecified(); dismiss(); }}>
          Apply default to {unspecified} unspecified {unspecified === 1 ? 'node' : 'nodes'}
        </button>
      )}
      {nodeKey && <div className="attribute-dialog__remove">
        <p>Removing this node also removes any passives that depend on its path.</p>
        <button type="button" className="attribute-dialog__action attribute-dialog__danger" disabled={!editable}
          onClick={() => { useStore.getState().removeAttributeNode(nodeKey); dismiss(); }}>Remove node</button>
      </div>}
      <button type="button" className="attribute-dialog__action" onClick={dismiss}>{pending ? 'Cancel path' : 'Done'}</button>
    </dialog>
  );
}
