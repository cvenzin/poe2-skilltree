import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { palette, fontBody, fontDisplay, panelShadow } from './theme';

const REPO_URL = 'https://github.com/cvenzin/poe2-skilltree';

export default function Attribution() {
  const [showInfo, setShowInfo] = useState(false);
  const activeVersion = useStore((s) => s.activeVersion);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close the popover when the user clicks/taps anywhere else on the page.
  useEffect(() => {
    if (!showInfo) return;
    const onDocPointer = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setShowInfo(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowInfo(false);
    };
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [showInfo]);

  return (
    <div ref={containerRef} style={wrapperStyle}>
      {showInfo && (
        <div style={popoverStyle}>
          <div style={popoverTitleStyle}>PoE 2 Skill Tree</div>
          <div style={popoverLineStyle}>
            Created by cvenzin · MIT licensed
          </div>
          {activeVersion && (
            <div style={popoverLineStyle}>
              Tree data: v{activeVersion}
            </div>
          )}
          <div style={popoverDisclaimerStyle}>
            Path of Exile 2 is a trademark of Grinding Gear Games Ltd.
            This product isn&apos;t affiliated with or endorsed by Grinding
            Gear Games in any way.
          </div>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={popoverLinkStyle}
          >
            Source on GitHub →
          </a>
        </div>
      )}
      <div style={chipRowStyle}>
        {activeVersion && (
          <span style={versionStyle} aria-label={`Tree data version ${activeVersion}`}>
            v{activeVersion}
          </span>
        )}
        <button
          type="button"
          aria-label="About this site"
          aria-expanded={showInfo}
          onClick={() => setShowInfo((v) => !v)}
          style={infoButtonStyle}
        >
          i
        </button>
      </div>
    </div>
  );
}

const wrapperStyle: React.CSSProperties = {
  position: 'fixed',
  right: 12,
  bottom: 12,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 8,
  zIndex: 50,
  pointerEvents: 'auto',
  fontFamily: fontBody,
};

const chipRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const versionStyle: React.CSSProperties = {
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
  color: palette.textMetal,
  background: palette.panelBg,
  border: `1px solid ${palette.border}`,
  borderRadius: 999,
  padding: '3px 8px',
  opacity: 0.85,
  letterSpacing: 0.3,
};

const infoButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: palette.panelBg,
  border: `1px solid ${palette.border}`,
  borderRadius: '50%',
  color: palette.textMetal,
  fontSize: 15,
  fontFamily: 'Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 700,
  lineHeight: 1,
  padding: 0,
  cursor: 'pointer',
  opacity: 0.85,
};

const popoverStyle: React.CSSProperties = {
  maxWidth: 280,
  padding: '10px 14px',
  background: palette.panelBgSolid,
  border: `1px solid ${palette.border}`,
  borderRadius: 6,
  color: palette.textPrimary,
  fontSize: 12,
  lineHeight: 1.5,
  boxShadow: panelShadow,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const popoverTitleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  fontFamily: fontDisplay,
  color: palette.textTitle,
  letterSpacing: 0.5,
  textShadow: `0 0 8px ${palette.runeGlow}`,
};

const popoverLineStyle: React.CSSProperties = {
  opacity: 0.85,
};

const popoverDisclaimerStyle: React.CSSProperties = {
  opacity: 0.65,
  fontSize: 11,
  borderTop: `1px solid ${palette.divider}`,
  paddingTop: 6,
};

const popoverLinkStyle: React.CSSProperties = {
  color: palette.rune,
  textDecoration: 'none',
  alignSelf: 'flex-start',
};
