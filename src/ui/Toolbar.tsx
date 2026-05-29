import { useState } from 'react';
import { useStore, countBudgets, PASSIVE_CAP, ASCENDANCY_CAP, WEAPON_SET_CAP } from '../state/store';
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
  const allocation = useStore((s) => s.allocation);
  const allocationMode = useStore((s) => s.allocationMode);
  const weaponSetsEnabled = useStore((s) => s.weaponSetsEnabled);
  const activeVersion = useStore((s) => s.activeVersion);
  const setClass = useStore((s) => s.setClass);
  const setAscendancy = useStore((s) => s.setAscendancy);
  const setActiveVersion = useStore((s) => s.setActiveVersion);
  const setAllocationMode = useStore((s) => s.setAllocationMode);
  const setWeaponSetsEnabled = useStore((s) => s.setWeaponSetsEnabled);

  const isMobile = useIsMobile();
  // Collapse state for both viewports. The hamburger/collapse-tab pair works
  // the same everywhere; only the *default* differs: open on desktop, collapsed
  // on mobile (where the toolbar wraps to 3-4 rows and obscures too much of the
  // canvas). The lazy initialiser reads `isMobile` once on first render, so the
  // default tracks the initial viewport without re-collapsing on later resizes.
  const [expanded, setExpanded] = useState(() => !isMobile);

  const playableClasses = data.playableClassIndices
    .map((i) => data.classes[i])
    .filter((c): c is NonNullable<typeof c> => c !== undefined);
  const activeClass = playableClasses.find((c) => c.name === className);

  const counts = countBudgets(allocation, ascendancyId, data);

  // The sets UI is a free user preference (off by default). Loading a build
  // that uses sets flips it on (see loadSnapshot), but it's always toggleable.
  const showSets = weaponSetsEnabled;

  // Collapsed: render just the hamburger toggle button in the top-left.
  if (!expanded) {
    return (
      <button
        type="button"
        aria-label="Open toolbar"
        onClick={() => setExpanded(true)}
        style={toggleButtonStyle}
      >
        ≡
      </button>
    );
  }

  return (
    <div style={containerStyle}>
      <button
        type="button"
        aria-label="Collapse toolbar"
        onClick={() => setExpanded(false)}
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
      {/* Row 1 — lookup / config */}
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
      </div>

      {/* Row 2 — character */}
      <div style={rowStyle}>
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

        {showSets && (
          <Segmented
            legend="Editing"
            value={allocationMode}
            options={[
              { value: 'shared', label: 'Main' },
              { value: 'set1', label: 'Set 1' },
              { value: 'set2', label: 'Set 2' },
            ]}
            onChange={setAllocationMode}
          />
        )}
        <label style={toggleStyle} title="Plan separate passives per weapon set">
          <input
            type="checkbox"
            checked={showSets}
            onChange={(e) => setWeaponSetsEnabled(e.target.checked)}
            style={toggleInputStyle}
          />
          <span>Weapon Sets</span>
        </label>
      </div>

      {/* Row 3 — point counters */}
      <div style={rowStyle}>
        {showSets ? (
          <>
            <BudgetChip kind="passive" label="Shared" count={counts.shared} />
            <BudgetChip
              kind="weaponSet1"
              label="Set 1"
              count={counts.set1}
              cap={WEAPON_SET_CAP}
            />
            <BudgetChip
              kind="weaponSet2"
              label="Set 2"
              count={counts.set2}
              cap={WEAPON_SET_CAP}
            />
            <BudgetChip
              kind="passive"
              label="Active S1"
              count={counts.activeIn1}
              cap={PASSIVE_CAP}
              note={unspentNote(PASSIVE_CAP - counts.activeIn1)}
            />
            <BudgetChip
              kind="passive"
              label="Active S2"
              count={counts.activeIn2}
              cap={PASSIVE_CAP}
              note={unspentNote(PASSIVE_CAP - counts.activeIn2)}
            />
          </>
        ) : (
          // Sets off → one plain passives counter (shared == active when there
          // are no weapon-set allocations).
          <BudgetChip kind="passive" label="Passives" count={counts.shared} cap={PASSIVE_CAP} />
        )}
        {ascendancyId && (
          <BudgetChip
            kind="ascendancy"
            label="Ascendancy"
            count={counts.ascendancy}
            cap={ASCENDANCY_CAP}
          />
        )}
      </div>

      {/* Row 4 — actions */}
      <div style={rowStyle}>
        <UndoRedoButtons />
        <ResetButton />
        <ShareButton />
      </div>
    </div>
  );
}

/** Render the unspent-points suffix for an active-points chip. Negative (over
 *  cap) shows nothing — the chip's own over-cap styling carries that. */
function unspentNote(unspent: number): string | undefined {
  if (unspent < 0) return undefined;
  return unspent === 0 ? 'full' : `${unspent} left`;
}

/** A small segmented button group for the allocation-mode (Main / Set 1 /
 *  Set 2) selector. Generic over the value type. */
function Segmented<T extends string | number>({
  legend, value, options, onChange,
}: Readonly<{
  legend: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}>) {
  return (
    <fieldset style={segmentedWrapStyle}>
      <legend style={segmentedLegendStyle}>{legend}</legend>
      <div style={segmentedGroupStyle}>
        {options.map((opt, i) => {
          const selected = opt.value === value;
          const base = selected ? segmentSelectedStyle : segmentStyle;
          // The group's own border draws the left edge — only inner buttons
          // get a divider, so the first button has no stray double line.
          return (
            <button
              key={String(opt.value)}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(opt.value)}
              style={i === 0 ? { ...base, borderLeft: 'none' } : base}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </fieldset>
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

// "Weapon Sets" opt-in checkbox. Aligned to the bottom of row 1 so it sits on
// the same baseline as the adjacent select controls.
const toggleStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: controlHeight,
  fontSize: 13,
  color: palette.textMetal,
  cursor: 'pointer',
  userSelect: 'none',
};

// Tint the native checkbox to the signature rune blue so it matches the rest
// of the toolbar instead of the browser's default green.
const toggleInputStyle: React.CSSProperties = {
  accentColor: palette.rune,
  cursor: 'pointer',
};

// Segmented control (allocation-mode selector).
// Rendered as a borderless fieldset so the legend labels the group for
// screen readers without drawing the default fieldset chrome.
const segmentedWrapStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: 0,
  padding: 0,
  border: 'none',
};

const segmentedLegendStyle: React.CSSProperties = {
  float: 'none',
  width: 'auto',
  padding: 0,
  fontSize: 12,
  fontFamily: fontDisplay,
  color: palette.textTitle,
  textTransform: 'uppercase',
  letterSpacing: 1.2,
  textShadow: `0 0 8px ${palette.runeGlow}, 0 1px 2px rgba(0, 0, 0, 0.8)`,
};

const segmentedGroupStyle: React.CSSProperties = {
  display: 'inline-flex',
  border: `1px solid ${palette.border}`,
  borderRadius: 3,
  overflow: 'hidden',
};

const segmentStyle: React.CSSProperties = {
  background: palette.fieldBg,
  color: palette.textMuted,
  border: 'none',
  borderLeft: `1px solid ${palette.border}`,
  height: controlHeight,
  boxSizing: 'border-box',
  padding: '0 10px',
  fontSize: 13,
  fontFamily: fontBody,
  cursor: 'pointer',
};

const segmentSelectedStyle: React.CSSProperties = {
  ...segmentStyle,
  background: palette.headerBg,
  color: palette.textTitle,
  fontWeight: 600,
};

// Standalone hamburger button shown when the toolbar is collapsed (either
// viewport). Same visual language as the container so it reads as the
// toolbar's minimised state rather than a stray icon.
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

// Collapse handle: a small tab hanging off the panel's bottom-right edge,
// with an up-chevron hinting the toolbar folds away upward. Lives outside the
// box so it costs no layout space inside it.
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
