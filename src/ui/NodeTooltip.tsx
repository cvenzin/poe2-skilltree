import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { tokenizeStatLine } from '../interaction/statsMarkup';
import { useIsMobile } from './useIsMobile';
import { palette, fontBody, fontDisplay, panelShadow } from './theme';
import type { TreeNode } from '../data/types';

const TOOLTIP_OFFSET = 16;
const VIEWPORT_MARGIN = 8;
const MOBILE_MARGIN = 12;

/**
 * DOM-overlay tooltip anchored near the cursor at the hovered node's client
 * coordinates. v1 keeps positioning simple: absolute placement offset
 * from the cursor. Smart flip/shift (Floating UI) lands when we add nested
 * glossary tooltips (INSTRUCTIONS.md §7.3).
 *
 * Renders `name` + `stats[]` with markup stripped. Flavour/reminder text and
 * the glossary `<Term>` interactivity are later iterations.
 */
export default function NodeTooltip() {
  const hovered = useStore((s) => s.hovered);
  const data = useStore((s) =>
    s.status.kind === 'ready' ? s.status.data : null
  );
  const isMobile = useIsMobile();
  const ref = useRef<HTMLDivElement | null>(null);
  // Desktop only: tentative position is committed by the layout effect once
  // the tooltip's real size is known so the clamp can keep it on-screen.
  // Mobile skips this — the tooltip is CSS-anchored to bottom-left so the
  // finger never covers it.
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!hovered || !ref.current || isMobile) {
      setPosition(null);
      return;
    }
    const rect = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Prefer offset to the lower-right of the cursor, but flip/shift so the
    // tooltip stays inside the viewport on small screens (mobile) and at edges.
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

  if (!hovered || !data) return null;
  const node = data.nodes[hovered.nodeKey];
  if (!node?.name) return null;

  // Mobile: anchor to bottom-left so the finger doesn't cover the tooltip;
  //   the element grows upward via `bottom` and rightward up to maxWidth.
  // Desktop: cursor-following with viewport clamp (see layout effect above);
  //   first paint is hidden off-screen until the clamp commits.
  let style: React.CSSProperties;
  if (isMobile) {
    style = {
      ...containerStyle,
      left: MOBILE_MARGIN,
      bottom: MOBILE_MARGIN,
      maxWidth: `calc(100vw - ${MOBILE_MARGIN * 2}px)`,
      maxHeight: `calc(100vh - ${MOBILE_MARGIN * 2}px)`,
      overflowY: 'auto',
    };
  } else if (position) {
    style = { ...containerStyle, left: position.left, top: position.top };
  } else {
    style = { ...containerStyle, left: -9999, top: -9999, visibility: 'hidden' };
  }

  return (
    <div ref={ref} style={style}>
      <NodeTooltipContents node={node} />
    </div>
  );
}

function NodeTooltipContents({ node }: Readonly<{ node: TreeNode }>) {
  const stats = node.stats ?? [];
  return (
    <>
      <div style={headerStyle}>{node.name}</div>
      {stats.length > 0 && (
        <ul style={statsListStyle}>
          {stats.map((s) => (
            <li key={s} style={statLineStyle}>
              <StatBody text={s} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}


// A single stat string may itself contain `\n`-separated lines and embedded
// `• ` sub-bullets (see Hollow Palm Technique, Runic Meridians, etc.).
// Render plain lines as paragraphs and bullet-prefixed lines as a nested
// list with hanging indent so wrapped text aligns under the text, not the
// bullet character. Each line is tokenized for `<underline>{...}` markup
// (e.g. "Grants Skill: <underline>{Fire Spell on Hit}").
function StatBody({ text }: Readonly<{ text: string }>) {
  const lines = text.split('\n').map((line) => {
    const m = /^•\s*(.*)$/.exec(line);
    // `noUncheckedIndexedAccess` widens m[1] to `string | undefined` even
    // though group 1 (`(.*)`) always captures. Default to the raw line so
    // TS doesn't have to be convinced.
    return m
      ? ({ kind: 'bullet', text: m[1] ?? line } as const)
      : ({ kind: 'text', text: line } as const);
  });
  return (
    <div style={statBodyStyle}>
      {lines.map((line, i) => {
        const key = `${i}:${line.kind}:${line.text}`;
        return line.kind === 'bullet' ? (
          <div key={key} style={subBulletStyle}>
            <span style={subBulletMarkStyle} aria-hidden>•</span>
            <span><StatTokens text={line.text} /></span>
          </div>
        ) : (
          <div key={key}><StatTokens text={line.text} /></div>
        );
      })}
    </div>
  );
}

/** Render a single stat line, wrapping `<underline>{...}` segments in an
 *  underlined span. The tokenizer also strips `[Tag|Display]` markup to
 *  display text, so the consumer doesn't have to pre-strip. */
function StatTokens({ text }: Readonly<{ text: string }>) {
  const tokens = tokenizeStatLine(text);
  return (
    <>
      {tokens.map((tok, i) => {
        const key = `${i}:${tok.kind}`;
        return tok.kind === 'underline'
          ? <span key={key} style={underlineStyle}>{tok.text}</span>
          : <span key={key}>{tok.text}</span>;
      })}
    </>
  );
}

const underlineStyle: React.CSSProperties = {
  textDecoration: 'underline',
  textDecorationColor: palette.rune,
};

// Runic frame: container holds no padding so the header band can span full
// width with its own background. Header and body each pad themselves.
const containerStyle: React.CSSProperties = {
  position: 'fixed',
  pointerEvents: 'none',
  background: palette.panelBg,
  border: `1px solid ${palette.border}`,
  borderRadius: 6,
  overflow: 'hidden',
  color: palette.textPrimary,
  fontFamily: fontBody,
  fontSize: 13,
  lineHeight: 1.45,
  maxWidth: 'min(420px, calc(100vw - 16px))',
  boxShadow: panelShadow,
  zIndex: 100,
};

const headerStyle: React.CSSProperties = {
  textAlign: 'center',
  fontSize: 17,
  fontWeight: 700,
  fontFamily: fontDisplay,
  color: palette.textTitle,
  background: palette.headerBg,
  padding: '8px 14px',
  borderBottom: `1px solid ${palette.border}`,
  letterSpacing: 0.6,
  textShadow: `0 0 8px ${palette.runeGlow}, 0 1px 2px rgba(0, 0, 0, 0.8)`,
};

const statsListStyle: React.CSSProperties = {
  margin: 0,
  padding: '10px 14px',
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

// Each top-level entry gets a left-border accent stripe so adjacent entries
// stay visually distinct even when one entry wraps to multiple lines or
// contains an embedded sub-bullet list. The stripe is the entry boundary.
const statLineStyle: React.CSSProperties = {
  color: palette.textMetal,
  borderLeft: `2px solid ${palette.runeDark}`,
  paddingLeft: 8,
};

const statBodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

// Hanging-indent for sub-bullets: the • lives in a fixed-width gutter while
// the text column wraps. This keeps a wrapped sub-bullet line aligned under
// the text, not under the bullet glyph.
const subBulletStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1em 1fr',
  columnGap: 4,
};

const subBulletMarkStyle: React.CSSProperties = {
  color: palette.rune,
  textAlign: 'center',
};
