import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { HoveredNode } from '../state/store';
import { palette, fontBody, panelShadow } from './theme';

const TOOLTIP_OFFSET = 16;
const VIEWPORT_MARGIN = 8;
const MOBILE_MARGIN = 12;

/** Keyed by node and layout so the mobile edge stays fixed throughout a hold. */
export default function NodeTooltipFrame({ hovered, isMobile, children }: Readonly<{
  hovered: HoveredNode;
  isMobile: boolean;
  children: ReactNode;
}>) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mobileEdge] = useState(() => hovered.clientY >= window.innerHeight / 2 ? 'top' : 'bottom');
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!ref.current || isMobile) return;
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = hovered.clientX + TOOLTIP_OFFSET;
    let top = hovered.clientY + TOOLTIP_OFFSET;
    if (left + rect.width > vw - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, vw - rect.width - VIEWPORT_MARGIN);
    }
    if (top + rect.height > vh - VIEWPORT_MARGIN) {
      top = Math.max(VIEWPORT_MARGIN, vh - rect.height - VIEWPORT_MARGIN);
    }
    setPosition({ left, top });
  }, [hovered, isMobile]);

  let style: CSSProperties;
  if (isMobile) {
    // Temporary inspection may cover the toolbar; keep the tooltip above it.
    style = {
      ...containerStyle,
      left: '50%',
      transform: 'translateX(-50%)',
      width: 'max-content',
      [mobileEdge]: `max(${MOBILE_MARGIN}px, env(safe-area-inset-${mobileEdge}))`,
      maxWidth: `calc(100vw - ${MOBILE_MARGIN * 2}px)`,
      maxHeight: `calc(45dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))`,
      overflowY: 'auto',
    };
  } else if (position) {
    style = { ...containerStyle, left: position.left, top: position.top };
  } else {
    style = { ...containerStyle, left: -9999, top: -9999, visibility: 'hidden' };
  }

  return <div ref={ref} className="node-tooltip" role="region" aria-label="Node inspection"
    style={{ ...style, pointerEvents: isMobile ? 'auto' : 'none' }} data-mobile-tooltip-edge={isMobile ? mobileEdge : undefined}>
    {children}</div>;
}

// Header and body supply their own padding so the header spans the frame.
const containerStyle: CSSProperties = {
  position: 'fixed',
  pointerEvents: 'none',
  background: palette.panelBg,
  border: `1px solid ${palette.border}`,
  borderRadius: 6,
  overflowY: 'auto',
  maxHeight: 'calc(100dvh - 16px)',
  touchAction: 'pan-y',
  color: palette.textPrimary,
  fontFamily: fontBody,
  fontSize: 'var(--font-node)',
  lineHeight: 1.5,
  overflowWrap: 'anywhere',
  maxWidth: 'min(420px, calc(100vw - 16px))',
  boxShadow: panelShadow,
  zIndex: 100,
};
