import { useState } from 'react';
import { useStore, countBudgets, PASSIVE_CAP, ASCENDANCY_CAP } from '../state/store';
import type { TreeData } from '../data/types';
import { VERSIONS } from '../data/versions';
import BudgetChip from './BudgetChip';
import UndoRedoButtons from './UndoRedoButtons';
import ResetButton from './ResetButton';
import SearchInput from './SearchInput';
import ShareButton from './ShareButton';
import { useIsMobile } from './useIsMobile';
import { palette, fontBody, fontDisplay, controlHeight } from './theme';

/**
 * Top-left toolbar (INSTRUCTIONS.md §10):
 *   - Class dropdown (filters out PoE 1 placeholder classes, §2)
 *   - Ascendancy dropdown (filtered to playable ascendancies of the active class)
 *   - Passive budget chip (N / 123, editable cap)
 *   - Ascendancy budget chip (N / 8, only when an ascendancy is picked)
 *   - Undo / Redo
 *   - Reset (with confirm popover when allocated > 10, §9.1)
 *
 * Version dropdown, share button, and search input belong to later sub-phases.
 */
interface ToolbarProps {
  data: TreeData;
}

export default function Toolbar({ data }: Readonly<ToolbarProps>) {
  const className = useStore((s) => s.className);
  const ascendancyId = useStore((s) => s.ascendancyId);
  const allocated = useStore((s) => s.allocated);
  const activeVersion = useStore((s) => s.activeVersion);
  const setClass = useStore((s) => s.setClass);
  const setAscendancy = useStore((s) => s.setAscendancy);
  const setActiveVersion = useStore((s) => s.setActiveVersion);

  const isMobile = useIsMobile();
  // Mobile-only collapse state. Desktop ignores this entirely and always
  // renders the full toolbar. Defaults to collapsed because the toolbar
  // wraps to 3-4 rows on phones and obscures too much of the canvas.
  const [mobileExpanded, setMobileExpanded] = useState(false);

  const playableClasses = data.playableClassIndices
    .map((i) => data.classes[i])
    .filter((c): c is NonNullable<typeof c> => c !== undefined);
  const activeClass = playableClasses.find((c) => c.name === className);

  const counts = countBudgets(allocated, ascendancyId, data);

  // Collapsed on mobile: render just the toggle button in the top-left.
  if (isMobile && !mobileExpanded) {
    return (
      <button
        type="button"
        aria-label="Open toolbar"
        onClick={() => setMobileExpanded(true)}
        style={toggleButtonStyle}
      >
        ≡
      </button>
    );
  }

  return (
    <div style={containerStyle}>
      {isMobile && (
        <button
          type="button"
          aria-label="Collapse toolbar"
          onClick={() => setMobileExpanded(false)}
          style={collapseTabStyle}
        >
          <svg
            aria-hidden
            width="14"
            height="9"
            viewBox="0 0 14 9"
            fill="none"
            style={{ display: 'block' }}
          >
            <path
              d="M1 8 L7 2 L13 8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      <div style={rowStyle}>
        <SearchInput data={data} />
        {VERSIONS.length > 1 && (
          <label style={labelStyle}>
            <span style={labelTitleStyle}>Version</span>
            <select
              value={activeVersion ?? ''}
              onChange={(e) => setActiveVersion(e.target.value)}
              style={selectStyle}
            >
              {VERSIONS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </label>
        )}
        <label style={labelStyle}>
          <span style={labelTitleStyle}>Class</span>
          <select
            value={className ?? ''}
            onChange={(e) => setClass(e.target.value)}
            style={selectStyle}
          >
            {playableClasses.map((c) => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </label>

        <label style={labelStyle}>
          <span style={labelTitleStyle}>Ascendancy</span>
          <select
            value={ascendancyId ?? ''}
            onChange={(e) => setAscendancy(e.target.value || null)}
            disabled={!activeClass || activeClass.ascendancies.length === 0}
            style={selectStyle}
          >
            <option value="">(none)</option>
            {activeClass?.ascendancies
              .filter((a) => data.playableAscendancyIds.has(a.id))
              .map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
          </select>
        </label>
      </div>

      <div style={rowStyle}>
        <BudgetChip
          kind="passive"
          label="Passives"
          count={counts.passive}
          cap={PASSIVE_CAP}
        />
        {ascendancyId && (
          <BudgetChip
            kind="ascendancy"
            label="Ascendancy"
            count={counts.ascendancy}
            cap={ASCENDANCY_CAP}
          />
        )}
        <div style={spacerStyle} />
        <UndoRedoButtons />
        <ResetButton />
        <ShareButton data={data} />
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  // Cap to viewport on narrow screens so the toolbar can't overflow off-screen.
  maxWidth: 'calc(100vw - 32px)',
  boxSizing: 'border-box',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px 12px',
  background: palette.panelBg,
  border: `1px solid ${palette.border}`,
  borderRadius: 6,
  fontFamily: fontBody,
  fontSize: 13,
  color: palette.textPrimary,
  boxShadow: '0 6px 18px rgba(0, 0, 0, 0.55)',
  zIndex: 10,
  pointerEvents: 'auto',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'flex-end',
};


// The label is just the column layout; the typographic styling lives on the
// title span (below) so the rune glow and display font don't inherit down
// onto the <select> value text.
const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

// Dropdown title — carved display font, glyph-blue, with the same rune-glow
// shine as the tooltip header.
const labelTitleStyle: React.CSSProperties = {
  fontSize: 12,
  fontFamily: fontDisplay,
  color: palette.textTitle,
  textTransform: 'uppercase',
  letterSpacing: 1.5,
  textShadow: `0 0 8px ${palette.runeGlow}, 0 1px 2px rgba(0, 0, 0, 0.8)`,
};

const selectStyle: React.CSSProperties = {
  background: palette.fieldBg,
  color: palette.textPrimary,
  fontFamily: fontBody,
  border: `1px solid ${palette.border}`,
  borderRadius: 3,
  height: controlHeight,
  boxSizing: 'border-box',
  padding: '0 8px',
  fontSize: 13,
  minWidth: 140,
  cursor: 'pointer',
};

/** Pushes Undo/Reset to the right edge of the bottom row. */
const spacerStyle: React.CSSProperties = {
  flex: 1,
};

// Standalone toggle button shown when the toolbar is collapsed on mobile.
// Same visual language as the container so it reads as the toolbar's
// minimised state rather than a stray icon.
const toggleButtonStyle: React.CSSProperties = {
  position: 'absolute',
  top: 16,
  left: 16,
  width: 40,
  height: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: palette.panelBg,
  border: `1px solid ${palette.border}`,
  borderRadius: 6,
  color: palette.textMetal,
  fontSize: 22,
  lineHeight: 1,
  cursor: 'pointer',
  zIndex: 10,
  pointerEvents: 'auto',
};

// Collapse handle (mobile only): a small tab hanging off the panel's
// bottom-right edge, with an up-chevron hinting the toolbar folds away
// upward. Lives outside the box so it costs no layout space inside it.
const collapseTabStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: -27,
  right: 14,
  width: 52,
  height: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: palette.panelBg,
  border: `1px solid ${palette.border}`,
  borderTop: 'none',
  borderRadius: '0 0 6px 6px',
  color: palette.textMetal,
  cursor: 'pointer',
  padding: 0,
  pointerEvents: 'auto',
};
