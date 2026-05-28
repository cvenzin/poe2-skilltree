import { useState } from 'react';
import { useStore } from '../state/store';
import type { TreeData } from '../data/types';
import { encodeShareHash } from '../state/shareHash';
import { palette, controlHeight } from './theme';

const TOAST_MS = 1500;

interface ShareButtonProps {
  data: TreeData;
}

/**
 * Serialises the current build into the URL share-hash format (§10.4),
 * writes it to `location.hash`, and copies the full URL to clipboard.
 * Shows a brief "Copied!" pill next to the button on success.
 *
 * Writing to `location.hash` triggers `hashchange`; the listener in App
 * decodes and applies — for the same build that produced the hash, this
 * is a no-op (state already matches), so the round-trip is safe.
 */
export default function ShareButton({ data }: Readonly<ShareButtonProps>) {
  const className = useStore((s) => s.className);
  const ascendancyId = useStore((s) => s.ascendancyId);
  const allocated = useStore((s) => s.allocated);
  const activeVersion = useStore((s) => s.activeVersion);

  const [toast, setToast] = useState<'idle' | 'copied' | 'failed'>('idle');

  const onClick = async () => {
    if (!activeVersion || !className) return;

    const classIdx = data.classes.findIndex((c) => c.name === className);
    if (classIdx < 0) return;
    const ascendancyIdx = ascendancyId
      ? (data.classes[classIdx]?.ascendancies.findIndex((a) => a.id === ascendancyId) ?? -1)
      : -1;

    const hash = encodeShareHash({
      version: activeVersion,
      classIdx,
      ascendancyIdx,
      allocatedKeys: [...allocated],
    });

    // Update the URL without history pollution. `replaceState` doesn't fire
    // `hashchange`, but that's fine — the store state already matches what
    // we just encoded, so there's nothing for the listener to reconcile.
    const url = `${globalThis.location.pathname}${globalThis.location.search}${hash}`;
    globalThis.history.replaceState(null, '', url);

    try {
      await globalThis.navigator.clipboard.writeText(globalThis.location.href);
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
        onClick={onClick}
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
  borderRadius: 3,
  height: controlHeight,
  boxSizing: 'border-box',
  padding: '0 12px',
  fontSize: 13,
  cursor: 'pointer',
};

const toastBaseStyle: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 6px)',
  right: 0,
  whiteSpace: 'nowrap',
  fontSize: 11,
  padding: '3px 8px',
  borderRadius: 3,
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
