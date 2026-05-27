import { useEffect, useRef, useState } from 'react';

const REPO_URL = 'https://github.com/cvenzin/poe2-skilltree';

export default function Attribution() {
  const [showInfo, setShowInfo] = useState(false);
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
          <div style={popoverTitleStyle}>PoE 2 Skill Tree Viewer</div>
          <div style={popoverLineStyle}>
            Created by cvenzin · MIT licensed
          </div>
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
  fontFamily: 'system-ui, sans-serif',
};

const infoButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(20, 16, 10, 0.75)',
  border: '1px solid #6b5a3a',
  borderRadius: '50%',
  color: '#ddd',
  fontSize: 15,
  fontFamily: 'Georgia, serif',
  fontStyle: 'italic',
  fontWeight: 700,
  lineHeight: 1,
  padding: 0,
  cursor: 'pointer',
  opacity: 0.7,
};

const popoverStyle: React.CSSProperties = {
  maxWidth: 280,
  padding: '10px 14px',
  background: 'rgba(8, 6, 10, 0.96)',
  border: '1px solid #6b5a3a',
  borderRadius: 6,
  color: '#ddd',
  fontSize: 12,
  lineHeight: 1.5,
  boxShadow: '0 8px 22px rgba(0, 0, 0, 0.6)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const popoverTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: '#ffffff',
};

const popoverLineStyle: React.CSSProperties = {
  opacity: 0.85,
};

const popoverDisclaimerStyle: React.CSSProperties = {
  opacity: 0.65,
  fontSize: 11,
  borderTop: '1px solid #2a2418',
  paddingTop: 6,
};

const popoverLinkStyle: React.CSSProperties = {
  color: '#d4a44a',
  textDecoration: 'none',
  alignSelf: 'flex-start',
};
