import { useEffect } from 'react';
import { useStore } from '../state/store';
import { palette, fontBody } from './theme';

const DISMISS_MS = 3200;

/**
 * Transient banner for blocked actions — e.g. a passive-point or weapon-set
 * cap reached. The message is set in the store (see `tryAllocate`); this
 * renders it centred at the top and auto-dismisses after a few seconds. A new
 * message resets the timer.
 */
export default function ValidationToast() {
  const message = useStore((s) => s.validationMessage);
  const setValidationMessage = useStore((s) => s.setValidationMessage);

  useEffect(() => {
    if (!message) return;
    const timer = globalThis.setTimeout(() => setValidationMessage(null), DISMISS_MS);
    return () => globalThis.clearTimeout(timer);
  }, [message, setValidationMessage]);

  if (!message) return null;

  return (
    <output style={toastStyle} aria-live="assertive">
      {message}
    </output>
  );
}

const toastStyle: React.CSSProperties = {
  position: 'fixed',
  top: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  maxWidth: 'min(520px, calc(100vw - 32px))',
  boxSizing: 'border-box',
  padding: '8px 16px',
  background: palette.dangerBg,
  border: `1px solid ${palette.dangerBorder}`,
  borderRadius: 6,
  color: palette.dangerText,
  fontFamily: fontBody,
  fontSize: 13,
  textAlign: 'center',
  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.55)',
  zIndex: 130,
  pointerEvents: 'none',
};
