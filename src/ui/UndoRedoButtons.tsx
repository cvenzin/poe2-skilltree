import { useStore } from '../state/store';

/** Undo/redo pair — buttons disable when the corresponding stack is empty so
 *  the user gets a visual cue. Hotkeys (Ctrl/Cmd+Z, Ctrl/Cmd+Y) live in
 *  {@link useKeyboardShortcuts}. */
export default function UndoRedoButtons() {
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);

  return (
    <div style={{ display: 'inline-flex', gap: 2 }}>
      <button
        type="button"
        onClick={undo}
        disabled={past.length === 0}
        style={{ ...buttonStyle, ...(past.length === 0 ? disabledStyle : null) }}
        title="Undo (Ctrl/Cmd+Z)"
        aria-label="Undo"
      >
        ↶
      </button>
      <button
        type="button"
        onClick={redo}
        disabled={future.length === 0}
        style={{ ...buttonStyle, ...(future.length === 0 ? disabledStyle : null) }}
        title="Redo (Ctrl/Cmd+Y or Ctrl/Cmd+Shift+Z)"
        aria-label="Redo"
      >
        ↷
      </button>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  background: '#1c1812',
  color: '#ddd',
  border: '1px solid #4a3f28',
  borderRadius: 3,
  padding: '3px 8px',
  fontSize: 16,
  lineHeight: 1,
  cursor: 'pointer',
  minWidth: 28,
};

const disabledStyle: React.CSSProperties = {
  opacity: 0.35,
  cursor: 'not-allowed',
};
