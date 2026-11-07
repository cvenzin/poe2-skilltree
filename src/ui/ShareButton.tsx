import { useState } from 'react';
import { useStore } from '../state/store';
import { shareCurrentBuild } from '../state/buildActions';
import { palette, controlHeight } from './theme';

const TOAST_MS = 1500;

/** Copies a snapshot of the current build to the clipboard. */
export default function ShareButton() {
  const className = useStore((s) => s.className);

  const [toast, setToast] = useState<'idle' | 'copied' | 'failed'>('idle');

  const onClick = async () => {
    const url = shareCurrentBuild();
    if (!url) return;

    try {
      await globalThis.navigator.clipboard.writeText(url);
      setToast('copied');
    } catch {
      setToast('failed');
    }
    globalThis.setTimeout(() => setToast('idle'), TOAST_MS);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        onClick={() => { void onClick(); }}
        style={buttonStyle}
        disabled={!className}
        title="Copy a shareable URL of this build"
      >
        Share
      </button>
      {toast !== 'idle' && (
        <output style={toast === 'copied' ? toastSuccessStyle : toastErrorStyle}>
          {toast === 'copied' ? 'Copied!' : 'Clipboard blocked'}
        </output>
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
  borderRadius: 5,
  minHeight: controlHeight,
  boxSizing: 'border-box',
  padding: '6px 12px',
  fontSize: 'var(--font-ui)',
  cursor: 'pointer',
};

const toastBaseStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 'calc(100% + 6px)',
  left: 0,
  whiteSpace: 'nowrap',
  fontSize: 'var(--font-meta)',
  padding: '3px 8px',
  borderRadius: 5,
  pointerEvents: 'none',
};

const toastSuccessStyle: React.CSSProperties = {
  ...toastBaseStyle,
  background: palette.successBg,
  color: palette.successText,
  border: `1px solid ${palette.successBorder}`,
};

const toastErrorStyle: React.CSSProperties = {
  ...toastBaseStyle,
  background: palette.dangerBg,
  color: palette.dangerText,
  border: `1px solid ${palette.dangerBorder}`,
};
