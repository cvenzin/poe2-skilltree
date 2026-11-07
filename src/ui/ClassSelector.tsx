import { useId, useRef, useState } from 'react';
import type { ClassEntry } from '../data/types';
import { isEmptyAllocation, type Allocation } from '../state/allocation';
import { useStore } from '../state/store';

export default function ClassSelector({ className, playableClasses }: Readonly<{
  className: string | null;
  playableClasses: readonly ClassEntry[];
}>) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const description = useId();
  const [pending, setPending] = useState<{ name: string; source: Allocation } | null>(null);

  const request = (name: string) => {
    const state = useStore.getState();
    if (name === state.className) return;
    if (isEmptyAllocation(state.allocation)) {
      state.setClass(name);
      return;
    }
    setPending({ name, source: state.allocation });
    dialog.current?.showModal();
  };

  const confirm = () => {
    const state = useStore.getState();
    if (pending && pending.source === state.allocation) state.setClass(pending.name);
    dialog.current?.close();
  };

  return <>
    <label className="toolbar-field">
      <span>Class</span>
      <select value={className ?? ''} onChange={(e) => request(e.target.value)}>
        {playableClasses.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
      </select>
    </label>
    <dialog ref={dialog} className="build-name-dialog" role="alertdialog" aria-labelledby={title}
      aria-describedby={description} onClose={() => setPending(null)} onKeyDown={(e) => e.stopPropagation()}>
      <h2 id={title}>Change class to {pending?.name}?</h2>
      <p id={description}>This clears all allocations in the current build and cannot be undone.</p>
      <div className="build-name-dialog__actions">
        <button type="button" autoFocus onClick={() => dialog.current?.close()}>Cancel</button>
        <button type="button" className="build-library__delete" onClick={confirm}>Change class</button>
      </div>
    </dialog>
  </>;
}
