import { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import { palette, controlHeight } from './theme';

/** Threshold for showing a confirmation popover (INSTRUCTIONS.md §9.1).
 *  Below this, reset is one-click — undo still recovers it. */
export const RESET_CONFIRM_THRESHOLD = 10;

/**
 * Reset clears `allocated`, keeping class/ascendancy/version/search. Shows a
 * small inline confirm popover when the user has more than 10 points allocated.
 * Popover open state lives in the store so the `R` hotkey can coordinate
 * (R-while-open confirms; see useKeyboardShortcuts).
 */
export default function ResetButton() {
  const allocated = useStore((s) => s.allocated);
  const open = useStore((s) => s.resetConfirmOpen);
  const setOpen = useStore((s) => s.setResetConfirmOpen);
  const resetAllocation = useStore((s) => s.resetAllocation);

  const popoverRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Dismiss on outside click. `mousedown` so it fires before any internal
  // click would race the close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popoverRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open, setOpen]);

  const onClick = () => {
    if (allocated.size > RESET_CONFIRM_THRESHOLD) {
      setOpen(true);
      return;
    }
    resetAllocation();
  };

  const onConfirm = () => {
    resetAllocation();
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        style={buttonStyle}
        disabled={allocated.size === 0}
        title="Reset allocation (R)"
      >
        Reset
      </button>
      {open && (
        <div ref={popoverRef} style={popoverStyle} role="dialog" aria-modal="false">
          <div style={{ marginBottom: 8 }}>Discard <strong>{allocated.size}</strong> allocated points?</div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setOpen(false)} style={cancelStyle}>Cancel</button>
            <button type="button" onClick={onConfirm} style={confirmStyle} autoFocus>Confirm</button>
          </div>
        </div>
      )}
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: palette.fieldBg,
  color: palette.textPrimary,
  border: `1px solid ${palette.border}`,
  borderRadius: 3,
  height: controlHeight,
  boxSizing: 'border-box',
  padding: '0 12px',
  fontSize: 13,
  cursor: 'pointer',
};

const popoverStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  marginTop: 6,
  left: 0,
  background: palette.panelBgSolid,
  border: `1px solid ${palette.border}`,
  borderRadius: 4,
  padding: 10,
  minWidth: 220,
  fontSize: 13,
  color: palette.textPrimary,
  boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
  zIndex: 20,
};

const cancelStyle: React.CSSProperties = {
  background: 'transparent',
  color: palette.textPrimary,
  border: `1px solid ${palette.border}`,
  borderRadius: 3,
  padding: '3px 10px',
  cursor: 'pointer',
};

const confirmStyle: React.CSSProperties = {
  background: palette.dangerBg,
  color: palette.dangerText,
  border: `1px solid ${palette.dangerBorder}`,
  borderRadius: 3,
  padding: '3px 10px',
  cursor: 'pointer',
};
