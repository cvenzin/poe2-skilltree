import { useEffect, useState } from 'react';
import { fontBody, palette } from './theme';

const displayFace = 'OptimusPrincepsSemiBold';
const displayFont = `700 30px ${displayFace}`;

/** Show feedback for slower loads without holding back a ready tree. */
export default function LoadingScreen({ version }: Readonly<{ version: string | null }>) {
  const [titleFont, setTitleFont] = useState<string | null>(null);

  useEffect(() => {
    // Start the font while the loader is hidden. Pick one face at reveal time
    // and keep it for this load; a slow/failed download must never swap it.
    void document.fonts.load(displayFont).catch(() => { /* use the system face */ });
    const timer = globalThis.setTimeout(() => {
      setTitleFont(document.fonts.check(displayFont) ? displayFace : fontBody);
    }, 300);
    return () => globalThis.clearTimeout(timer);
  }, []);

  return (
    <div style={overlayStyle}>
      {titleFont && (
        <div role="status" style={{ textAlign: 'center' }}>
          <h1 style={{ ...titleStyle, fontFamily: titleFont }}>PoE 2 Skill Tree</h1>
          <p className="loading-subtitle" style={{ marginTop: '0.6rem' }}>
            {version ? `Loading skill tree ${version}…` : 'Initialising…'}
          </p>
        </div>
      )}
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  padding: 16,
  fontFamily: fontBody,
  color: palette.textPrimary,
  background: palette.panelBgSolid,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontWeight: 700,
  fontSize: 30,
  letterSpacing: 1,
  color: palette.textTitle,
  textShadow: `0 0 12px ${palette.runeGlow}, 0 1px 2px rgba(0, 0, 0, 0.8)`,
};
