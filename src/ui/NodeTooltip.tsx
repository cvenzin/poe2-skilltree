import { useStore } from '../state/store';
import { stripStatsMarkup } from '../interaction/statsMarkup';
import type { TreeNode } from '../data/types';

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

  if (!hovered || !data) return null;
  const node = data.nodes[hovered.nodeKey];
  if (!node?.name) return null;

  // Offset the tooltip past the cursor's hot spot so it doesn't immediately
  // overlap the node icon and re-trigger pointerout flicker. The container
  // is `pointer-events: none` so it never intercepts viewport drag/zoom.
  const left = hovered.clientX + 16;
  const top = hovered.clientY + 16;

  return (
    <div style={{ ...containerStyle, left, top }}>
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
              <StatBody text={stripStatsMarkup(s)} />
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
// bullet character.
function StatBody({ text }: Readonly<{ text: string }>) {
  const lines = text.split('\n').map((line) => {
    const m = /^•\s*(.*)$/.exec(line);
    return m
      ? ({ kind: 'bullet', text: m[1] } as const)
      : ({ kind: 'text', text: line } as const);
  });
  return (
    <div style={statBodyStyle}>
      {lines.map((line, i) => {
        const key = `${i}:${line.kind}:${line.text}`;
        return line.kind === 'bullet' ? (
          <div key={key} style={subBulletStyle}>
            <span style={subBulletMarkStyle} aria-hidden>•</span>
            <span>{line.text}</span>
          </div>
        ) : (
          <div key={key}>{line.text}</div>
        );
      })}
    </div>
  );
}

// PoE-style frame: container holds no padding so the header band can span
// full width with its own background. Header and body each pad themselves.
const containerStyle: React.CSSProperties = {
  position: 'fixed',
  pointerEvents: 'none',
  background: 'rgba(8, 6, 10, 0.96)',
  border: '1px solid #6b5a3a',
  borderRadius: 4,
  overflow: 'hidden',
  color: '#c8c8ff',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  lineHeight: 1.45,
  maxWidth: 420,
  boxShadow: '0 8px 22px rgba(0, 0, 0, 0.6)',
  zIndex: 100,
};

const headerStyle: React.CSSProperties = {
  textAlign: 'center',
  fontSize: 16,
  fontWeight: 700,
  color: '#ffffff',
  background: 'rgba(0, 0, 0, 0.55)',
  padding: '8px 14px',
  borderBottom: '1px solid #2a2418',
  letterSpacing: 0.3,
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
  color: '#8787ff',
  borderLeft: '2px solid #4a3f28',
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
  color: '#8787ff',
  textAlign: 'center',
};
