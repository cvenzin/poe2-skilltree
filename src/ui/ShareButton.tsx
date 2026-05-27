import { useState } from 'react';
import { useStore } from '../state/store';
import type { TreeData } from '../data/types';
import { encodeShareHash } from '../state/shareHash';

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
  const passiveCap = useStore((s) => s.passiveCap);
  const ascendancyCap = useStore((s) => s.ascendancyCap);
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
      passiveCap,
      ascendancyCap,
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
  background: '#1c1812',
  color: '#ddd',
  border: '1px solid #4a3f28',
  borderRadius: 3,
  padding: '4px 10px',
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
  background: '#1a3a1a',
  color: '#9eea9e',
  border: '1px solid #3a6a3a',
};

const toastErrorStyle: React.CSSProperties = {
  ...toastBaseStyle,
  background: '#3a1a1a',
  color: '#eea9a9',
  border: '1px solid #6a3a3a',
};
