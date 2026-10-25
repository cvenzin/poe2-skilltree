import { useEffect, useId, useRef, useState } from 'react';
import { useBuildLibrary } from '../state/buildLibrary';

interface Props {
  mode: 'name' | 'duplicate' | 'delete';
  name: string;
  onClose: () => void;
  onConfirm: (name: string) => boolean;
}

export default function BuildNameDialog({ mode, name, onClose, onConfirm }: Readonly<Props>) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [value, setValue] = useState(mode === 'duplicate' ? `${name} (copy)` : name);
  const [failed, setFailed] = useState(false);
  const error = useBuildLibrary((s) => s.error);
  const deleting = mode === 'delete';
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    if (!deleting) dialog?.querySelector('input')?.select();
    return () => dialog?.close();
  }, [deleting]);
  const dismiss = () => { ref.current?.close(); onClose(); };
  return (
    <dialog ref={ref} className="build-name-dialog" aria-labelledby={titleId}
      onCancel={(e) => { e.preventDefault(); dismiss(); }} onKeyDown={(e) => e.stopPropagation()}>
      <form onSubmit={(e) => {
        e.preventDefault();
        if (onConfirm(value)) dismiss(); else setFailed(true);
      }}>
        <h2 id={titleId}>{deleting ? 'Delete saved build?' : mode === 'duplicate' ? 'Duplicate build' : 'Name your build'}</h2>
        {deleting ? <p>Delete “{name}” from this browser? This cannot be undone.</p> :
          <label>Build name<input autoFocus required maxLength={100} value={value}
            onChange={(e) => setValue(e.target.value)} /></label>}
        {failed && <p role="alert">{error ?? 'The build could not be changed. Try again.'}</p>}
        <div className="build-name-dialog__actions">
          <button type="button" autoFocus={deleting} onClick={dismiss}>Cancel</button>
          <button type="submit" disabled={!deleting && !value.trim()}>{deleting ? 'Delete build' : 'Save build'}</button>
        </div>
      </form>
    </dialog>
  );
}
